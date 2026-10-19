"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { detectLanguage, speechLangFor } from "../lib/detect";
import { isStopRequest } from "../lib/interrupt";
import { openerFor } from "../lib/phrases";
import { SPEECH_BUDGET } from "../lib/speech";
import { voiceStyleForMode, type VoiceStyle } from "../lib/voices";
import { getSpeechEngine, type SpeechStream } from "../lib/speechEngine";
import { useMicStream } from "./useMicStream";
import { useSpeechRecognition } from "./useSpeechRecognition";

// The voice conversation itself: turn taking, endpointing and barge-in.
//
// Everything that makes voice mode feel like a phone call rather than a
// push-to-talk button lives here:
//
//   endpointing  the mic level decides when the student has stopped talking, so
//                the question is sent the moment they pause instead of waiting
//                for the browser to finalize its text.
//   barge-in     saying an explicit stop word ("stop", "wait", "sandali lang",
//                "hunong sa") stops the audio and takes the turn the way you
//                interrupt a person mid-sentence. The microphone level alone
//                never interrupts: a cough, a chair, or the tutor's own voice
//                leaking through the speakers must not cut an answer off.
//   one take     reply text goes into the speech engine as it arrives and the
//                answer is spoken as a single recording, so the voice never
//                changes tone halfway through it.
//   greeting     the call opens with the mode's fixed line, played from the
//                pre-generated phrase bank rather than synthesized again.
//   resilience   the recognizer is restarted across the browser's own session
//                timeouts without losing words that were only heard as interim.

export type VoicePhase = "listening" | "thinking" | "speaking" | "muted";

export type VoiceTurnMeta = {
  sessionId: string;
  createdSession: {
    id: string;
    title: string | null;
    mode: string;
    language: string | null;
  } | null;
  userMessage: {
    id: string;
    role: string;
    content: string;
    language: string | null;
    tone: string | null;
  };
  language: string;
};

export type VoiceTurnHandlers = {
  /** The turn was saved — the student's message now exists on the server. */
  onTurn?: (meta: VoiceTurnMeta) => void;
  /** A fragment of the reply. */
  onDelta?: (text: string) => void;
  /** The reply finished (or failed). */
  onDone?: (info: {
    assistantMessage: { id: string; content: string } | null;
    error?: string | null;
  }) => void;
};

/** Talks to the server. Implemented in ChatUI, which owns the thread state. */
export type VoiceTransport = (
  text: string,
  handlers: VoiceTurnHandlers,
  signal: AbortSignal
) => Promise<void>;

export type VoiceLogEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** Silence after speech that ends the student's turn. */
const END_OF_SPEECH_SILENCE_MS = 1200;
/** Words needed before a pause may end the turn (protects "so… um…"). */
const MIN_SILENCE_WORDS = 3;
/** RMS above which we count as "the student is talking". */
const SPEECH_RMS = 0.02;
/**
 * Characters spoken per reply; the rest stays on screen.
 *
 * The same number the one-shot "Listen" path uses, on purpose: a reply must be
 * cut into the same chunks whether it is streamed live or replayed later, or the
 * replay would be cut differently and have to be synthesized again.
 *
 * Generous because voice mode's instruction asks the tutor for three or four
 * sentences — the budget exists to stop one pathological answer from eating the
 * whole TTS quota, not to shorten normal answers. A normal answer is well under
 * it, so it is still spoken as one take, and only an unusually long one is cut
 * into a second.
 */
const SPOKEN_BUDGET = SPEECH_BUDGET;

/** Log id of the opening line, so it is never mistaken for a saved message. */
const GREETING_ID = "greeting";

/** Browsers rarely offer Cebuano recognition — step down to what they support. */
const LANG_FALLBACK: Record<string, string> = {
  "ceb-PH": "fil-PH",
  "fil-PH": "en-PH",
};

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Stable server/initial snapshot for the engine subscription. */
const IDLE_SPEECH = {
  speakingId: null as string | null,
  status: "idle" as const,
  unavailable: false,
};

