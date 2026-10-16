import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTtsVoice, resolveVoiceStyle } from "@/features/chat/lib/voices";
import { synthesizeSpeechBytes } from "@/features/chat/server/ttsCore";
import {
  isValidSpeechKey,
  pruneSpeechCache,
  readSpeechAudio,
  saveSpeechAudio,
  speechKeyFor,
} from "@/features/chat/server/speechStore";

// Speech for voice mode, chat playback and the pre-generated phrase bank.
//
// POST  { text, voice?, style?, key? } → audio/wav bytes
//   • if `key` (or the hash of voice+style+text) already has a file on disk, the
//     bytes are served straight from it — no Gemini request, no base64, no
//     re-decoding — which is what makes the mode openers free to replay.
//   • otherwise the chunk is synthesized once, written to data/speech/<key>.wav
//     and returned. Every later request for the same words is a disk read.
//
// Returning the WAV body rather than a JSON data URI keeps a spoken chunk a
// third smaller and lets the browser decode it directly into the audio graph.
//
// A 200 always means "playable bytes". A 502 carries the TTS error, which the
// client reports to the student as "voice unavailable" — the browser's own
// voices are never used as a stand-in, so a failed synthesis leaves the reply
// on screen and unspoken.

export const dynamic = "force-dynamic";

/** Longest single request we accept, to bound one synthesis. */
const MAX_REQUEST_CHARS = 2000;

type SpeechRequest = {
  text?: string;
  voice?: string;
  style?: string;
  key?: string;
};

function wavResponse(bytes: Buffer, key: string, cache: "hit" | "miss") {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.length),
      // Private: a spoken reply belongs to the signed-in student, so no shared
      // cache may keep a copy. The client caches chunks in memory itself.
      "Cache-Control": "private, max-age=86400",
      "X-Speech-Key": key,
      "X-Speech-Cache": cache,
    },
  });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: SpeechRequest;
  try {
    body = (await request.json()) as SpeechRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Nothing to speak" }, { status: 400 });
  }
  if (text.length > MAX_REQUEST_CHARS) {
    return NextResponse.json(
      { error: "That passage is too long to speak in one request" },
      { status: 413 }
    );
  }

  const voice = resolveTtsVoice(body.voice);
  const style = resolveVoiceStyle(body.style);
  // The style is passed to the synthesizer below but not to the key: a passage
  // is recorded once per voice, and later requests replay that recording.
  const key =
    body.key && isValidSpeechKey(body.key)
      ? body.key
      : speechKeyFor({ text, voice });

  const cached = await readSpeechAudio(key);
  if (cached) return wavResponse(cached, key, "hit");

  const result = await synthesizeSpeechBytes({ text, voice, style });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Cache only what we actually spoke: a truncated render must not be stored
  // under the key for the full text, or the short version would be replayed
  // instead of a complete one.
  if (!result.truncated) {
    await saveSpeechAudio(key, result.bytes).catch(() => {
      // A read-only filesystem only costs us the cache, not the reply.
    });
    // Keep the folder from growing forever; the newest clips are the ones a
    // student is likely to hear again.
    void pruneSpeechCache().catch(() => {});
  }

  return wavResponse(result.bytes, key, "miss");
}
