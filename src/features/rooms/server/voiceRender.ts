import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quizQuestions } from "@/lib/db/schema";
import { hasGeminiKeys, hasReadyKey } from "@/lib/ai/keys";
import { synthesizeSpeechBytes } from "@/features/chat/server/ttsCore";
import { liveQuestionNarration } from "../lib/narration";
import { saveQuestionAudio } from "./quizAudio";

// Pre-rendered narration for a live room quiz (feature 6.13).
//
// A live round is read question after question with only the shared question
// clock between them, so a clip that has to be synthesized on the spot leaves
// the room listening to silence while the countdown runs. Rendering the clips
// when the quiz is written moves that cost to the host's "start" click: by the
// time the waiting room opens, every question already has its voice, and the
// round runs continuously.
//
// Clips are stored in the room's own audio folder (server/quizAudio.ts), the
// same one a host's dropped clip uses, because the route that serves them
// (`/api/rooms/<roomId>/quiz-audio/<key>`) admits room members rather than a
// personal quiz's owner. The key is written to `quiz_questions.audio_file`.
//
// Deliberately forgiving, like the personal quiz's renderer: a clip that cannot
// be made (no key, quota spent, a question too long for one request) leaves that
// question without a file, and the client falls back to live synthesis. Audio
// failing must never cost the room its quiz.

/** Two requests at a time: fast enough for a five-question round, polite to the key pool. */
const RENDER_CONCURRENCY = 2;
/** Questions are read in the same warm voice as a tutor's reply. */
const ROOM_STYLE = "tutor";
/**
 * How long the whole render may take. On a healthy quota a question is a few
 * seconds; with the free tier spent, every request walks the key pool and a
 * round of fifteen questions would hold the host for minutes. Past this budget
 * the rest are left to live synthesis, which is what they fall back to anyway.
 */
const RENDER_BUDGET_MS = 60_000;

export type RoomVoiceStatus = "ready" | "partial" | "quota" | "unavailable";

export type RoomVoiceResult = {
  /** Questions handed to the renderer. */
  total: number;
  /** Questions that now have a stored clip. */
  ready: number;
  status: RoomVoiceStatus;
};

export type RoomVoiceQuestion = {
  id: string;
  question: string;
};

/**
 * Render each question's narration and stamp the stored key on its row. Never
 * throws for a TTS or disk failure — the caller carries on with live synthesis.
 */
export async function renderRoomQuizVoice(input: {
  roomId: string;
  questions: RoomVoiceQuestion[];
}): Promise<RoomVoiceResult> {
  const total = input.questions.length;
  if (total === 0) return { total: 0, ready: 0, status: "ready" };

  // Nothing to render with: no key at all, or every key parked on a cooldown
  // (normally a spent daily quota). Trying anyway walks the key pool before
  // failing, which would hold the host for the best part of a minute.
  if (!hasReadyKey()) {
    console.warn(
      "[room-voice] no Gemini key is usable right now — the round goes out without its clips"
    );
    return {
      total,
      ready: 0,
      status: hasGeminiKeys() ? "quota" : "unavailable",
    };
  }

  const queue = input.questions.map((question, index) => ({
    question,
    position: index + 1,
  }));
  const deadline = Date.now() + RENDER_BUDGET_MS;
  // Set by the first quota failure: it will still be spent for the next line, so
  // stopping keeps a slow, doomed render from holding the host.
  let stop = false;
  let quota = false;
  let ready = 0;

  const worker = async () => {
    for (;;) {
      if (stop || Date.now() > deadline) return;
      const next = queue.shift();
      if (!next) return;

      const text = liveQuestionNarration(next.question, next.position, total);
      const result = await synthesizeSpeechBytes({ text, style: ROOM_STYLE });

      if ("error" in result) {
        console.warn(
          `[room-voice] question ${next.position}/${total} left unrendered: ${result.error}`
        );
        if (result.quota === true) {
          quota = true;
          stop = true;
          return;
        }
        continue;
      }

      // A truncated render is not the question, so it is not stored under the
      // question's row: the client synthesizes that one live instead.
      if (result.truncated) {
        console.warn(
          `[room-voice] question ${next.position}/${total} is too long for one clip — it will be read live`
        );
        continue;
      }

      try {
        const { key } = await saveQuestionAudio({
          roomId: input.roomId,
          bytes: result.bytes,
          fileName: `${next.question.id}.wav`,
          fileType: "audio/wav",
        });
        await db
          .update(quizQuestions)
          .set({ audioFile: key })
          .where(eq(quizQuestions.id, next.question.id));
        ready += 1;
      } catch (err) {
        console.warn(
          `[room-voice] could not store question ${next.position}/${total}:`,
          err
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(RENDER_CONCURRENCY, queue.length) }, worker)
  );

  const status: RoomVoiceStatus =
    ready === total ? "ready" : ready > 0 ? "partial" : quota ? "quota" : "unavailable";
  if (status !== "ready") {
    console.warn(
      `[room-voice] ${ready}/${total} questions have a clip (${status}) — the rest will be read live`
    );
  }

  return { total, ready, status };
}
