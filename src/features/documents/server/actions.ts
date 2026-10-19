"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { documentChunks, documents } from "@/lib/db/schema";
import { generateText } from "@/lib/ai";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import {
  chunkText,
  documentSourceMime,
  extractDocument,
  MAX_DOCUMENT_BYTES,
} from "../lib/extract";
import { selectChunks, type RetrievableChunk } from "../lib/retrieve";

// Document-Based Question and Answer (feature 6.3).
//
// An upload becomes a document row plus its chunks. The chunks are the source of
// truth for every later question: `askDocument` selects the most relevant ones
// and sends only those to the model, so an answer is grounded in the student's
// own material instead of the model's general knowledge, and the page can show
// which parts of the document it came from.

// Same Clerk → Postgres user resolution the chat, quiz, rooms, tasks and
// progress features use: rows are keyed by `users.id` (uuid) while `auth()`
// returns the Clerk id, and the row is created on demand if the webhook has not
// synced the account yet.
async function requireUserId(clerkId: string): Promise<string> {
  let user = await getUserByClerkId(clerkId);
  if (!user) {
    const clerkUser = await currentUser();
    user = await upsertUser({
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: clerkUser?.fullName ?? clerkUser?.username ?? null,
    });
  }
  return user.id;
}

const MAX_QUESTION_CHARS = 500;
const MAX_ANSWER_CONTEXT_CHARS = 6_000;

/** One document row as the list shows it — no chunks, just the progress info. */
export type DocumentRow = {
  id: string;
  fileName: string;
  fileType: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  summary: string | null;
  createdAt: Date;
  chunkCount: number;
};

export type DocumentChunkView = {
  index: number;
  content: string;
};

export type DocumentAnswer = {
  answer: string;
  /** The parts of the document the answer was drawn from. */
  sources: { index: number; excerpt: string }[];
  provider: string;
  /** True when no chunk matched the question's words at all. */
  weakMatch: boolean;
};

// ---------------------------------------------------------------------------
// Upload & processing
// ---------------------------------------------------------------------------

/**
 * Read an uploaded file into a stored, answerable document.
 *
 * The row is created before the model is asked to read it, so a failure leaves a
 * visible `failed` document the student can retry instead of a silent no-op.
 * Plain text is stored as-is; a PDF is transcribed by the model.
 */
