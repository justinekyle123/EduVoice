"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_TTS_VOICE, type VoiceStyle } from "../lib/voices";
import { getSpeechEngine, type SpeechSnapshot } from "../lib/speechEngine";

/**
 * Text-to-speech for AI responses (feature 6.1).
 *
 * Playback lives in one shared engine (lib/speechEngine.ts): Gemini TTS for
 * natural English/Filipino/Cebuano voices, grouped so a reply is one request —
 * one continuous recording rather than two takes. The browser's own voices are
 * deliberately never used, so a reply that cannot be synthesized stays silent
 * and `unavailable` says so. This hook is the React face of it — the speaking
 * message id and helpers.
 */

const emptySubscribe = () => () => {};

/** Stable server snapshot (a fresh object here would loop the store). */
const IDLE: SpeechSnapshot = {
  speakingId: null,
  status: "idle",
  unavailable: false,
};

/** Client-only: true when audio can be played at all. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof window !== "undefined" &&
      (typeof AudioContext !== "undefined" || "webkitAudioContext" in window),
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

  /**
   * Speak a line from the pre-generated bank (lib/phrases.ts) by its file key.
   * The words are the ones already rendered under `data/phrases/<key>.wav`, so
   * the line is a disk read rather than a TTS request — and if the file is not
   * there yet, it is synthesized once and saved under that same key.
   */
  const speakLine = useCallback(
    (
      id: string,
      options: {
        key: string;
        text: string;
        lang: string;
        voice?: string;
        style?: VoiceStyle;
      }
    ) => {
      getSpeechEngine().speakLine(id, {
        key: options.key,
        text: options.text,
        lang: options.lang,
        voice: options.voice ?? DEFAULT_TTS_VOICE,
        style: options.style,
      });
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
     * True when Gemini TTS could not speak the current or last reply, so it went
     * unspoken. The browser's own voices are never used in its place.
     */
    unavailable: snapshot.unavailable,
    speak,
    speakLine,
    stop,
  };
}
