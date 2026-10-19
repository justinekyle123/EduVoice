import type { QuestionType } from "./generate";

// What the voice quiz says out loud for one question.
//
// One definition, two callers: the server renders exactly this text into the
// quiz's WAV clip when the quiz is written (server/voiceRender.ts), and the
// browser reads the very same text when it has to fall back to live synthesis —
// a clip that failed to render, or a quiz written before this feature existed.
// Keeping it here is what stops the two from drifting apart and saying different
// things about the same question.
//
// Client-safe on purpose: no AI client, no filesystem. `QuestionType` is a
// type-only import, so nothing from the quiz writer is pulled into the bundle.

/** A question as it needs to be read out — the answer is deliberately absent. */
export type NarratableQuestion = {
  question: string;
  type: QuestionType;
  options: string[] | null;
};

/** The letters the voice quiz reads before each choice: A, B, C… */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/** The letter shown and spoken for the option at this position. */
export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

/** Give a fragment a full stop, so the reader pauses where the screen does. */
function withStop(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * "Question 2 of 5. Which organelle makes ATP? A. Mitochondria. B. Ribosome. …
 * Say your answer."
 *
 * Every choice is named with its letter because a student answering hands-free
 * can say either the letter or the words, and the spoken-answer reader
 * (features/rooms/lib/voiceAnswer.ts) understands both.
 *
 * A short answer has no choices to read, so the invitation is the only tail.
 */
export function questionNarration(
  question: NarratableQuestion,
  position: number,
  total: number
): string {
  const parts = [`Question ${position} of ${total}.`, withStop(question.question)];

  (question.options ?? []).forEach((option, index) => {
    parts.push(`${optionLetter(index)}. ${withStop(option)}`);
  });

  parts.push("Say your answer.");
  return parts.join(" ");
}

/**
 * "The answer is B. Mitochondria." — spoken after a wrong answer.
 *
 * Not pre-rendered with the question: it names the answer, so it differs per
 * question, and rendering it for every question would double what generation
 * costs. It is synthesized on demand instead and cached by its words like any
 * other spoken passage, so a question only ever pays for its reveal if the
 * student actually gets it wrong.
 */
export function answerReveal(question: NarratableQuestion, correctAnswer: string): string {
  const index = (question.options ?? []).findIndex(
    (option) => option.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
  );

  // A choice: name the letter and then the words, matching how it was read.
  if (index !== -1) {
    return `The answer is ${optionLetter(index)}. ${withStop(correctAnswer)}`;
  }

  return `The answer is ${withStop(correctAnswer)}`;
}
