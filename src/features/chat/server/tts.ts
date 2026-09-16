"use server";

import { auth } from "@clerk/nextjs/server";
import {
  synthesizeSpeechAudio,
  type SynthesizeSpeechInput,
} from "./ttsCore";

// Server action for the "Listen" button and voice mode. The request shape, the
// per-mode speech style and the WAV wrapping live in ./ttsCore.ts; this file
// only gates it on a signed-in student.

export type { SynthesizeSpeechInput };

/** Synthesize speech for a signed-in student. Returns a playable WAV data URI. */
export async function synthesizeSpeech(input: SynthesizeSpeechInput) {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };
  return synthesizeSpeechAudio(input);
}
