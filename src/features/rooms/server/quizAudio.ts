import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Question audio for hand-written room quizzes (feature 6.13) — the host drops
// a clip onto a question, and the room hears that clip instead of the AI
// read-aloud.
//
// The bytes live on disk, one folder per room:
//   data/quiz-audio/<roomId>/<uuid>.<ext>
// Nothing is served from `public/`: the only reader is the route handler in
// src/app/api/rooms/[roomId]/quiz-audio, which checks room membership first, so
// a clip is reachable only by the room it was dropped into.
//
// Keys are minted here (uuid + extension), never taken from the upload, and both
// the room id and the key are pattern-checked before they touch a path — that is
// what keeps `..` and absolute paths out of the folder. Kept free of "use server"
// so route handlers can import it without turning these helpers into
// client-callable actions.

/** Clips are question narration, not media libraries. */
export const MAX_QUESTION_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB

/** Browsers disagree on audio MIME types, so the extension is the fallback. */
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/opus": "opus",
};

const EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** Server-minted names only — this is also what blocks path traversal. */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;
/** Room ids are uuids; anything else never becomes part of a path. */
const ROOM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when an upload looks like a playable audio clip (by MIME or extension). */
export function isAudioClip(fileName: string, fileType: string): boolean {
  const type = fileType.toLowerCase();
  if (MIME_EXTENSIONS[type]) return true;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return extension in EXTENSION_TYPES;
}

/** The room's audio folder, or null when the id can't safely be a path segment. */
function roomDir(roomId: string): string | null {
  if (!ROOM_ID_PATTERN.test(roomId)) return null;
  return path.join(process.cwd(), "data", "quiz-audio", roomId);
}

function typeFor(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Write a clip into the room's folder. Returns the minted key — the caller
 * stores that on the question, not the original name or path.
 */
export async function saveQuestionAudio(input: {
  roomId: string;
  bytes: Buffer;
  fileName: string;
  fileType: string;
}): Promise<{ key: string }> {
  const dir = roomDir(input.roomId);
  if (!dir) throw new Error("That room id is not valid");
  if (input.bytes.length === 0) throw new Error("That audio file is empty");
  if (input.bytes.length > MAX_QUESTION_AUDIO_BYTES) {
    throw new Error("That audio file is too large");
  }

  const extension = isAudioClip(input.fileName, input.fileType)
    ? (MIME_EXTENSIONS[input.fileType.toLowerCase()] ??
      input.fileName.split(".").pop()?.toLowerCase() ??
      "mp3")
    : null;
  if (!extension || !(extension in EXTENSION_TYPES)) {
    throw new Error("Drop an audio file (MP3, WAV, OGG, M4A, WebM)");
  }

  await mkdir(dir, { recursive: true });
  const key = `${randomUUID()}.${extension}`;
  await writeFile(path.join(dir, key), input.bytes);
  return { key };
}

/** The clip's bytes, or null when the room or file doesn't exist. */
export async function readQuestionAudio(
  roomId: string,
  key: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const dir = roomDir(roomId);
  if (!dir || !KEY_PATTERN.test(key)) return null;
  try {
    const bytes = await readFile(path.join(dir, key));
    return { bytes, contentType: typeFor(key) };
  } catch {
    return null;
  }
}

/**
 * True when the room actually has this clip. The start action checks it so a
 * stale key (file removed, or a key from another room's folder) can't reach a
 * question row.
 */
export async function hasQuestionAudio(
  roomId: string,
  key: string
): Promise<boolean> {
  const dir = roomDir(roomId);
  if (!dir || !KEY_PATTERN.test(key)) return false;
  try {
    const info = await stat(path.join(dir, key));
    return info.isFile();
  } catch {
    return false;
  }
}

/** Best-effort cleanup when a host drops a replacement or clears a question. */
export async function deleteQuestionAudio(
  roomId: string,
  key: string
): Promise<void> {
  const dir = roomDir(roomId);
  if (!dir || !KEY_PATTERN.test(key)) return;
  try {
    await unlink(path.join(dir, key));
  } catch {
    // Already gone — nothing to clean up.
  }
}
