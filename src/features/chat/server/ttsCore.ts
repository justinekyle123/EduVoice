import {
  resolveTtsVoice,
  resolveVoiceStyle,
  VOICE_STYLES,
} from "../lib/voices";
import { withGeminiKey } from "@/lib/ai/keys";

// Gemini text-to-speech: build the request, wrap the audio.
//
// Auth-free on purpose — the server action in ./tts.ts adds the signed-in check
// — so this file can be exercised directly (diagnostics, scripts). It uses the
// same rotating key pool as the chat model (see lib/ai/keys.ts), so spoken
// replies also spread across the free tiers of every configured AI Studio
// account.
//
// Model + voice are overridable via env vars:
//   GEMINI_TTS_MODEL — default gemini-3.1-flash-tts-preview
//   GEMINI_TTS_VOICE — one of the voices in ../lib/voices.ts, default Puck
//
// Style: the generation config has no rate, pitch or temperature field, so each
// study mode sends a style key that we translate into a direction placed in
// front of the reply (see VOICE_STYLES in ../lib/voices.ts). Tutor reads warm
// and unhurried, Hint slower and softer, Interview brisk — the direction is
// performed by the model, not spoken.
//
// The model auto-detects the input language, so English, Filipino, and Cebuano
// replies are all spoken correctly. It only returns uncompressed PCM audio
// (24 kHz, 16-bit, mono), which we wrap in a WAV header so the browser can play
// it directly.

const ttsModel = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
// Keep responses small (PCM ≈ 48 KB/sec before base64): cap very long replies.
const MAX_TTS_CHARS = 1200;

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

export type SynthesizeSpeechInput = {
  text: string;
  /** Gemini TTS voice name (from `lib/voices`); falls back to the default. */
  voice?: string;
  /** Study-mode speech style key (from `lib/voices`); unknown → "tutor". */
  style?: string;
  /** Optional shorter limit for voice mode, which reduces time-to-first-audio. */
  maxChars?: number;
};

/** Request speech and wrap it as a playable WAV data URI. */
export async function synthesizeSpeechAudio(
  input: SynthesizeSpeechInput
): Promise<{ audio: string } | { error: string }> {
  const text = input.text.trim();
  if (!text) return { error: "Nothing to speak" };

  const voice = resolveTtsVoice(input.voice ?? process.env.GEMINI_TTS_VOICE);
  const style = resolveVoiceStyle(input.style);
  // Voice mode favors a quick first spoken answer. Keep normal Listen playback
  // at the existing limit, while allowing the hands-free path to request a
  // shorter, more conversational opening.
  const maxChars = Math.max(
    320,
    Math.min(input.maxChars ?? MAX_TTS_CHARS, MAX_TTS_CHARS)
  );
  const spoken =
    text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;

  try {
    const { value: interaction } = await withGeminiKey((client) =>
      client.interactions.create({
        model: ttsModel,
        // The style direction is performed, not read out: the model voices the
        // reply that follows it. Truncate first, so the direction is never the
        // part that gets cut.
        input: `${VOICE_STYLES[style].instruction}\n\n${spoken}`,
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [{ voice }],
        },
      })
    );

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