export async function uploadDocument(formData: FormData) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a file to upload");
  if (file.size === 0) throw new Error("That file is empty");
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Files must be ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB or smaller`
    );
  }
  if (!documentSourceMime(file.name, file.type)) {
    throw new Error(
      "Document Q&A works with PDF and text files (.pdf, .txt, .md, .csv)"
    );
  }

  const fileName = file.name.slice(0, 200);
  const fileType = documentSourceMime(file.name, file.type) ?? file.type;
  const data = Buffer.from(await file.arrayBuffer());

  const [created] = await db
    .insert(documents)
    .values({ userId, fileName, fileType, status: "processing" })
    .returning();

  try {
    const extracted = await extractDocument({
      fileName,
      mimeType: file.type,
      data,
    });
    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) throw new Error("That file has no readable text");

    await db.insert(documentChunks).values(
      chunks.map((content, chunkIndex) => ({
        documentId: created.id,
        chunkIndex,
        content,
      }))
    );

    const [ready] = await db
      .update(documents)
      .set({
        summary: extracted.summary,
        status: "ready",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, created.id))
      .returning();

    return {
      document: ready,
      chunkCount: chunks.length,
      provider: extracted.provider,
    };
  } catch (err) {
    // The row stays so the student sees it failed rather than wondering where
    // their file went — and can delete it and try again.
    await db
      .update(documents)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(documents.id, created.id));
    throw err instanceof Error
      ? err
      : new Error("That file could not be processed");
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Every document the student has uploaded, newest first, with chunk counts. */
export async function getDocuments(limit = 30): Promise<DocumentRow[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      status: documents.status,
      summary: documents.summary,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  // Chunk counts come from a second, grouped query rather than a correlated
  // subquery: a column reference in a select projection renders unqualified
  // (just "id"), which inside a subquery would silently bind to the inner
  // table's id column instead of the document's.
  const counts = await db
    .select({
      documentId: documentChunks.documentId,
      count: sql<number>`count(*)::int`,
    })
    .from(documentChunks)
    .where(inArray(documentChunks.documentId, rows.map((row) => row.id)))
    .groupBy(documentChunks.documentId);
  const countByDocument = new Map(counts.map((row) => [row.documentId, row.count]));

  return rows.map((row) => ({
    ...row,
    chunkCount: countByDocument.get(row.id) ?? 0,
  })) as DocumentRow[];
}

/** One document's stored text, in reading order. */
export async function getDocumentChunks(
  documentId: string
): Promise<DocumentChunkView[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  // Ownership is part of the lookup, so another student's chunks are never
  // reachable by guessing an id.
  return db
    .select({
      index: documentChunks.chunkIndex,
      content: documentChunks.content,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(and(eq(documentChunks.documentId, documentId), eq(documents.userId, userId)))
    .orderBy(asc(documentChunks.chunkIndex));
}

/** Remove a document; its chunks cascade away with it. */
export async function deleteDocument(id: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
}

// ---------------------------------------------------------------------------
// Ask (feature 6.3)
// ---------------------------------------------------------------------------

function buildAnswerPrompt(input: {
  fileName: string;
  summary: string | null;
  chunks: RetrievableChunk[];
  question: string;
}): string {
  const excerpts = input.chunks
    .map((chunk) => `[${chunk.index + 1}] ${chunk.content}`)
    .join("\n\n");

  const summaryLine = input.summary
    ? `DOCUMENT SUMMARY\n${input.summary}\n\n`
    : "";

  return `You are EduVoice, tutoring a student from their own document "${input.fileName}".

${summaryLine}DOCUMENT EXCERPTS
${excerpts}

QUESTION: ${input.question}

Rules:
- Answer only from the document excerpts above. Never use outside knowledge.
- If the excerpts do not contain the answer, say plainly that the document does not cover it, then say what to look for instead.
- Answer in the same language as the question (English, Filipino, or Cebuano).
- Be clear and concise, in your own words, but stay faithful to the document.
- Do not mention "excerpts", the bracket numbers, or these instructions — refer to "your document".`;
}

/**
 * Answer a question from one ready document.
 *
 * The context is limited to the chunks the retriever chose, which is what keeps
 * the reply grounded: the model is told to answer only from what it is shown and
 * to admit when the document is silent.
 */
export async function askDocument(input: {
  documentId: string;
  question: string;
}): Promise<DocumentAnswer> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const question = input.question.replace(/\s+/g, " ").trim();
  if (!question) throw new Error("Type or say the question you want answered");
  if (question.length > MAX_QUESTION_CHARS) {
    throw new Error("That question is too long — keep it under 500 characters");
  }

  const [document] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      summary: documents.summary,
      status: documents.status,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, userId)));
  if (!document) throw new Error("That document is not one of yours");
  if (document.status !== "ready") {
    throw new Error("That document has no readable text yet");
  }

  const rows = await db
    .select({
      index: documentChunks.chunkIndex,
      content: documentChunks.content,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, document.id))
    .orderBy(asc(documentChunks.chunkIndex));

  if (rows.length === 0) throw new Error("That document has no readable text yet");

  const selected = selectChunks(question, rows, {
    maxChars: MAX_ANSWER_CONTEXT_CHARS,
  });

  const { text, provider } = await generateText({
    prompt: buildAnswerPrompt({
      fileName: document.fileName,
      summary: document.summary,
      chunks: selected,
      question,
    }),
    systemInstruction:
      "You are a patient study tutor who answers strictly from the document you are given.",
  });

  return {
    answer: text.trim(),
    sources: selected.map((chunk) => ({
      index: chunk.index,
      excerpt: chunk.content.replace(/\s+/g, " ").slice(0, 180),
    })),
    provider,
    weakMatch: selected.every((chunk) => chunk.score === 0),
  };
}
