// What the narrator says for one live room question.
//
// One definition, two callers: the room's quiz generation renders exactly this
// text into a WAV per question (server/voiceRender.ts), and the browser reads the
// same words when a question has no clip — rendered before the clip route asks
// for it, or spoken live. Keeping it here is what stops the two from drifting
// apart and saying different things about the same question.
//
// Only the question itself is spoken. The choices stay on screen, where a student
// can read them at their own pace, and leaving them out keeps the read-aloud
// short so the shared question clock is spent answering, not listening.

/** A question as it needs to be read out — the answer is deliberately absent. */
export type NarratableLiveQuestion = {
  question: string;
};

/** "Question 2 of 5. Which organelle makes ATP? Say your answer." */
export function liveQuestionNarration(
  question: NarratableLiveQuestion,
  position: number,
  total: number
): string {
  const text = question.question.trim();
  const stopped = /[.!?]$/.test(text) ? text : `${text}.`;
  return `Question ${position} of ${total}. ${stopped} Say your answer.`;
}
