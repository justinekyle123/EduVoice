import type { QuestionType } from "./generate";

// Answer checking, kept apart from quiz writing so the browser can use it too.
//
// The server is still the authority: a finished attempt is graded again in
// `submitQuizAttempt` before anything is stored or scored. The voice quiz also
// needs a verdict between questions, and asking the server for one made every
// answer wait on a round trip — so it prefetches the answer key once and uses
// this same comparison locally (see components/VoiceQuizPlayer.tsx). Sharing the
// function is what keeps the spoken verdict and the final score identical.
//
// Client-safe: no AI client, no filesystem, no database.

/** Lowercase, collapse whitespace — casing and spacing never decide a score. */
function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Short answers are graded loosely on purpose: a student who writes a fuller
 * sentence containing the expected phrase is right, and spelling casing or
 * surrounding punctuation shouldn't decide a score.
 */
export function isAnswerCorrect(
  type: QuestionType,
  expected: string,
  given: string
): boolean {
  const expectedNorm = normalize(expected);
  const givenNorm = normalize(given);
  if (givenNorm.length === 0) return false;
  if (expectedNorm === givenNorm) return true;

  if (type === "short_answer" && expectedNorm.length >= 4) {
    return givenNorm.includes(expectedNorm);
  }

  return false;
}
