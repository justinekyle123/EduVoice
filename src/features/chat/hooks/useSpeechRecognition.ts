"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

export type SpeechRecognitionError = {
  /** Raw Web Speech API code, e.g. "not-allowed". */
  code: string;
  /** Ready-to-show explanation for the student. */
  message: string;
};

function getRecorderCtor(): (new () => RecognitionRecorder) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionRecorder;
    webkitSpeechRecognition?: new () => RecognitionRecorder;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Errors the student should hear about, mapped to plain language. */
const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked. Allow the mic for this site, then try again.",
  "service-not-allowed":
    "This browser won't allow speech recognition. You can still type your question.",
  "audio-capture": "No microphone was found. Check your input device.",
  network: "Voice input lost its connection. Check your internet and try again.",
  "language-not-supported":
    "This browser can't listen in that language — try English.",
};

/** Codes that are just normal session churn, not something to report. */
const SILENT_ERRORS = new Set(["no-speech", "aborted", "audio-busy"]);

/** Codes that mean restarting the recognizer is pointless. */
const BLOCKING_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
]);

export type SpeechRecognitionOptions = {
  /**
   * Keep one recognition session open across pauses instead of ending it at the
   * first full stop. Long dictation (a task, its day, and its time) arrives in
   * several breaths, so callers that buffer the transcript want this on; the
   * chat composer appends each phrase and takes the default.
   */
  continuous?: boolean;
  /**
   * Keep words that were only heard as *interim* results when the browser ends
   * a session by itself (Chrome closes one after a few seconds of silence).
   * Voice mode restarts the recognizer constantly; without this, the first half
   * of a long question silently disappears.
   */
  keepInterim?: boolean;
};

const emptySubscribe = () => () => {};

/** Client-only: true when the browser supports speech recognition. */
function useSupported() {
  return useSyncExternalStore(
    emptySubscribe,
    () => getRecorderCtor() !== null,
    () => false
  );
}

function join(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Voice input via the browser Web Speech API (no API key needed).
 * Calls `onTranscript(final, interim)` as results arrive.
 */
export function useSpeechRecognition(
  onTranscript: (finalText: string, interimText: string) => void
) {
  const supported = useSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechRecognitionError | null>(null);
  const [blocked, setBlocked] = useState(false);
  const recorderRef = useRef<RecognitionRecorder | null>(null);
  const callbackRef = useRef(onTranscript);
  // Words heard in *earlier* sessions of the same turn, and the live interim of
  // the current session. Together they make up what the student has said so far.
  const committedRef = useRef("");
  const liveInterimRef = useRef("");
  const keepInterimRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(
    () => () => {
      recorderRef.current?.abort();
    },
    []
  );

  /** Drop everything heard so far — called when a new turn starts. */
  const clearInterim = useCallback(() => {
    committedRef.current = "";
    liveInterimRef.current = "";
    setInterim("");
  }, []);

  /** Everything heard since the last clear, including live interim words. */
  const getInterim = useCallback(
    () => (keepInterimRef.current
      ? join(committedRef.current, liveInterimRef.current)
      : liveInterimRef.current),
    []
  );

  const start = useCallback(
    (lang: string, options: SpeechRecognitionOptions = {}) => {
      const Ctor = getRecorderCtor();
      if (!Ctor) return;
      keepInterimRef.current = options.keepInterim ?? false;
      if (!keepInterimRef.current) clearInterim();
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
        // Ignore callbacks from a recorder that was replaced or aborted. This
        // prevents an old browser session from ending a newly started turn.
        if (recorderRef.current !== recorder) return;

        setBlocked(false);
        setError(null);
        liveInterimRef.current = interimText;
        setInterim(
          keepInterimRef.current
            ? join(committedRef.current, interimText)
            : interimText
        );

        if (finalText) {
          // A session that restarted mid-question contributes its earlier
          // words to this same turn.
          const full = join(committedRef.current, finalText);
          committedRef.current = "";
          liveInterimRef.current = "";
          setInterim("");
          callbackRef.current(full, "");
        }
      };
      recorder.onend = () => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        setListening(false);
        if (keepInterimRef.current) {
          // The browser closed its own session — hold on to the partial words
          // so the caller can restart without losing the start of the sentence.
          committedRef.current = join(
            committedRef.current,
            liveInterimRef.current
          );
          liveInterimRef.current = "";
          setInterim(committedRef.current);
        } else {
          setInterim("");
        }
      };
      recorder.onerror = (event) => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        setListening(false);

        const code = event.error || "unknown";
        if (keepInterimRef.current) {
          committedRef.current = join(
            committedRef.current,
            liveInterimRef.current
          );
          liveInterimRef.current = "";
          setInterim(committedRef.current);
        } else {
          setInterim("");
        }

        if (SILENT_ERRORS.has(code)) return;
        if (BLOCKING_ERRORS.has(code)) setBlocked(true);
        setError({
          code,
          message:
            ERROR_MESSAGES[code] ??
            "Voice input stopped unexpectedly. Tap the mic to try again.",
        });
      };
      recorderRef.current = recorder;
      try {
        recorder.start();
        setListening(true);
        setError(null);
      } catch {
        // Browsers throw when start() is called while permission is pending or
        // another recognition session is still shutting down.
        if (recorderRef.current === recorder) recorderRef.current = null;
        setListening(false);
      }
    },
    [clearInterim]
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorder?.stop();
    if (keepInterimRef.current) {
      committedRef.current = join(committedRef.current, liveInterimRef.current);
      liveInterimRef.current = "";
      setInterim(committedRef.current);
    } else {
      setInterim("");
    }
    setListening(false);
  }, []);

  /**
   * End the session and drop anything not yet confirmed. Callers that have
   * already taken what they need use this instead of `stop()`: the graceful stop
   * can hand back one last final result, which would look like a second turn.
   */
  const abort = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorder?.abort();
    setInterim("");
    setListening(false);
  }, []);

  return {
    supported,
    listening,
    interim,
    error,
    /** True when the browser refused the mic — don't keep retrying. */
    blocked,
    start,
    stop,
    abort,
    clearInterim,
    getInterim,
  };
}
