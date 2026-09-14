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

export type SpeechRecognitionOptions = {
  /**
   * Keep one recognition session open across pauses instead of ending it at the
   * first full stop. Long dictation (a task, its day, and its time) arrives in
   * several breaths, so callers that buffer the transcript want this on; the
   * chat composer appends each phrase and takes the default.
   */
  continuous?: boolean;
};

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
    (lang: string, options: SpeechRecognitionOptions = {}) => {
      const Ctor = getRecorderCtor();
      if (!Ctor) return;
      recorderRef.current?.abort();

      const recorder = new Ctor();
      recorder.lang = lang;
      recorder.interimResults = true;
      recorder.continuous = options.continuous ?? false;
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

  /**
   * End the session and drop anything not yet confirmed. Callers that have
   * already taken what they need use this instead of `stop()`: the graceful stop
   * can hand back one last final result, which would look like a second turn.
   */
  const abort = useCallback(() => {
    recorderRef.current?.abort();
    setListening(false);
  }, []);

  return { supported, listening, interim, start, stop, abort };
}