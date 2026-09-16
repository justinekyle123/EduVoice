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
//   barge-in     talking over the tutor stops the audio and takes the turn, the
//                way you interrupt a person mid-sentence. It arms only once
//                audio is really playing, and it backs off if the room echoes.
//   streaming    reply text goes into the speech engine as it arrives and is
//                spoken sentence by sentence.
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
/** Clearly-loud speech that may interrupt the tutor (well above echo level). */
const BARGE_RMS = 0.05;
/** Let playback settle before barge-in arms, so it can't interrupt itself. */
const BARGE_ARM_MS = 900;
const BARGE_ARM_MAX_MS = 3200;
/** Consecutive loud frames required to count as an interruption (~65ms). */
const BARGE_FRAMES = 4;
/** Audio playing for less than this before a barge looks like an echo. */
const EARLY_BARGE_MS = 1200;
/** Grace period before talking over a *still composing* reply cancels it. */
const THINKING_BARGE_MS = 1800;
/** Characters spoken per reply; the rest stays on screen. */
const SPOKEN_BUDGET = 900;

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
  voice: "gemini" as const,
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

  // Which voice the last reply was actually spoken in — the student is told
  // when the fallback is in use instead of silently hearing a worse voice.
  const speech = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    () => IDLE_SPEECH
  );

  const [phase, setPhase] = useState<VoicePhase>("listening");
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<VoiceLogEntry[]>([]);
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
  /** When audio actually started for the current reply. */
  const playingSinceRef = useRef(0);
  /** When the reply started being composed (for talking over "thinking"). */
  const thinkingSinceRef = useRef(0);
  /** Student has said something in the current listening turn. */
  const spokeRef = useRef(false);
  const lastLoudAtRef = useRef(0);
  const bargeFramesRef = useRef(0);
  /** Adaptive barge-in: grows when interruptions look like speaker echo. */
  const bargeArmRef = useRef(BARGE_ARM_MS);
  /** Delay before reopening the mic, doubled after each recognition failure. */
  const restartDelayRef = useRef(120);
  const earlyBargeRef = useRef(0);
  const bargeDisabledRef = useRef(false);
  const sessionStartedRef = useRef(0);
  /** Recognition language already attempted, so fallbacks can't loop. */
  const attemptedLangRef = useRef("");

  const transportRef = useRef(transport);
  const onEndRef = useRef(onEnd);
  const onTurnRef = useRef<(meta: VoiceTurnMeta) => void>(() => {});
  const handleFinalRef = useRef<(text: string) => void>(() => {});
  const submitRef = useRef<(text: string) => void>(() => {});
  const stopRecognitionRef = useRef<() => void>(() => {});
  const getInterimRef = useRef<() => string>(() => "");

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

  const recognition = useSpeechRecognition((finalText) => {
    handleFinalRef.current(finalText);
  });
  const {
    start: startRecognition,
    abort: abortRecognition,
    listening: recognitionListening,
    blocked: recognitionBlocked,
    clearInterim,
    getInterim,
  } = recognition;

  /** A completed utterance while listening is one turn. */
  useEffect(() => {
    handleFinalRef.current = (text: string) => {
      if (phaseRef.current !== "listening") return;
      submitRef.current(text);
    };
  }, []);

  useEffect(() => {
    stopRecognitionRef.current = abortRecognition;
  }, [abortRecognition]);

  useEffect(() => {
    getInterimRef.current = getInterim;
  }, [getInterim]);

  // Keep the recognizer open for the whole listening phase, restarting it
  // across the browser's own silence timeouts (and across turns). Repeated
  // failures back off instead of hammering the API.
  useEffect(() => {
    if (muted || recognitionBlocked) return;
    if (phase !== "listening" || recognitionListening) return;

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

    const timer = window.setTimeout(
      () => startRecognition(attempt, { continuous: true, keepInterim: true }),
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
      bargeFramesRef.current = 0;
      playingSinceRef.current = 0;
      thinkingSinceRef.current = 0;
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
  // Loop: level-driven endpointing, barge-in, phase completion
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
    playingSinceRef.current = 0;
    thinkingSinceRef.current = 0;
    setPhase("listening");
  }, [engine]);

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
        thinkingSinceRef.current = 0;
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

      if (current === "thinking") {
        // Nothing is playing yet, so there is no echo to worry about: talking
        // while the tutor is composing means "hold on", and drops the request.
        if (thinkingSinceRef.current === 0) thinkingSinceRef.current = now;
        const armed =
          !bargeDisabledRef.current &&
          now - thinkingSinceRef.current > THINKING_BARGE_MS;
        if (armed && level > BARGE_RMS) bargeFramesRef.current += 1;
        else bargeFramesRef.current = 0;

        if (bargeFramesRef.current >= BARGE_FRAMES) {
          bargeFramesRef.current = 0;
          thinkingSinceRef.current = 0;
          interrupt();
        }
        return;
      }

      if (current !== "speaking") return;

      thinkingSinceRef.current = 0;
      const playing = engine.isPlaying();
      if (!playing) {
        bargeFramesRef.current = 0;
        playingSinceRef.current = 0;
      } else {
        if (playingSinceRef.current === 0) playingSinceRef.current = now;
        const armed =
          !bargeDisabledRef.current &&
          now - playingSinceRef.current > bargeArmRef.current;

        if (armed && level > BARGE_RMS) bargeFramesRef.current += 1;
        else bargeFramesRef.current = 0;

        if (bargeFramesRef.current >= BARGE_FRAMES) {
          bargeFramesRef.current = 0;
          const playedFor = now - playingSinceRef.current;

          if (playedFor < EARLY_BARGE_MS) {
            // Interrupting within a second of the tutor starting is almost
            // always the tutor's own voice leaking into the mic. Raise the bar
            // instead of cutting the answer off.
            earlyBargeRef.current += 1;
            bargeArmRef.current = Math.min(
              bargeArmRef.current * 2,
              BARGE_ARM_MAX_MS
            );
            if (earlyBargeRef.current >= 3) bargeDisabledRef.current = true;
          } else {
            earlyBargeRef.current = 0;
            interruptedRef.current = true;
            engine.stop();
            streamRef.current?.cancel();
            streamRef.current = null;
            busyRef.current = false;
            spokeRef.current = false;
            playingSinceRef.current = 0;
            lastLoudAtRef.current = now;
            setPhase("listening");
            return;
          }
        }
      }

      // Spoken and finished: listen again.
      if (streamDoneRef.current && !engine.isSpeaking()) {
        playingSinceRef.current = 0;
        busyRef.current = false;
        spokeRef.current = false;
        lastLoudAtRef.current = now;
        setPhase("listening");
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, micLevel, interrupt]);

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
            ? "Thinking…"
            : "Speaking — talk over me any time";

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
    /** Set when replies are being read by the browser voice, not Gemini. */
    voiceNotice:
      speech.voice === "browser" &&
      (phase === "speaking" || phase === "thinking")
        ? "Gemini's voice is unavailable right now, so this reply uses your browser's voice. Free-tier TTS quota resets within the hour."
        : null,
    interim: recognition.interim,
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
