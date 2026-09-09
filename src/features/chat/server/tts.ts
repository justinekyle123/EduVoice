"use server";

import { auth } from "@clerk/nextjs/server";
import { GoogleGenAI } from "@google/genai";
import { resolveTtsVoice } from "../lib/voices";

// Server-only Gemini text-to-speech for the "Listen" button (replaces the
// browser's built-in voices). Uses the same GEMINI_API_KEY as the chat model,
// so it works on the free tier without extra setup.
//
// Model + voice are overridable via env vars:
//   GEMINI_TTS_MODEL — default gemini-3.1-flash-tts-preview
//   GEMINI_TTS_VOICE — one of the 30 prebuilt voices, default Sulafat (warm)
//
// The TTS model auto-detects the input language, so English, Filipino, and
// Cebuano replies are all spoken correctly. The model only returns uncompressed
// PCM audio (24 kHz, 16-bit, mono), which we wrap in a WAV header so the
// browser can play it directly.

const ttsModel = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
// Keep responses small (PCM ≈ 48 KB/sec before base64): cap very long replies.
const MAX_TTS_CHARS = 1200;

let ai: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com/app/apikey and add it to .env"
    );
  }
  ai ??= new GoogleGenAI({ apiKey });
  return ai;
}

/** Wrap raw PCM samples in a RIFF/WAVE header so browsers can play them. */
function pcmToWavDataUri(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample = 16
): string {
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  buffer.writeUInt16LE(1, 20); // audio format: PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byte rate
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);

  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

/** Synthesize speech for a piece of text. Returns a playable WAV data URI. */
export async function synthesizeSpeech(input: {
  text: string;
  /** Gemini TTS voice name (from `lib/voices`); falls back to the default. */
  voice?: string;
}): Promise<{ audio: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Not authenticated" };

  const text = input.text.trim();
  if (!text) return { error: "Nothing to speak" };

  const voice = resolveTtsVoice(input.voice ?? process.env.GEMINI_TTS_VOICE);

  try {
    const interaction = await getClient().interactions.create({
      model: ttsModel,
      input: text.slice(0, MAX_TTS_CHARS),
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice }],
      },
    });

    const audio = interaction.output_audio;
    if (!audio?.data) return { error: "No audio returned" };

    const pcm = Buffer.from(audio.data, "base64");
    return {
      audio: pcmToWavDataUri(pcm, audio.sample_rate ?? 24000, audio.channels ?? 1),
    };
  } catch (err) {
    console.error("[tts] Gemini TTS failed:", err);
    return { error: err instanceof Error ? err.message : "TTS failed" };
  }
}