export function useVoiceSession(options: {
  /** Default recognition language (the session's detected language). */
  lang: string;
  ttsVoice: string;
  /** Chat mode id — picks how the tutor reads its replies. */
  mode: string;
  transport: VoiceTransport;
  /** Called with the saved turn, so the chat thread can follow along. */
  onTurn?: (meta: VoiceTurnMeta) => void;
  onEnd: () => void;
}) {
  const { lang, ttsVoice, mode, transport, onTurn, onEnd } = options;
  const engine = useMemo(() => getSpeechEngine(), []);
  const style: VoiceStyle = voiceStyleForMode(mode);
  /**
   * Fixed opening line for this mode (lib/phrases.ts), or null. Chosen once per
   * call — the transcript shows the same take that is being played, and a
   * remount (the next time voice mode opens) rolls a fresh one.
   */
  const [opener] = useState(() => openerFor(mode));

  // Whether the last reply could actually be spoken — the student is told when
  // it could not, instead of being left with unexplained silence.
  const speech = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    () => IDLE_SPEECH
  );

  // A call that opens with a spoken line starts in the speaking phase and shows
  // that line in the transcript from the first paint, so the greeting never
  // needs a state update from inside an effect.
  const [phase, setPhase] = useState<VoicePhase>(
    opener ? "speaking" : "listening"
  );
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<VoiceLogEntry[]>(() =>
    opener ? [{ id: GREETING_ID, role: "assistant", text: opener.text }] : []
  );
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  /** Student stopped talking → first reply text. Shown as proof of the pace. */
  const [firstWordMs, setFirstWordMs] = useState(0);
  const [listenLang, setListenLang] = useState(lang);

  // -------------------------------------------------------------------------
  // Refs (all declared up front — the callbacks below close over them)
  // -------------------------------------------------------------------------

  const streamRef = useRef<SpeechStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const streamDoneRef = useRef(true);
  const interruptedRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("listening");
  const mutedRef = useRef(false);
  const lastUserRef = useRef("");
  const seqRef = useRef(0);
  const turnStartedRef = useRef(0);
  /** Student has said something in the current listening turn. */
  const spokeRef = useRef(false);
  const lastLoudAtRef = useRef(0);
  /** Delay before reopening the mic, doubled after each recognition failure. */
  const restartDelayRef = useRef(120);
  const sessionStartedRef = useRef(0);
  /** Recognition language already attempted, so fallbacks can't loop. */
  const attemptedLangRef = useRef("");

  const transportRef = useRef(transport);
  const onEndRef = useRef(onEnd);
  const onTurnRef = useRef<(meta: VoiceTurnMeta) => void>(() => {});
  const handleFinalRef = useRef<(text: string) => void>(() => {});
  const handleInterimRef = useRef<(text: string) => void>(() => {});
  const submitRef = useRef<(text: string) => void>(() => {});
  const stopRecognitionRef = useRef<() => void>(() => {});
  const getInterimRef = useRef<() => string>(() => "");
  const interruptRef = useRef<() => void>(() => {});

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (onTurn) onTurnRef.current = onTurn;
  }, [onTurn]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // -------------------------------------------------------------------------
  // Microphone + recognition
  // -------------------------------------------------------------------------

  // The mic stream is only live while the student can actually be heard: mute
  // and the browser's mic indicator go off together.
  const mic = useMicStream(!muted);
  const micLevel = mic.levelRef;

  const recognition = useSpeechRecognition(
    (finalText) => handleFinalRef.current(finalText),
    (interimText) => handleInterimRef.current(interimText)
  );
  const {
    start: startRecognition,
    abort: abortRecognition,
    listening: recognitionListening,
    blocked: recognitionBlocked,
    clearInterim,
    getInterim,
  } = recognition;

  /**
   * A completed utterance while listening is one turn. While the tutor is
   * composing or speaking, the only thing an utterance can do is stop it — and
   * only when it is an explicit stop request (lib/interrupt.ts), so the tutor's
   * own voice is never mistaken for the student cutting in.
   */
  useEffect(() => {
    handleFinalRef.current = (text: string) => {
      if (phaseRef.current === "listening") {
        submitRef.current(text);
        return;
      }
      if (interruptedRef.current) return;
      if (isStopRequest(text)) interruptRef.current();
    };
  }, []);

  /**
   * The same check on interim words: the browser may only commit an utterance
   * after a pause, and a student saying "stop" should not have to wait through
   * the rest of the sentence to be heard.
   */
  useEffect(() => {
    handleInterimRef.current = (text: string) => {
      const current = phaseRef.current;
      if (current !== "speaking" && current !== "thinking") return;
      if (interruptedRef.current) return;
      if (isStopRequest(text)) interruptRef.current();
    };
  }, []);

  useEffect(() => {
    stopRecognitionRef.current = abortRecognition;
  }, [abortRecognition]);

  useEffect(() => {
    getInterimRef.current = getInterim;
  }, [getInterim]);

  // Keep the recognizer open for the whole call — listening, thinking and
  // speaking — restarting it across the browser's own silence timeouts (and
  // across turns). It has to be open while the tutor talks, or there is no way
  // to hear "stop" over the answer. Repeated failures back off instead of
  // hammering the API.
  useEffect(() => {
    if (muted || recognitionBlocked) return;
    if (phase === "muted" || recognitionListening) return;

    // Some languages simply aren't served (Cebuano on most browsers), so step
    // down to the closest supported one — but only once per language, or the
    // fallback would retry itself forever.
    let attempt = listenLang;
    if (
      recognition.error?.code === "language-not-supported" &&
      attemptedLangRef.current === attempt
    ) {
      attempt = LANG_FALLBACK[attempt] ?? attempt;
      restartDelayRef.current = 120;
    }
    attemptedLangRef.current = attempt;

    // While the tutor is talking, words must not be carried across a session
    // restart: they are the tutor's own voice leaking through the mic, and
    // keeping them would bury the student's "stop" under them.
    const timer = window.setTimeout(
      () =>
        startRecognition(attempt, {
          continuous: true,
          keepInterim: phase === "listening",
          // The mic must stay open while the tutor talks so "stop" can be
          // heard. Echo is handled here: only an explicit stop request acts on
          // those words, and the transcript is kept out of the UI.
          listenWhileSpeaking: true,
        }),
      restartDelayRef.current
    );
    return () => window.clearTimeout(timer);
  }, [
    muted,
    phase,
    listenLang,
    recognition.error,
    recognitionListening,
    recognitionBlocked,
    startRecognition,
  ]);

  // Repeated recognition failures back off instead of hammering the API.
  useEffect(() => {
    if (!recognition.error) return;
    restartDelayRef.current = Math.min(restartDelayRef.current * 2, 4000);
  }, [recognition.error]);

  /**
   * A fresh listening turn starts with a fresh transcript.
   *
   * The recognizer runs while the tutor speaks so it can hear "stop", which
   * means it also hears the tutor's own voice. Aborting and clearing on the way
   * back into listening keeps those echoes out of the student's next turn, and
   * reopens the session with `keepInterim` on so their words survive a browser
   * restart. submitTurn() does the same at the start of every reply.
   */
  const previousPhaseRef = useRef<VoicePhase>(phase);
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previous === phase || phase !== "listening") return;

    lastLoudAtRef.current = performance.now();
    clearInterim();
    abortRecognition();
  }, [phase, clearInterim, abortRecognition]);

  // -------------------------------------------------------------------------
  // One turn
  // -------------------------------------------------------------------------

  const submitTurn = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;

      busyRef.current = true;
      lastUserRef.current = text;
      abortRecognition();
      clearInterim();
      setError(null);
      interruptedRef.current = false;
      streamDoneRef.current = false;
      spokeRef.current = false;
      turnStartedRef.current = performance.now();
      // A turn got through, so the mic is working: reset the failure backoff
      // and let the new language be attempted from the top of the chain.
      restartDelayRef.current = 120;
      attemptedLangRef.current = "";

      const turn = ++seqRef.current;
      const liveId = `a${turn}`;
      setLog((prev) => [...prev, { id: `u${turn}`, role: "user", text }]);
      setPhase("thinking");

      // Speak (and listen) in the language the student is actually using.
      const detected = speechLangFor(detectLanguage(text));
      setListenLang(detected);
      const controller = new AbortController();
      abortRef.current = controller;
      const stream = engine.beginStream(liveId, {
        lang: detected,
        voice: ttsVoice,
        maxChars: SPOKEN_BUDGET,
        style,
      });
      streamRef.current = stream;

      let streamed = "";
      let failure: string | null = null;
      let sawFirstWord = false;

      /** Grow one transcript entry as the reply streams in. */
      const appendDelta = (delta: string) => {
        streamed += delta;
        setLog((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === liveId) {
            return [...prev.slice(0, -1), { ...last, text: streamed }];
          }
          return [...prev, { id: liveId, role: "assistant", text: streamed }];
        });
      };

      try {
        await transportRef.current(
          text,
          {
            onTurn: (meta) => onTurnRef.current(meta),
            onDelta: (delta) => {
              // A newer turn may already have taken over (interrupt + re-ask).
              if (seqRef.current !== turn) return;
              appendDelta(delta);
              if (!sawFirstWord) {
                sawFirstWord = true;
                setFirstWordMs(
                  Math.round(performance.now() - turnStartedRef.current)
                );
              }
              if (phaseRef.current === "thinking") setPhase("speaking");
              if (!interruptedRef.current) stream.push(delta);
            },
            onDone: (info) => {
              if (seqRef.current !== turn) return;
              if (info.error) failure = info.error;
            },
          },
          controller.signal
        );
      } catch (err) {
        failure = err instanceof Error ? err.message : "That turn failed.";
      }

      // A newer turn already took over: leave its state alone.
      if (seqRef.current !== turn) return;

      if (streamRef.current === stream) streamRef.current = null;
      stream.end();
      streamDoneRef.current = true;
      setTurnCount((count) => count + 1);

      if (!streamed.trim()) {
        // Nothing to say, or the request failed before any text arrived: hand
        // the turn back instead of leaving the student waiting on silence.
        if (failure) setError(failure);
        busyRef.current = false;
        interruptedRef.current = true;
        // Drop anything the mic heard while the reply was being prepared so it
        // cannot appear as the student's next turn.
        clearInterim();
        setPhase("listening");
      } else if (failure) {
        setError(failure);
      }
    },
    [engine, abortRecognition, clearInterim, ttsVoice, style]
  );

  useEffect(() => {
    submitRef.current = (text: string) => void submitTurn(text);
  }, [submitTurn]);

  // -------------------------------------------------------------------------
  // Loop: level-driven endpointing, stop-word barge-in, phase completion
  // -------------------------------------------------------------------------

  /** Drop the current reply and take back the turn. */
  const interrupt = useCallback(() => {
    interruptedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current?.cancel();
    streamRef.current = null;
    engine.stop();
    busyRef.current = false;
    streamDoneRef.current = true;
    spokeRef.current = false;
    lastLoudAtRef.current = performance.now();
    // Drop the words that stopped the tutor (and any of its own speech the mic
    // picked up) instead of letting them become the student's next turn. The
    // recognizer is restarted by the phase effect once listening resumes.
    stopRecognitionRef.current();
    clearInterim();
    setPhase("listening");
  }, [engine, clearInterim]);

  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  useEffect(() => {
    let raf = 0;
    let lastState = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastState < 60) return;
      lastState = now;

      const level = micLevel.current;
      const current = phaseRef.current;

      if (current === "listening") {
        if (level > SPEECH_RMS) {
          spokeRef.current = true;
          lastLoudAtRef.current = now;
          return;
        }
        if (
          spokeRef.current &&
          !busyRef.current &&
          now - lastLoudAtRef.current > END_OF_SPEECH_SILENCE_MS
        ) {
          // The student paused — send what we have rather than waiting for the
          // browser to finalize the utterance.
          const pending = getInterimRef.current().trim();
          if (wordCount(pending) >= MIN_SILENCE_WORDS) {
            lastLoudAtRef.current = now;
            submitRef.current(pending);
          }
        }
        return;
      }

      // Thinking and speaking are ended by a stop word (handled in the
      // recognition callbacks above), or by the reply finishing on its own.
      if (current !== "speaking") return;

      // Spoken and finished: listen again with a clean transcript. Clearing
      // before the phase change keeps the tutor's own voice — which reached the
      // mic while it talked — from flashing up as the student's words.
      if (streamDoneRef.current && !engine.isSpeaking()) {
        busyRef.current = false;
        spokeRef.current = false;
        lastLoudAtRef.current = now;
        clearInterim();
        setPhase("listening");
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, micLevel, clearInterim]);

  // -------------------------------------------------------------------------
  // Opening line
  // -------------------------------------------------------------------------

  /**
   * Say the mode's opener as the call starts: interview practice begins with an
   * invitation, a debate with a challenge.
   *
   * The line is fixed, so it is played from the pre-generated bank
   * (lib/phrases.ts → data/phrases) instead of being written and synthesized
   * again — instant, and no TTS request. It goes through the ordinary phase
   * machine, so the student can say stop and cut it off like anything else.
   */
  useEffect(() => {
    if (!opener) return;

    // Started on every pass of this effect rather than once. React Strict Mode
    // mounts, unmounts and remounts in development, and the unmount cleanup
    // stops the engine — so a "first time only" guard would let the cleanup
    // cancel the line the first pass had just started and never restart it,
    // leaving the student with no greeting at all. Starting it again is safe:
    // speakLine replaces whatever is currently playing.

    // Nothing is streaming, so the loop may hand the turn back as soon as the
    // line has finished playing.
    streamDoneRef.current = true;
    engine.unlock();
    engine.speakLine(GREETING_ID, {
      key: opener.key,
      text: opener.text,
      lang,
      voice: ttsVoice,
      style,
    });
  }, [engine, opener, lang, ttsVoice, style]);

  // Session clock, updated once a second.
  useEffect(() => {
    sessionStartedRef.current = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartedRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    if (mutedRef.current) {
      setMuted(false);
      setPhase("listening");
      return;
    }
    stopRecognitionRef.current();
    interrupt();
    setMuted(true);
    setPhase("muted");
  }, [interrupt]);

  const retry = useCallback(() => {
    const text = lastUserRef.current;
    if (text) void submitTurn(text);
  }, [submitTurn]);

  const end = useCallback(() => {
    interruptedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current?.cancel();
    streamRef.current = null;
    stopRecognitionRef.current();
    engine.stop();
    onEndRef.current();
  }, [engine]);

  // Never leave audio or a recognition session behind.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      streamRef.current?.cancel();
      engine.stop();
    },
    [engine]
  );

  // -------------------------------------------------------------------------
  // Derived text for the UI
  // -------------------------------------------------------------------------

  const status = muted
    ? "Muted — tap the mic to keep talking"
    : !recognition.supported
      ? "This browser can't listen — type your question instead"
      : recognition.blocked
        ? "Microphone blocked — allow it, or type your question"
        : phase === "listening"
          ? recognition.interim
            ? "Listening…"
            : !mic.available && !mic.error
              ? "Getting your microphone ready…"
              : "Listening — just start talking"
          : phase === "thinking"
            ? "Thinking… say stop to cancel"
            : "Speaking — say stop to cut in";

  return {
    phase,
    status,
    muted,
    toggleMute,
    interrupt,
    retry,
    end,
    /** Ask a question without speaking (typed fallback and tests). */
    submit: (text: string) => void submitTurn(text),
    error,
    /** A soft warning (mic or recognition trouble) that shouldn't end the call. */
    notice: mic.error ?? recognition.error?.message ?? null,
    /** Set when replies can't be read aloud — Gemini TTS is unavailable. */
    voiceNotice: speech.unavailable
      ? "Gemini's voice is unavailable right now, so this reply isn't read aloud — it's on screen instead. Free-tier TTS quota resets within the hour."
      : null,
    // Only the student's own turn is shown as a transcript. While the tutor is
    // talking the recognizer is open for stop words, but its words are echo.
    interim: phase === "listening" ? recognition.interim : "",
    log,
    turnCount,
    elapsed,
    firstWordMs,
    /** Mic level (RMS) for the visualizer. */
    micLevel,
    /** Analyser carrying the tutor's voice, for the visualizer. */
    playbackAnalyser: engine.getAnalyser(),
    micReady: mic.available,
    recognitionReady: recognition.supported,
  };
}
