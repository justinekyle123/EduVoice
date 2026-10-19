// Live room quiz (feature 6.13) — turning a spoken answer into a graded one.
//
// This is the part that makes the room quiz different from a Quizizz-style one:
// the question is read aloud by the narrator and answered out loud. Speech
// recognition rarely returns an option verbatim, so a plain string compare would
// fail a student who said "letter B" or "the second one". This module maps what
// was heard onto the option it names, in English, Filipino, and Cebuano, and
// falls back to the raw transcript for short answers (which the existing fuzzy
// grader then marks).
//
// Pure and dependency-free apart from the shared grading helper, so it can be
// exercised without a browser or a database.

import type { QuestionType } from "@/features/quiz/lib/generate";

export type SpokenQuestion = {
  type: QuestionType;
  options: string[] | null;
};

/** How the utterance was understood — shown back so the student can trust it. */
export type SpokenAnswerSource =
  | "option-text"
  | "option-letter"
  | "option-number"
  | "true-false"
  | "verbatim";

export type SpokenAnswer = {
  /** What to grade: an exact option string when one was identified, else the words. */
  answer: string;
  source: SpokenAnswerSource;
};

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/**
 * How a letter comes back from speech recognition.
 *
 * A spoken "B" is rarely the single character: the browser writes "b", "be" or
 * "bee", and "C" arrives as "sea" as often as "c". These are matched only when
 * they are the whole utterance (or right after "option"/"letter"), so a sentence
 * containing "the sea" stays an answer rather than becoming option C.
 */
const SPOKEN_LETTERS: Record<string, string> = {
  a: "a",
  ay: "a",
  eh: "a",
  b: "b",
  be: "b",
  bee: "b",
  c: "c",
  see: "c",
  sea: "c",
  d: "d",
  de: "d",
  dee: "d",
  e: "e",
  ee: "e",
  f: "f",
  ef: "f",
  eff: "f",
  g: "g",
  gee: "g",
  h: "h",
  ache: "h",
  aitch: "h",
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  isa: 1,
  dalawa: 2,
  tatlo: 3,
  apat: 4,
  lima: 5,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  singko: 5,
};

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  una: 1,
  ikalawa: 2,
  ikatlo: 3,
  ikaapat: 4,
};

const TRUE_WORDS = ["true", "tama", "totoo", "oo", "sakto", "husto", "yes", "correct"];
const FALSE_WORDS = [
  "false",
  "mali",
  "dili",
  "hindi",
  "sayop",
  "wrong",
  "incorrect",
  "no",
  "wala",
];
// "dili tinuod" ("not true") reads as false even though it contains a true word.
const HARD_FALSE = ["dili tinuod", "hindi totoo", "dili sakto", "hindi tama"];

/** Lowercase, drop punctuation, collapse whitespace — keeps accents and spaces. */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9àâäãåèéêëìíîïòóôöõùúûüñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(text);
}

/** "true" / "tama" / "oo" → "True"; "false" / "mali" / "dili" → "False". */
function readTrueFalse(text: string): "True" | "False" | null {
  if (HARD_FALSE.some((phrase) => text.includes(phrase))) return "False";
  if (FALSE_WORDS.some((word) => hasWord(text, word))) return "False";
  if (TRUE_WORDS.some((word) => hasWord(text, word))) return "True";
  return null;
}

/**
 * The option the student named in words. The most specific match wins: a
 * statement that contains the whole of an option beats a loose fragment. When
 * two options are equally good the longer text wins, and a bare near-miss
 * returns null rather than guessing.
 */
function matchOptionText(text: string, options: readonly string[]): number | null {
  const normalized = options.map(normalizeSpeech);

  const exact = normalized.indexOf(text);
  if (exact !== -1) return exact;

  let containsBest: number | null = null;
  let containsLength = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const option = normalized[i];
    if (option.length >= 3 && text.includes(option) && option.length > containsLength) {
      containsBest = i;
      containsLength = option.length;
    }
  }
  if (containsBest !== null) return containsBest;

  let fragmentBest: number | null = null;
  let fragmentLength = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const option = normalized[i];
    if (text.length >= 4 && option.includes(text) && option.length > fragmentLength) {
      fragmentBest = i;
      fragmentLength = option.length;
    }
  }
  return fragmentBest;
}

/** "option b" / "letter sea" / a lone "bee" → the option at that position. */
function matchOptionLetter(text: string, count: number): number | null {
  const marked = text.match(/\b(?:option|opt|letter|choice|answer)\s+([a-z]+)\b/);
  const named = marked ? SPOKEN_LETTERS[marked[1]] : undefined;
  const letter = named ?? SPOKEN_LETTERS[text];
  if (letter === undefined) return null;

  const index = LETTERS.indexOf(letter);
  return index >= 0 && index < count ? index : null;
}

/** "number two" / "the second one" / a lone "2" → the option at that position. */
function matchOptionNumber(text: string, count: number): number | null {
  const marked = text.match(
    /\b(?:option|number|choice|answer|num)\s+(\d|one|two|three|four|five|six|isa|dalawa|tatlo|apat|lima|uno|dos|tres|cuatro|singko)\b/
  );
  if (marked) {
    const index = toOptionIndex(marked[1], count);
    if (index !== null) return index;
  }

  const ordinal = text.match(
    /\b(first|second|third|fourth|fifth|sixth|una|ikalawa|ikatlo|ikaapat)\b/
  );
  if (ordinal) {
    const index = (ORDINALS[ordinal[1]] ?? 0) - 1;
    if (index >= 0 && index < count) return index;
  }

  // A lone number, spoken or typed, means that option.
  const index = toOptionIndex(text, count);
  return index;
}

function toOptionIndex(token: string, count: number): number | null {
  let position: number | null = null;
  if (/^\d$/.test(token)) position = Number(token);
  else position = NUMBER_WORDS[token] ?? null;
  if (position === null) return null;
  const index = position - 1;
  return index >= 0 && index < count ? index : null;
}

/**
 * Understand one spoken answer against the question on screen.
 *
 * Returns the exact option text for choice questions (so the server's grader can
 * compare strings) and the student's own words for short answers.
 */
export function resolveSpokenAnswer(
  question: SpokenQuestion,
  transcript: string
): SpokenAnswer {
  const raw = transcript.trim();
  const text = normalizeSpeech(transcript);
  if (!text) return { answer: raw, source: "verbatim" };

  const options = question.options ?? [];

  if (question.type === "true_false") {
    const value = readTrueFalse(text);
    if (value) return { answer: value, source: "true-false" };
  }

  if (options.length > 0) {
    const byText = matchOptionText(text, options);
    if (byText !== null) return { answer: options[byText], source: "option-text" };

    const byLetter = matchOptionLetter(text, options.length);
    if (byLetter !== null) return { answer: options[byLetter], source: "option-letter" };

    const byNumber = matchOptionNumber(text, options.length);
    if (byNumber !== null) return { answer: options[byNumber], source: "option-number" };
  }

  return { answer: raw, source: "verbatim" };
}

/** Short confirmation of how a spoken answer was read, for the mic line. */
export function spokenAnswerLabel(source: SpokenAnswerSource): string {
  switch (source) {
    case "option-text":
      return "matched an option";
    case "option-letter":
      return "matched a letter";
    case "option-number":
      return "matched a number";
    case "true-false":
      return "read as true/false";
    default:
      return "heard as your answer";
  }
}
