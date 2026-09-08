import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionResult = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  resultIndex: number;
};

type RecognitionRecorder = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionResult) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecorderCtor(): (new () => RecognitionRecorder) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionRecorder;
    webkitSpeechRecognition?: new () => RecognitionRecorder;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Voice input via the browser Web Speech API (no API key needed).
 * Calls `onTranscript(final, interim)` as results arrive.
 */
const emptySubscribe = () => () => {};

/** Client-only: true when the browser supports speech recognition. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () => getRecorderCtor() !== null,
    () => false
  );
}

export function useSpeechRecognition(
  onTranscript: (finalText: string, interimText: string) => void
) {
  const supported = useSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recorderRef = useRef<RecognitionRecorder | null>(null);

  useEffect(
    () => () => {
      recorderRef.current?.abort();
    },
    []
  );

  const start = useCallback(
    (lang: string) => {
      const Ctor = getRecorderCtor();
      if (!Ctor) return;
      recorderRef.current?.abort();

      const recorder = new Ctor();
      recorder.lang = lang;
      recorder.interimResults = true;
      recorder.continuous = false;
      recorder.onresult = (e) => {
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += transcript;
          else interimText += transcript;
        }
        if (finalText) onTranscript(finalText, interimText);
        setInterim(interimText);
      };
      recorder.onend = () => setListening(false);
      recorder.onerror = () => setListening(false);
      recorder.start();
      recorderRef.current = recorder;
      setListening(true);
    },
    [onTranscript]
  );

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, interim, start, stop };
}