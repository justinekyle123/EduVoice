import { synthesizeSpeechBytes } from "@/features/chat/server/ttsCore";
import { hasGeminiKeys, hasReadyKey } from "@/lib/ai/keys";
import { questionNarration, type NarratableQuestion } from "../lib/narration";
import { saveQuizQuestionAudio } from "./quizAudio";

export type QuizAudioStatus = "ready" | "quota" | "unavailable";

// Render a freshly written quiz into its own narration clips.
//
// Called once per quiz, from the generator (server/actions.ts), so a voice quiz
// never synthesizes anything at play time. It is deliberately forgiving: a clip
// that cannot be rendered (no key, quota spent, a long question the model won't
// take in one go) leaves that question without a file, and the player falls back
// to ordinary live synthesis for it. Failing the quiz because its audio failed
// would be the wrong trade — the questions are the thing the student asked for.
//
// Two requests in flight at a time: enough that a five-question quiz doesn't feel
// sequential, few enough to stay polite to the free tier the key pool rotates
// over (see lib/ai/keys.ts).

const RENDER_CONCURRENCY = 2;
/** Questions are read in the same warm, unhurried voice as a tutor's reply. */
const QUIZ_STYLE = "tutor";
/**
 * How long the whole render may take before the quiz is handed over without it.
 *
 * Measured on a healthy quota, a question is a few seconds; with the free tier
 * spent, every request walks the key pool and a quiz of five questions would hold
 * the student for minutes. Past this budget the remaining questions are left to
 * live synthesis, which is what they fall back to anyway.
 */
const RENDER_BUDGET_MS = 45_000;

export type RenderableQuestion = NarratableQuestion & { id: string };

/**
 * Render every question of a quiz and return the question ids that got a clip,
 * mapped to the key stored on the row. Never throws for a TTS/disk failure.
 */
export async function renderQuizQuestionAudio(input: {
  quizId: string;
  questions: RenderableQuestion[];
}): Promise<{ clips: Map<string, string>; status: QuizAudioStatus }> {
  const rendered = new Map<string, string>();

  // Hand the quiz over without clips when there is nothing to render with: no
  // key at all, or every key parked on a cooldown (normally a spent daily quota,
  // which is what the free tier's ten TTS requests a day comes to). Trying anyway
  // walks the key pool before failing, and that holds the student for the best
  // part of a minute to produce nothing. The questions fall back to live
  // synthesis, which is what they would have done regardless.
  if (!hasReadyKey()) {
    console.warn(
      "[quiz-audio] no Gemini key is usable right now — the quiz goes out without its clips"
    );
    return {
      clips: rendered,
      status: hasGeminiKeys() ? "quota" : "unavailable",
    };
  }

  const total = input.questions.length;
  const queue = input.questions.map((question, index) => ({
    question,
    position: index + 1,
  }));
  const deadline = Date.now() + RENDER_BUDGET_MS;
  // Set by the first quota failure: it will still be spent for the next line, so
  // stopping is what keeps a slow, doomed render from holding the whole quiz.
  let stop = false;
  let status: QuizAudioStatus = "ready";

  const worker = async () => {
    for (;;) {
      if (stop || Date.now() > deadline) return;
      const next = queue.shift();
      if (!next) return;

      const outcome = await renderOne({
        quizId: input.quizId,
        question: next.question,
        position: next.position,
        total,
      });
      if (outcome.key) rendered.set(next.question.id, outcome.key);
      if (outcome.status === "quota") status = "quota";
      else if (outcome.status === "unavailable" && status === "ready") {
        status = "unavailable";
      }
      if (outcome.stop) {
        stop = true;
        console.warn(
          `[quiz-audio] stopping the render at question ${next.position}/${total} — the rest will be synthesized live`
        );
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(RENDER_CONCURRENCY, queue.length) }, worker)
  );

  return { clips: rendered, status };
}

/**
 * One question → one file. `key` is null when it was not stored, and `stop` asks
 * the caller to give up on the rest of the quiz (a spent quota).
 */
async function renderOne(input: {
  quizId: string;
  question: RenderableQuestion;
  position: number;
  total: number;
}): Promise<{
  key: string | null;
  stop: boolean;
  status: QuizAudioStatus;
}> {
  const text = questionNarration(input.question, input.position, input.total);

  // The voice comes from GEMINI_TTS_VOICE by default, the same one chat speaks
  // with, so a quiz sounds like the tutor who would have asked the question.
  const result = await synthesizeSpeechBytes({
    text,
    style: QUIZ_STYLE,
  });

  if ("error" in result) {
    console.warn(
      `[quiz-audio] question ${input.position}/${input.total} left unrendered: ${result.error}`
    );
    return {
      key: null,
      stop: result.quota === true,
      status: result.quota === true ? "quota" : "unavailable",
    };
  }

  // A truncated render is not the question, so it must not be stored under the
  // question's key: the player synthesizes it live instead, in sentence-sized
  // chunks, which is the path that handles a very long question properly.
  if (result.truncated) {
    console.warn(
      `[quiz-audio] question ${input.position}/${input.total} is too long for one clip — will be synthesized live`
    );
    return { key: null, stop: false, status: "unavailable" };
  }

  try {
    const key = await saveQuizQuestionAudio({
      quizId: input.quizId,
      questionId: input.question.id,
      bytes: result.bytes,
    });
    return { key, stop: false, status: "ready" };
  } catch (err) {
    console.warn(`[quiz-audio] could not store question ${input.position}:`, err);
    return { key: null, stop: false, status: "unavailable" };
  }
}
