import { generateParts, generateText } from "@/lib/ai";

// Document-based Q&A (feature 6.3) — turning an upload into stored text.
//
// The model reads the file itself: a PDF is handed to Gemini as inline data, the
// same trick the quiz writer uses (features/quiz/lib/generate.ts), so no local
// PDF or DOCX extractor is needed. One JSON reply yields both things a document
// row needs — the summary the FDD asks for and the plain text the chunker then
// splits. Plain-text uploads skip the model for the text (it is already
// readable) and only ask for a summary.
//
// Chunking is local and deterministic: the model is never asked to respect chunk
// boundaries, so the stored chunks depend only on the document, not on how a
// particular reply happened to be phrased.

/** Largest upload we will send to the model, matching the quiz file limit. */
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024; // 12 MB

/** Longest document text we keep, about a few hundred pages of prose. */
export const MAX_DOCUMENT_CHARS = 400_000;

/** Target size of one stored chunk — small enough to keep retrieval precise. */
const CHUNK_TARGET_CHARS = 1_200;
const CHUNK_MAX_CHARS = 1_800;

/** How much of a document is shown to the summarizer. */
const MAX_SUMMARY_INPUT_CHARS = 24_000;

const SYSTEM_INSTRUCTION = `You prepare a student's own study material for review.
Return JSON only — no commentary, no markdown fences.`;

export type DocumentSourceMime = "application/pdf" | "text/plain";

/**
 * The MIME type to read an upload as, or null when the model can't read it.
 * Only formats Gemini accepts natively are document sources: PDF and plain text.
 * Browsers report `.md`/`.csv` inconsistently, so the extension is the fallback.
 */
export function documentSourceMime(
  fileName: string,
  mimeType: string
): DocumentSourceMime | null {
  const lower = (mimeType ?? "").toLowerCase();
  if (lower === "application/pdf") return "application/pdf";
  if (fileName.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (lower.startsWith("text/")) return "text/plain";
  if ([".txt", ".md", ".csv"].some((ext) => fileName.toLowerCase().endsWith(ext))) {
    return "text/plain";
  }
  return null;
}

/** True when an upload can become a document the student can ask about. */
export function isSupportedDocument(fileName: string, mimeType: string): boolean {
  return documentSourceMime(fileName, mimeType) !== null;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Break an oversized block on sentence boundaries, falling back to words. */
function splitLongBlock(block: string): string[] {
  const sentences = block.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_MAX_CHARS) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      // One run with no sentence break — cut it on word boundaries so a wall of
      // text still becomes several chunks.
      let rest = sentence;
      while (rest.length > CHUNK_MAX_CHARS) {
        const cut = rest.lastIndexOf(" ", CHUNK_MAX_CHARS);
        const at = cut > CHUNK_MAX_CHARS * 0.5 ? cut : CHUNK_MAX_CHARS;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      if (rest.trim()) current = rest.trim();
      continue;
    }

    if (current && current.length + sentence.length + 1 > CHUNK_MAX_CHARS) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Split a document's text into the chunks that get stored and retrieved.
 *
 * Paragraphs are the primary unit; a document with no blank lines (a transcript,
 * a CSV) falls back to one block per line. Small neighbouring blocks are packed
 * together so a page of one-line notes does not become a swarm of tiny chunks,
 * and anything oversized is split at sentence boundaries.
 */
export function chunkText(text: string): string[] {
  const normalized = normalize(text).slice(0, MAX_DOCUMENT_CHARS);
  if (!normalized) return [];

  let blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length <= 1) {
    blocks = normalized
      .split(/\n/)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  const pieces: string[] = [];
  for (const block of blocks) {
    if (block.length <= CHUNK_MAX_CHARS) pieces.push(block);
    else pieces.push(...splitLongBlock(block));
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > CHUNK_TARGET_CHARS) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

// ---------------------------------------------------------------------------
// Model extraction
// ---------------------------------------------------------------------------

export type ExtractedDocument = {
  summary: string;
  text: string;
  /** Which AI Studio key slot answered, or "local" for the offline summary. */
  provider: string;
};

/** Pull the JSON body out of a reply that may carry prose or ``` fences. */
function extractJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The document reader did not return usable JSON");
  }
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    throw new Error("The document reader returned malformed JSON");
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Read the {summary, text} reply from the PDF prompt. Exported for reuse/tests. */
export function parseExtraction(reply: string): { summary: string; text: string } {
  const parsed = extractJson(reply) as Record<string, unknown>;
  const text = asText(parsed.text);
  if (!text) throw new Error("The reader could not find any text in that file");
  return { summary: asText(parsed.summary), text };
}

/** Last-resort summary when the model is unavailable: the opening of the text. */
function excerptSummary(text: string): string {
  const first = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return first ? `${first}…` : "No summary available.";
}

async function extractPdf(
  fileName: string,
  data: Buffer
): Promise<{ summary: string; text: string; provider: string }> {
  const prompt = `The attached file is "${fileName}". Read it and return JSON in exactly this shape:
{
  "summary": "a 3-5 sentence overview of what the document covers",
  "text": "the document's full plain text, in reading order"
}

Rules:
- "summary" is plain prose — no markdown, no bullet points.
- "text" is the document's own words, transcribed faithfully. Do not summarize or paraphrase it here.
- keep headings and lists, but add no commentary of your own.`;

  const { text, provider } = await generateParts({
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: data.toString("base64"),
        },
      },
    ],
    systemInstruction: SYSTEM_INSTRUCTION,
    json: true,
  });

  const extracted = parseExtraction(text);
  return {
    summary: extracted.summary || excerptSummary(extracted.text),
    text: extracted.text,
    provider,
  };
}

async function summarizeText(
  fileName: string,
  text: string
): Promise<{ summary: string; provider: string }> {
  const excerpt = text.slice(0, MAX_SUMMARY_INPUT_CHARS);
  try {
    const { text: reply, provider } = await generateText({
      prompt: `Write a 3-5 sentence summary of the study document "${fileName}" for a student. Plain prose, no markdown, no bullet points.

DOCUMENT:
${excerpt}`,
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    const summary = reply.replace(/```[a-z]*/gi, "").replace(/```/g, "").trim();
    if (summary) return { summary, provider };
  } catch (err) {
    // A missing summary must not fail the upload: the stored text is what makes
    // the document answerable, and a readable excerpt is a fair stand-in.
    console.warn("[documents] could not summarize, keeping an excerpt:", err);
  }
  return { summary: excerptSummary(text), provider: "local" };
}

/**
 * Turn an uploaded file into the summary and text a document row stores. Throws
 * a student-readable message when the file cannot be read at all.
 */
export async function extractDocument(input: {
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<ExtractedDocument> {
  const mime = documentSourceMime(input.fileName, input.mimeType);
  if (!mime) {
    throw new Error(
      "Document Q&A works with PDF and text files (.pdf, .txt, .md, .csv)"
    );
  }
  if (input.data.length > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Files must be ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB or smaller`
    );
  }

  if (mime === "application/pdf") {
    return extractPdf(input.fileName, input.data);
  }

  const text = input.data.toString("utf8");
  if (!text.trim()) throw new Error("That file has no readable text");

  const { summary, provider } = await summarizeText(input.fileName, text);
  return { summary, text, provider };
}
