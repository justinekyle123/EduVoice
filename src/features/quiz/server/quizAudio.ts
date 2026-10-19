import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Question narration for the voice quiz (feature 6.4), pre-rendered at the moment
// the quiz is written.
//
//   data/quiz-audio/<quizId>/<questionId>.wav
//
// Why render it at all: a quiz is written once and taken again and again, and the
// same five questions are read out on every attempt. Synthesizing them per attempt
// would spend a TTS request each time and make a repeat sound slightly different
// every run; rendering them once means the second run of a voice quiz costs no
// TTS request at all, and the questions always sound the same. It is the same
// trade the committed phrase bank makes (features/chat/lib/phrases.ts), with the
// clips kept per quiz because a quiz's text is generated rather than fixed.
//
// The folder shape matches what room quizzes do with a host's own clip
// (features/rooms/server/quizAudio.ts) — one folder per quiz, one file per
// question — but under the quiz's own id, because a personal quiz has no room.
// Clips are never pruned: a quiz is a deliberate, bounded thing (3-15 questions),
// and keeping them is the whole point of the feature.
//
// Files are named after the question they belong to, so a question's clip is
// found, replaced or dropped by key with no bookkeeping. Both ids are uuids and
// are pattern-checked before they touch a path — that is what keeps `..` and
// absolute paths out of the folder. Kept free of "use server" so the route
// handler and the generation code can import it directly.

/** Quiz ids and question ids are both uuids; anything else never becomes a path. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a value is shaped like a quiz id, so a request can be rejected early. */
export function isQuizAudioScope(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The stored key for a question's clip: its own id, so no index is needed. */
export function quizAudioKey(questionId: string): string {
  return `${questionId}.wav`;
}

/** The quiz's audio folder, or null when the id can't safely be a path segment. */
function quizDir(quizId: string): string | null {
  if (!UUID_PATTERN.test(quizId)) return null;
  return path.join(process.cwd(), "data", "quiz-audio", quizId);
}

/** True when a stored key is exactly the file name this folder allows. */
function isQuizAudioKey(quizId: string, key: string): boolean {
  return (
    UUID_PATTERN.test(quizId) &&
    key.endsWith(".wav") &&
    UUID_PATTERN.test(key.slice(0, -4))
  );
}

/**
 * Write a question's narration clip and return the key to store on the row.
 * Throws only for an unusable id — the caller treats a TTS failure as "no clip".
 */
export async function saveQuizQuestionAudio(input: {
  quizId: string;
  questionId: string;
  bytes: Buffer;
}): Promise<string> {
  const dir = quizDir(input.quizId);
  if (!dir) throw new Error("That quiz id is not valid");
  if (input.bytes.length === 0) throw new Error("Refusing to write empty audio");

  const key = quizAudioKey(input.questionId);
  if (!isQuizAudioKey(input.quizId, key)) {
    throw new Error("That question id is not valid");
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), input.bytes);
  return key;
}

/** A question's clip, or null when the quiz or the file isn't there. */
export async function readQuizQuestionAudio(
  quizId: string,
  key: string
): Promise<Buffer | null> {
  const dir = quizDir(quizId);
  if (!dir || !isQuizAudioKey(quizId, key)) return null;
  try {
    const bytes = await readFile(path.join(dir, key));
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** True when this quiz actually has this clip — used to validate a stored key. */
export async function hasQuizQuestionAudio(
  quizId: string,
  key: string
): Promise<boolean> {
  const dir = quizDir(quizId);
  if (!dir || !isQuizAudioKey(quizId, key)) return false;
  try {
    const info = await stat(path.join(dir, key));
    return info.isFile();
  } catch {
    return false;
  }
}
