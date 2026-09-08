import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Text-to-speech for AI responses (feature 6.1) via the browser
 * speechSynthesis API — no API key needed.
 */
const emptySubscribe = () => () => {};

/** Client-only: true when the browser supports speech synthesis. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false
  );
}

export function useSpeechSynthesis() {
  const supported = useSupported();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
    currentRef.current = null;
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, text: string, lang: string) => {
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

    utterance.onend = () => {
      currentRef.current = null;
      setSpeakingId(null);
    };
    utterance.onerror = () => {
      currentRef.current = null;
      setSpeakingId(null);
    };

    currentRef.current = id;
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => stop, [stop]);

  return { supported, speakingId, speak, stop };
}