// Retrieval for document Q&A (feature 6.3).
//
// There is no vector store in this project, so grounding is done with plain
// lexical scoring: the question's words are matched against every stored chunk,
// weighted by how rare each word is across the document (a term in every chunk
// says little; a term in one chunk says a lot). Chunks that clear a margin below
// the best hit are handed to the model as the document excerpts. The rules live
// here, apart from the query and the AI call, so they can be exercised on their
// own and the answer can only ever be as grounded as these chunks.

export type RetrievableChunk = {
  /** Position of the chunk in the document, in reading order. */
  index: number;
  content: string;
};

export type SelectedChunk = RetrievableChunk & { score: number };

/** Very common words carry no signal and would match every chunk. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "ang",
  "mga",
  "ng",
  "sa",
  "na",
  "ay",
  "ko",
  "mo",
  "po",
  "ba",
  "ug",
  "nga",
  "sila",
]);

/** Kept chunks must score at least this share of the best chunk's score. */
const RELATIVE_MARGIN = 0.35;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ñáéíóú]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pack chunks into a context block without exceeding a character budget. */
function takeWithin(
  ranked: SelectedChunk[],
  maxChunks: number,
  maxChars: number
): SelectedChunk[] {
  const chosen: SelectedChunk[] = [];
  let used = 0;
  for (const entry of ranked) {
    if (chosen.length >= maxChunks) break;
    if (chosen.length > 0 && used + entry.content.length > maxChars) break;
    chosen.push(entry);
    used += entry.content.length;
  }
  return chosen.sort((a, b) => a.index - b.index);
}

/**
 * Pick the chunks most likely to answer `question`.
 *
 * Returns the best-scoring chunks in reading order. When nothing matches — a
 * greeting, or a question the document simply does not cover — the opening
 * chunks are returned so the model still answers from the document rather than
 * from its own knowledge.
 */
export function selectChunks(
  question: string,
  chunks: RetrievableChunk[],
  options: { maxChunks?: number; maxChars?: number } = {}
): SelectedChunk[] {
  const maxChunks = options.maxChunks ?? 6;
  const maxChars = options.maxChars ?? 6_000;
  if (chunks.length === 0) return [];

  const terms = tokenize(question);
  const scorable = chunks.map((chunk) => ({ ...chunk, score: 0 }));

  if (terms.length === 0) {
    return takeWithin(scorable, maxChunks, maxChars);
  }

  const documentTokens = chunks.map((chunk) => tokenize(chunk.content));

  // Document frequency: how many chunks contain each term.
  const docFrequency = new Map<string, number>();
  for (const tokens of documentTokens) {
    for (const token of new Set(tokens)) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const phrase = normalize(question);
  const total = chunks.length;

  const scored = chunks.map((chunk, position) => {
    const counts = new Map<string, number>();
    for (const token of documentTokens[position]) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of terms) {
      const frequency = counts.get(term) ?? 0;
      if (frequency === 0) continue;
      // Inverse document frequency: a rare term is worth more than a common one.
      const idf = Math.log(1 + total / (docFrequency.get(term) ?? 1));
      score += (1 + Math.log(frequency)) * idf;
    }
    // An exact phrasing of the question inside a chunk is a strong signal.
    if (phrase.length > 0 && normalize(chunk.content).includes(phrase)) {
      score += 2;
    }

    return { index: chunk.index, content: chunk.content, score };
  });

  const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  if (best <= 0) return takeWithin(scorable, maxChunks, maxChars);

  const ranked = scored
    .filter((entry) => entry.score > 0 && entry.score >= best * RELATIVE_MARGIN)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return takeWithin(ranked, maxChunks, maxChars);
}
