"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_TTS_VOICE, type VoiceStyle } from "../lib/voices";
import { getSpeechEngine, type SpeechSnapshot } from "../lib/speechEngine";

/**
 * Text-to-speech for AI responses (feature 6.1).
 *
 * Playback lives in one shared engine (lib/speechEngine.ts): Gemini TTS for
 * natural English/Filipino/Cebuano voices, chunked so audio starts as soon as
 * the first sentence is ready, with the browser's own voices as a fallback.
 * This hook is the React face of it — the speaking message id and helpers.
 */

const emptySubscribe = () => () => {};

/** Stable server snapshot (a fresh object here would loop the store). */
const IDLE: SpeechSnapshot = { speakingId: null, status: "idle", voice: "gemini" };

/** Client-only: true when audio can be played or synthesized. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof window !== "undefined" &&
      (typeof AudioContext !== "undefined" ||
        "webkitAudioContext" in window ||
        "speechSynthesis" in window),
    () => false
  );
}

export function useSpeechSynthesis() {
  const supported = useSupported();
  const snapshot: SpeechSnapshot = useSyncExternalStore(
    getSpeechEngine().subscribe,
    getSpeechEngine().getSnapshot,
    () => IDLE
  );

  const speak = useCallback(
    (
      id: string,
      text: string,
      lang: string,
      voice: string = DEFAULT_TTS_VOICE,
      options?: { maxChars?: number; style?: VoiceStyle }
    ) => {
      getSpeechEngine().speak(id, text, lang, voice, options);
    },
    []
  );

  const stop = useCallback(() => getSpeechEngine().stop(), []);

  return {
    supported,
    speakingId: snapshot.speakingId,
    /** True while audio for a message is loading or playing. */
    speaking: snapshot.status !== "idle",
    /**
     * Voice the current audio came from: "browser" means Gemini TTS was
     * unavailable (usually a spent free-tier quota) and the fallback is in use.
     */
    voice: snapshot.voice,
    speak,
    stop,
  };
}
