import { generateText } from "@/lib/ai";

// Smart Flashcard Generator (feature 6.12) — turning study material into cards.
//
// Two sources, two costs. A document or a topic is written by the model, one
// request returning a whole deck as JSON (the same shape the quiz writer uses).
// A finished quiz needs no model at all: its questions and answers already *are*
// cards, so that deck is built deterministically from what the student answered.

export type GeneratedCard = { front: string; back: string };

export type GeneratedDeck = {
  title: string;
  cards: GeneratedCard[];
  /** Which AI Studio key slot answered, recorded for diagnostics. */
  provider: string;
};

const MIN_CARDS = 4;
const MAX_CARDS = 30;
const DEFAULT_CARDS = 10;

/** Card content limits — long enough to be complete, short enough to review. */
const MAX_FRONT_CHARS = 200;
const MAX_BACK_CHARS = 400;

/** How much document text is handed to the writer. */
const MAX_SOURCE_CHARS = 30_000;

const SYSTEM_INSTRUCTION = `You write study flashcards for students.
Each card tests exactly one idea, and the back is a short, self-contained answer.
Return JSON only — no commentary, no markdown fences.`;

export function clampCardCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_CARDS;
  return Math.min(Math.max(Math.round(count), MIN_CARDS), MAX_CARDS);
}

function extractJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The flashcard writer did not return usable JSON");
  }
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    throw new Error("The flashcard writer returned malformed JSON");
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFront(front: string): string {
  return front.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Read the {title, cards} reply. Malformed cards are dropped individually so one
 * bad item does not discard the rest of the deck, and duplicate fronts are
 * removed so the same idea is not reviewed twice.
 */
export function parseDeckReply(reply: string): {
  title: string | null;
  cards: GeneratedCard[];
} {
  const body = extractJson(reply) as Record<string, unknown>;
  const rawCards = Array.isArray(body.cards) ? body.cards : [];

  const cards: GeneratedCard[] = [];
  const seen = new Set<string>();

  for (const raw of rawCards) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const front = asText(item.front);
    const back = asText(item.back);
    if (!front || !back) continue;

    const key = normalizeFront(front);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    cards.push({
      front: front.slice(0, MAX_FRONT_CHARS),
      back: back.slice(0, MAX_BACK_CHARS),
    });
  }

  return { title: asText(body.title), cards };
}

function cardRules(count: number): string {
  return `Return JSON in exactly this shape:
{
  "title": "short deck title",
  "cards": [
    { "front": "a term, question, or prompt", "back": "the answer, at most two sentences" }
  ]
}

Rules:
- write ${count} cards
- one idea per card; never combine two facts
- "front" is at most ${MAX_FRONT_CHARS} characters; "back" is at most ${MAX_BACK_CHARS}
- prefer asking about the most important concepts over trivia
- no duplicate cards`;
}

/** Cards grounded in a titled piece of text — a document's stored content. */
export async function generateCardsFromText(input: {
  title: string;
  text: string;
  count?: number;
}): Promise<GeneratedDeck> {
  const count = clampCardCount(input.count);
  const text = input.text.slice(0, MAX_SOURCE_CHARS).trim();
  if (!text) throw new Error("There is no text to build flashcards from");

  const { text: reply, provider } = await generateText({
    prompt: `The following is the student's study material "${input.title}". Write flashcards that cover its key terms and concepts.

${cardRules(count)}

MATERIAL:
${text}`,
    systemInstruction: SYSTEM_INSTRUCTION,
    json: true,
  });

  const { title, cards } = parseDeckReply(reply);
  if (cards.length === 0) {
    throw new Error("The flashcard writer did not return any usable cards");
  }

  return { title: title ?? shortTitle(input.title), cards, provider };
}

/** Cards on a topic the student names, with no document involved. */
export async function generateCardsFromTopic(input: {
  topic: string;
  count?: number;
}): Promise<GeneratedDeck> {
  const count = clampCardCount(input.count);

  const { text: reply, provider } = await generateText({
    prompt: `Write study flashcards on the topic "${input.topic}".

${cardRules(count)}

Base every card on well-established facts.`,
    systemInstruction: SYSTEM_INSTRUCTION,
    json: true,
  });

  const { title, cards } = parseDeckReply(reply);
  if (cards.length === 0) {
    throw new Error("The flashcard writer did not return any usable cards");
  }

  return { title: title ?? shortTitle(input.topic), cards, provider };
}

/**
 * Turn a quiz the student has already taken into a deck — no model needed, since
 * the question and its correct answer are already a card. The explanation, when
 * the writer left one, becomes the second half of the back.
 */
export function cardsFromQuizQuestions(
  questions: {
    question: string;
    correctAnswer: string;
    explanation: string | null;
  }[]
): GeneratedCard[] {
  const cards: GeneratedCard[] = [];
  const seen = new Set<string>();

  for (const question of questions) {
    const front = asText(question.question);
    const answer = asText(question.correctAnswer);
    if (!front || !answer) continue;

    const key = normalizeFront(front);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const explanation = asText(question.explanation);
    const back = explanation ? `${answer} — ${explanation}` : answer;

    cards.push({
      front: front.slice(0, MAX_FRONT_CHARS),
      back: back.slice(0, MAX_BACK_CHARS),
    });
  }

  return cards;
}

/** Deck title from a file name or topic, trimmed to something list-friendly. */
export function shortTitle(source: string): string {
  const clean = source.replace(/\.[a-z0-9]+$/i, "").trim();
  const title = clean.length > 0 ? clean : "Flashcards";
  return title.length > 60 ? `${title.slice(0, 60).trimEnd()}…` : title;
}
