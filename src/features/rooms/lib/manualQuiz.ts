import type { QuestionType } from "@/features/quiz/lib/generate";

// Manual room quiz (feature 6.13) — the host writes the questions instead of
// having the AI generate them.
//
// This module is the single definition of what a manual question is, shared by
// the builder form (which validates as the host types) and the server action
// (which validates again before storing). It is deliberately free of DB and AI
// imports so the client can use it too; the `QuestionType` import is type-only.

export type ManualQuestionDraft = {
  question: string;
  type: QuestionType;
  /** Choice options, used by `multiple_choice` only. */
  options: string[];
  /** For choices: must equal one option. For true/false: "True"/"False". */
  correctAnswer: string;
  explanation: string;
  /**
   * Narration clip the host dropped onto the question, or null for the normal
   * AI read-aloud. `key` is the server-minted file name in the room's audio
   * folder — never a path — and `name` is only what the builder displays.
   */
  audio: { key: string; name: string } | null;
};

export const MANUAL_LIMITS = { min: 3, max: 15 } as const;

/** A fresh, empty question for the builder. */
export function blankQuestion(): ManualQuestionDraft {
  return {
    question: "",
    type: "multiple_choice",
    options: ["", "", "", ""],
    correctAnswer: "",
    explanation: "",
    audio: null,
  };
}

export type NormalizedManualQuestion = {
  question: string;
  type: QuestionType;
  options: string[] | null;
  correctAnswer: string;
  explanation: string | null;
  /** Audio key to store on the question row, or null for TTS narration. */
  audioFile: string | null;
};

/**
 * Turn a draft into a storable question, or null when it isn't complete. This is
 * the one place the rules live: a multiple-choice answer must match one of its
 * options, true/false must be True or False, and short answers need a phrase.
 */
export function normalizeManualQuestion(
  draft: ManualQuestionDraft
): NormalizedManualQuestion | null {
  const question = draft.question.trim();
  if (question.length < 3) return null;
  const explanation = draft.explanation.trim() || null;
  const audioFile = draft.audio?.key ?? null;

  if (draft.type === "true_false") {
    const value = draft.correctAnswer.trim().toLowerCase();
    if (value !== "true" && value !== "false") return null;
    return {
      question,
      type: "true_false",
      options: ["True", "False"],
      correctAnswer: value === "true" ? "True" : "False",
      explanation,
      audioFile,
    };
  }

  if (draft.type === "short_answer") {
    const answer = draft.correctAnswer.trim();
    if (!answer) return null;
    return {
      question,
      type: "short_answer",
      options: null,
      correctAnswer: answer,
      explanation,
      audioFile,
    };
  }

  // multiple_choice
  const options = draft.options
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  if (options.length < 2) return null;
  const answer = draft.correctAnswer.trim();
  if (!options.includes(answer)) return null;
  return {
    question,
    type: "multiple_choice",
    options,
    correctAnswer: answer,
    explanation,
    audioFile,
  };
}

/** True when the draft is ready to be stored. */
export function isManualQuestionComplete(draft: ManualQuestionDraft): boolean {
  return normalizeManualQuestion(draft) !== null;
}
