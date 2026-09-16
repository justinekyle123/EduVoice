// Gemini TTS prebuilt voices (from the speech-generation docs). Shared between
// the client and the server, so it must stay dependency-free: the server action
// (server/tts.ts) validates against these tables and the client sends the keys.
//
// EduVoice speaks with one voice: Puck. Its upbeat tone keeps a study session
// feeling encouraging, and staying on a single voice means every spoken reply
// hits the same cached audio and there is no voice to pick or mis-configure.
// The list stays an array so more options can be added later — the pickers in
// the UI only appear once there is more than one (see `hasVoiceChoice`).
export const TTS_VOICES = [{ name: "Puck", description: "Upbeat" }] as const;

export const DEFAULT_TTS_VOICE = "Puck";

export const TTS_VOICE_NAMES = new Set<string>(TTS_VOICES.map((v) => v.name));

/** True when there is actually a choice to offer the student. */
export const hasVoiceChoice = TTS_VOICES.length > 1;

/** Returns the given voice if it's a known Gemini TTS voice, else the default. */
export function resolveTtsVoice(voice: string | undefined): string {
  return voice && TTS_VOICE_NAMES.has(voice) ? voice : DEFAULT_TTS_VOICE;
}

// ---------------------------------------------------------------------------
// Speech styles — how Puck should read a reply
// ---------------------------------------------------------------------------

/**
 * How Puck should read a reply, one profile per study mode:
 *
 *   tutor (Chat)      warm and unhurried — the default explaining voice
 *   hint (Hint Mode)  slower and softer, so a clue lands before the answer
 *   debate            firm and lively, matching the back-and-forth of arguing
 *   interview         brisk and businesslike, like a real interviewer
 *
 * The interactions API's generation config exposes no rate, pitch or
 * temperature — only the voice and its language — so pacing and tone are
 * directed through the prompt itself. That is Gemini's documented style
 * control ("Say cheerfully: …"), and the direction is performed rather than
 * read aloud.
 */
export type VoiceStyle = "tutor" | "hint" | "debate" | "interview";

export type VoiceStyleProfile = {
  /** Short description shown next to the mode in voice mode's header. */
  label: string;
  /** Direction placed in front of the reply. Never spoken — it is performed. */
  instruction: string;
};

export const VOICE_STYLES: Record<VoiceStyle, VoiceStyleProfile> = {
  tutor: {
    label: "warm tutor",
    instruction:
      "Say the following in a warm, clear, unhurried tutor voice, with a short pause between ideas:",
  },
  hint: {
    label: "calm hint",
    instruction:
      "Say the following slowly and gently, in a calm, patient tutor voice that guides the student toward the answer without rushing:",
  },
  debate: {
    label: "lively debate",
    instruction:
      "Say the following in a confident, energetic debater's voice — firm, lively and persuasive:",
  },
  interview: {
    label: "crisp interview",
    instruction:
      "Say the following in a crisp, professional interviewer's voice — brisk and businesslike, with no filler:",
  },
};

export const VOICE_STYLE_NAMES = new Set<string>(Object.keys(VOICE_STYLES));

/** Any unknown or missing style falls back to the plain tutoring voice. */
export function resolveVoiceStyle(style: string | undefined): VoiceStyle {
  return style && VOICE_STYLE_NAMES.has(style) ? (style as VoiceStyle) : "tutor";
}

/** The speech style that fits a chat mode id. */
export function voiceStyleForMode(mode: string | undefined): VoiceStyle {
  return mode === "hint" || mode === "debate" || mode === "interview"
    ? mode
    : "tutor";
}
