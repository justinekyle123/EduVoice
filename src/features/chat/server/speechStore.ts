import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Where spoken audio lives on disk.
//
// Two folders, both under `data/` (gitignored except the phrase bank):
//
//   data/phrases/<key>.wav   the fixed lines in lib/phrases.ts, rendered once by
//                            scripts/generate-phrases.ts and committed, so a
//                            fresh clone (or a deploy) speaks them for free.
//   data/speech/<key>.wav    everything else the tutor has said: each reply
//                            chunk is written here the first time it is
//                            synthesized, so replaying an answer — or hearing
//                            the same sentence in a later session — costs no
//                            TTS request at all. Runtime cache: never committed,
//                            and trimmed to the newest MAX_CACHED_CLIPS clips.
//
// File names are keys, not sentences: either a hash we computed or a known
// phrase key from `VOICE_OPENERS`. Both are pattern-checked before they touch a
// path, which is what keeps `..` and absolute paths out of the folders.
//
// Kept free of "use server" so the route handlers and the generation script can
// import it directly.

/** Phrase keys (`phrase-chat`) and content hashes (40 hex chars). */
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const HASH_PATTERN = /^[0-9a-f]{40}$/;

/** True when a key may be used as a file name. */
export function isValidSpeechKey(key: string): boolean {
  return KEY_PATTERN.test(key) || HASH_PATTERN.test(key);
}

function dirFor(folder: "phrases" | "speech"): string {
  return path.join(process.cwd(), "data", folder);
}

/**
 * Cache key for one passage: the voice and the exact words.
 *
 * The speech style is deliberately *not* part of the key. It decides how a
 * passage is performed the first time it is synthesized; afterwards the file is
 * that passage's audio, and a request from another study mode — or from a later
 * session — replays the recording instead of paying for the same words again.
 * Otherwise switching mode and pressing Listen would write a second WAV for
 * audio the student has already heard, and every mode change would cost quota.
 */
export function speechKeyFor(input: { text: string; voice: string }): string {
  return createHash("sha1").update(`${input.voice}|${input.text}`).digest("hex");
}

/**
 * Bytes for a pre-generated line, or null when the committed bank has no file
 * for the key. Only `data/phrases/` is consulted, so a caller that is deciding
 * whether a line still has to be rendered (scripts/generate-phrases.ts) is not
 * fooled by a runtime copy of the same line sitting in the cache folder.
 */
export async function readPhraseAudio(key: string): Promise<Buffer | null> {
  return readClip("phrases", key);
}

/**
 * Bytes for a key, or null when nothing has been written for it. Pre-generated
 * phrase files are checked first: a phrase key is served from its committed file
 * even if a cached copy of the same text exists.
 */
export async function readSpeechAudio(key: string): Promise<Buffer | null> {
  return (await readPhraseAudio(key)) ?? (await readClip("speech", key));
}

/** One file out of one folder, with the key checked before it reaches a path. */
async function readClip(
  folder: "phrases" | "speech",
  key: string
): Promise<Buffer | null> {
  if (!isValidSpeechKey(key)) return null;

  try {
    const bytes = await readFile(path.join(dirFor(folder), `${key}.wav`));
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Cache ceiling. Every spoken sentence lands here, so without a limit the folder
 * would grow for as long as the app is used. Oldest first, phrases never. The
 * count is generous — the point is a slow-moving bound on disk use, not a
 * tight cache — and deleting a file that a request is reading only costs that
 * one request a re-synthesis.
 */
export const MAX_CACHED_CLIPS = 400;

/** Save a runtime-synthesized chunk into the cache folder. */
export async function saveSpeechAudio(key: string, bytes: Buffer): Promise<void> {
  await writeSpeechFile("speech", key, bytes);
}

/** Keep the newest `limit` cached clips and drop the rest. Best effort. */
export async function pruneSpeechCache(limit = MAX_CACHED_CLIPS): Promise<void> {
  const dir = dirFor("speech");
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((name) => name.endsWith(".wav"));
  } catch {
    return;
  }
  if (entries.length <= limit) return;

  const stamped = await Promise.all(
    entries.map(async (name) => ({
      name,
      at: await stat(path.join(dir, name))
        .then((info) => info.mtimeMs)
        .catch(() => 0),
    }))
  );
  stamped.sort((a, b) => b.at - a.at);

  await Promise.all(
    stamped.slice(limit).map((entry) =>
      unlink(path.join(dir, entry.name)).catch(() => {
        // Already gone — nothing to clean up.
      })
    )
  );
}

/** Save a pre-generated phrase into the committed folder. */
export async function savePhraseAudio(key: string, bytes: Buffer): Promise<void> {
  await writeSpeechFile("phrases", key, bytes);
}

async function writeSpeechFile(
  folder: "phrases" | "speech",
  key: string,
  bytes: Buffer
): Promise<void> {
  if (!isValidSpeechKey(key)) throw new Error(`Unsafe speech key: ${key}`);
  if (bytes.length === 0) throw new Error("Refusing to write empty audio");

  const dir = dirFor(folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${key}.wav`), bytes);
}
