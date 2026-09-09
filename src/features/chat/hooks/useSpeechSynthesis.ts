import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { synthesizeSpeech } from "../server/tts";
import { DEFAULT_TTS_VOICE } from "../lib/voices";

/**
 * Text-to-speech for AI responses (feature 6.1).
 *
 * Primary: Gemini TTS via a server action (Google AI Studio free tier) for
 * natural voices in English, Filipino, and Cebuano. Audio is cached per text
 * so replaying a message doesn't re-call the API.
 *
 * Fallback: the browser speechSynthesis API (offline, no quota) whenever the
 * Gemini call fails (missing API key, rate limit, network error, …).
 */

const emptySubscribe = () => () => {};

const audioCache = new Map<string, string>();

/** Client-only: true when audio playback or speech synthesis is possible. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof window !== "undefined" &&
      (typeof Audio !== "undefined" || "speechSynthesis" in window),
    () => false
  );
}

export function useSpeechSynthesis() {
  const supported = useSupported();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const clearSpeaking = useCallback(() => {
    currentRef.current = null;
    setSpeakingId(null);
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    clearSpeaking();
  }, [clearSpeaking]);

  /** Play a (cached) data URI through a fresh <audio> element. */
  const playAudio = useCallback(
    (id: string, uri: string) => {
      if (typeof window === "undefined") return;
      const audio = new Audio(uri);
      audioRef.current = audio;
      audio.onended = () => {
        audioRef.current = null;
        clearSpeaking();
      };
      audio.onerror = () => {
        audioRef.current = null;
        clearSpeaking();
      };
      currentRef.current = id;
      setSpeakingId(id);
      void audio.play().catch(() => {
        audioRef.current = null;
        clearSpeaking();
      });
    },
    [clearSpeaking]
  );

  /** Fallback path using the browser's built-in voices. */
  const speakBrowser = useCallback(
    (id: string, text: string, lang: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1;
      const voices = window.speechSynthesis.getVoices();
      const base = lang.split("-")[0].toLowerCase();
      const match =
        voices.find((v) => v.lang.toLowerCase().startsWith(base)) ??
        voices.find((v) => v.lang.toLowerCase().startsWith("en"));
      if (match) utterance.voice = match;

      utterance.onend = clearSpeaking;
      utterance.onerror = clearSpeaking;

      currentRef.current = id;
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [clearSpeaking]
  );

  const speak = useCallback(
    (id: string, text: string, lang: string, voice: string = DEFAULT_TTS_VOICE) => {
      if (typeof window === "undefined") return;
      stop();

      // Cache per voice so switching voices doesn't replay stale audio.
      const cacheKey = `${voice}|${text}`;
      const cached = audioCache.get(cacheKey);
      if (cached) {
        playAudio(id, cached);
        return;
      }

      synthesizeSpeech({ text, voice })
        .then((res) => {
          if ("error" in res) {
            throw new Error(res.error ?? "TTS failed");
          }
          audioCache.set(cacheKey, res.audio);
          playAudio(id, res.audio);
        })
        .catch(() => {
          // Gemini unavailable (no key / quota / network) — use built-in voices.
          speakBrowser(id, text, lang);
        });
    },
    [stop, playAudio, speakBrowser]
  );

  useEffect(() => stop, [stop]);

  return { supported, speakingId, speak, stop };
}