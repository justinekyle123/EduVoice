"use client";

// The solo voice quiz: the manual quiz's card, with a voice layer.
//
// The answering surface is deliberately the same as the manual quiz
// (QuizUI's "taking" phase): one question card, lettered option buttons, a typed
// field for short answers, the same header segments and progress. Nothing about
// the option buttons depends on the voice stage — they are clickable from the
// moment the question is on screen until that question has an answer. That is
// the manual quiz's rule, and it is why a tap can never be "stuck" behind a
// reading/countdown phase.
//
// On top of that the voice layer:
//   • reads the question from its pre-rendered clip (live synthesis otherwise);
//   • opens the microphone with the question and drops the clip's own words;
//   • starts the room quiz's 30 s countdown when the reading ends;
//   • grades from the prefetched answer key and reveals the verdict — correct
//     option, answer, explanation, and the room's pre-recorded correct/wrong
//     line — then advances after `REVEAL_SECONDS`.
//
// Grading is local (`answerKey` arrives with the attempt); `submitQuizAttempt`
// still grades the finished attempt on the server.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  Mic,
  MicOff,
  Play,
  Repeat,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { detectLanguage, speechLangFor } from "@/features/chat/lib/detect";
import {
  QUIZ_CORRECT_KEYS,
  QUIZ_WRONG_KEYS,
  quizLine,
  type QuizLineKey,
} from "@/features/chat/lib/phrases";
import { DEFAULT_QUESTION_SECONDS, REVEAL_SECONDS } from "@/features/rooms/lib/live";
import { resolveSpokenAnswer } from "@/features/rooms/lib/voiceAnswer";
import { useVoiceNav } from "@/features/voice-nav/context";
import { MicOrb, type MicStage } from "./MicOrb";
import { isAnswerCorrect } from "../lib/grading";
import { optionLetter, questionNarration } from "../lib/narration";
import {
  getQuizAnswerKey,
  gradeQuizAnswer,
  type QuizAnswerKeyEntry,
  type SafeQuestion,
} from "../server/actions";

/** Quiet time after the last recognised word before the answer is taken. */
const AUTO_SUBMIT_MS = 900;
/** A clip that never reports its end must not hold the question. */
const QUESTION_CAP_MS = 45_000;
/** A live synthesis that never comes back must not hold the quiz. */
const SPEECH_REQUEST_TIMEOUT_MS = 30_000;
/** Safety net only: the key normally arrives with the attempt. */
const ANSWER_CHECK_TIMEOUT_MS = 8_000;
/** Chrome finalizes a clip's last words just after it stops; ignore that tail. */
const CLIP_ECHO_GUARD_MS = 1_200;

/** Recognition languages the browser rarely serves, and the closest it does. */
const LANG_FALLBACK: Record<string, string> = {
  "ceb-PH": "fil-PH",
  "fil-PH": "en-PH",
  "en-PH": "en-US",
};

type Phase = "ready" | "reading" | "answering" | "judging" | "reveal" | "finished";

type Feedback = {
  correct: boolean | null;
  heard: string;
  answer: string;
  correctAnswer: string;
  explanation: string | null;
};

type LineSource =
  | { url: string; fallbackText?: string }
  | { text: string }
  | { key: string; text: string };

/** A verdict line, never the one that was just played. */
function pickLine(
  keys: readonly QuizLineKey[],
  previous: QuizLineKey | null
): QuizLineKey {
  const pool = keys.filter((key) => key !== previous);
  const choices = pool.length > 0 ? pool : keys;
  return choices[Math.floor(Math.random() * choices.length)];
}

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

const STAGE_VIEW: Record<MicStage, { label: string; hint: string }> = {
  ready: {
    label: "Ready",
    hint: "Press start and the first question is read aloud.",
  },
  asking: {
    label: "Reading the question…",
    hint: "You can answer by voice, tap an option, or type right now.",
  },
  listening: {
    label: "Listening",
    hint: "Say the letter or the words, then pause — or tap an option.",
  },
  judging: {
    label: "Checking that answer…",
    hint: "One moment while the answer is marked.",
  },
  verdict: {
    label: "Here's how that went",
    hint: "The next question starts by itself.",
  },
  finished: {
    label: "Finishing up…",
    hint: "Adding up your score.",
  },
};

export function VoiceQuizSession({
  quizId,
  quizTitle,
  questions,
  answerKey,
  onFinish,
  onLeave,
}: {
  quizId: string;
  quizTitle: string;
  questions: SafeQuestion[];
  answerKey: QuizAnswerKeyEntry[];
  onFinish: (answers: { questionId: string; userAnswer: string }[]) => void;
  onLeave: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [index, setIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(DEFAULT_QUESTION_SECONDS * 1000);
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [micSession, setMicSession] = useState(0);
  // UI hint only; recognition callbacks read the matching ref.
  const [audioBusy, setAudioBusy] = useState(false);
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);

  const indexRef = useRef(0);
  const phaseRef = useRef<Phase>("ready");
  const leftRef = useRef(false);
  /** Increments per question; late audio callbacks check it before acting. */
  const questionTokenRef = useRef(0);
  const answerKeyRef = useRef<Map<string, QuizAnswerKeyEntry>>(new Map());
  const answersRef = useRef<Record<string, string>>({});
  const draftRef = useRef("");
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const synthesisRef = useRef<{
    controller: AbortController;
    cancelled: boolean;
  } | null>(null);
  const lastVerdictRef = useRef<QuizLineKey | null>(null);
  const micLangRef = useRef<{ question: string; lang: string } | null>(null);
  const micRef = useRef<{ abort: () => void; getInterim: () => string }>({
    abort: () => {},
    getInterim: () => "",
  });
  const clearMicErrorRef = useRef<() => void>(() => {});
  const clearMicInterimRef = useRef<() => void>(() => {});
  const audioBusyRef = useRef(false);
  const clipQuietUntilRef = useRef(0);

  const question = questions[index];
  const total = questions.length;
  const answeredCount = answeredIds.length;
  const fullMs = DEFAULT_QUESTION_SECONDS * 1000;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Voice navigation listens continuously on this page; two recognizers in one
  // tab fight over the microphone, so pause it while the session is mounted.
  const { suspendListening, resumeListening } = useVoiceNav();
  useEffect(() => {
    suspendListening();
    return () => resumeListening();
  }, [suspendListening, resumeListening]);

  // Take the key the page handed over with the attempt.
  useEffect(() => {
    if (answerKey.length === 0) return;
    answerKeyRef.current = new Map(
      answerKey.map((entry) => [entry.questionId, entry])
    );
  }, [answerKey]);

  const loadAnswerKey = useCallback(async () => {
    try {
      const key = await getQuizAnswerKey(quizId);
      if (leftRef.current) return;
      answerKeyRef.current = new Map(
        key.map((entry) => [entry.questionId, entry])
      );
    } catch (err) {
      console.warn("[voice-quiz] could not load the answer key:", err);
    }
  }, [quizId]);

  useEffect(() => {
    if (answerKeyRef.current.size === 0) void loadAnswerKey();
  }, [loadAnswerKey]);

  // ------------------------------------------------------------------ audio --

  const clearQuiet = useCallback(() => {
    if (quietRef.current) {
      clearTimeout(quietRef.current);
      quietRef.current = null;
    }
  }, []);

  const stopCountdown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearQuiet();
    stopCountdown();
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, [clearQuiet, stopCountdown]);

  const stopLine = useCallback(() => {
    // Cancel the clip's own watchdog too: a tap during the reading stops the
    // audio, and the 45 s cap must not later call `beginCountdown` over the
    // verdict and drag the card back to "answering".
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    const pending = synthesisRef.current;
    if (pending) {
      pending.cancelled = true;
      pending.controller.abort();
    }
    synthesisRef.current = null;
    const line = lineRef.current;
    if (line) {
      line.onended = null;
      line.onerror = null;
      line.pause();
      lineRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /** Play one passage; every failure path calls `next` so nothing hangs. */
  async function playLine(
    source: LineSource,
    next: () => void,
    options?: { timeoutMs?: number }
  ) {
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    stopLine();

    let url: string;
    if ("url" in source) {
      url = source.url;
    } else if ("key" in source) {
      url = `/api/chat/speech/${source.key}`;
      return playUrl(url, next, () =>
        void playByText(source.text, next, options?.timeoutMs)
      );
    } else {
      return playByText(source.text, next, options?.timeoutMs);
    }

    return playUrl(url, next, () => {
      if ("fallbackText" in source && source.fallbackText) {
        void playByText(source.fallbackText, next, options?.timeoutMs);
        return;
      }
      next();
    });
  }

  async function playByText(
    text: string,
    next: () => void,
    timeoutMs = SPEECH_REQUEST_TIMEOUT_MS
  ) {
    const controller = new AbortController();
    const entry = { controller, cancelled: false };
    synthesisRef.current = entry;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/chat/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          code?: string;
        } | null;
        setError(
          payload?.code === "quota"
            ? "Voice credits are unavailable, so this line could not be spoken."
            : "Voice audio could not be generated, so this line could not be spoken."
        );
        return next();
      }
      const url = URL.createObjectURL(await res.blob());
      objectUrlRef.current = url;
      return playUrl(url, next, () => next());
    } catch {
      if (entry.cancelled) return;
      setError("Voice audio could not be reached. You can continue the quiz manually.");
      return next();
    } finally {
      clearTimeout(timer);
      if (synthesisRef.current === entry) synthesisRef.current = null;
    }
  }

  function playUrl(url: string, next: () => void, onProblem: () => void) {
    let settled = false;
    const once = (then: () => void) => {
      if (settled) return;
      settled = true;
      if (capRef.current) {
        clearTimeout(capRef.current);
        capRef.current = null;
      }
      then();
    };

    const audio = new Audio(url);
    lineRef.current = audio;
    audio.onended = () => once(next);
    audio.onerror = () => once(onProblem);
    capRef.current = setTimeout(() => once(onProblem), QUESTION_CAP_MS);
    void audio.play().catch(() => once(onProblem));
  }

  // ------------------------------------------------------------ the session --

  const beginCountdown = (token: number) => {
    if (leftRef.current || questionTokenRef.current !== token) return;
    clipQuietUntilRef.current = Date.now() + CLIP_ECHO_GUARD_MS;
    audioBusyRef.current = false;
    setAudioBusy(false);
    setPhase("answering");
    deadlineRef.current = Date.now() + fullMs;
    setRemainingMs(fullMs);
    stopCountdown();
    timerRef.current = setInterval(() => {
      if (leftRef.current || questionTokenRef.current !== token) return;
      const left = Math.max(0, deadlineRef.current - Date.now());
      setRemainingMs(left);
      if (left <= 0) {
        stopCountdown();
        void submitAnswer(undefined, { skip: true });
      }
    }, 200);
  };

  /** Show one question and read it aloud. */
  function askQuestion(target: number) {
    const current = questions[target];
    if (!current) return;

    const token = questionTokenRef.current + 1;
    questionTokenRef.current = token;
    indexRef.current = target;
    setIndex(target);
    setTyped("");
    setHeard("");
    setFeedback(null);
    setError(null);
    setRemainingMs(fullMs);
    draftRef.current = "";
    clearTimers();
    stopLine();
    micRef.current.abort();
    clearMicErrorRef.current();
    clearMicInterimRef.current();
    clipQuietUntilRef.current = 0;
    audioBusyRef.current = true;
    setAudioBusy(true);
    setPhase("reading");

    const spoken = questionNarration(current, target + 1, total);
    void playLine(
      {
        url: `/api/quiz/${quizId}/audio/${current.audioFile ?? `${current.id}.wav`}`,
        fallbackText: spoken,
      },
      () => beginCountdown(token)
    );
  }

  /**
   * Record and reveal one answer.
   *
   * This is the manual quiz's click path, so it deliberately does **not** check
   * the voice stage: a tap or typed answer submitted while the question is still
   * being read, while the countdown runs, or after a stalled stage all work the
   * same way. Only an already-answered question is refused.
   */
  async function submitAnswer(
    rawOverride?: string,
    options?: { skip?: boolean }
  ) {
    const current = questions[indexRef.current];
    if (!current || leftRef.current) return;
    if (answersRef.current[current.id] !== undefined) return;

    // Take the interim words before stopping the recognizer.
    const interimText = micRef.current.getInterim();
    micRef.current.abort();
    const raw = options?.skip
      ? ""
      : rawOverride?.trim() ||
        `${draftRef.current} ${interimText}`.replace(/\s+/g, " ").trim();
    const resolved = resolveSpokenAnswer(current, raw);
    const answered = raw.trim().length > 0;
    const answer = answered ? resolved.answer : "";

    answersRef.current[current.id] = answer;
    setAnsweredIds((ids) =>
      ids.includes(current.id) ? ids : [...ids, current.id]
    );
    setHeard(raw);
    setTyped("");
    stopCountdown();
    clearQuiet();
    // A tap during the reading ends the question now; the clip must not talk
    // over the verdict.
    stopLine();
    audioBusyRef.current = false;
    setAudioBusy(false);
    setPhase("judging");

    const prefetched = answerKeyRef.current.get(current.id);
    let verdict: {
      correct: boolean;
      correctAnswer: string;
      explanation: string | null;
    } | null = null;

    if (prefetched) {
      verdict = {
        correct: isAnswerCorrect(prefetched.type, prefetched.correctAnswer, answer),
        correctAnswer: prefetched.correctAnswer,
        explanation: prefetched.explanation,
      };
    } else {
      try {
        verdict = await Promise.race([
          gradeQuizAnswer({ questionId: current.id, userAnswer: answer }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("Answer checking timed out. Moving on.")),
              ANSWER_CHECK_TIMEOUT_MS
            );
          }),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not grade that answer");
      }
    }
    if (leftRef.current) return;

    const next: Feedback = {
      correct: answered && verdict ? verdict.correct : null,
      heard: raw,
      answer,
      correctAnswer: verdict?.correctAnswer ?? "",
      explanation: verdict?.explanation ?? null,
    };
    setFeedback(next);
    setPhase("reveal");

    if (answered && verdict) {
      const key = pickLine(
        verdict.correct ? QUIZ_CORRECT_KEYS : QUIZ_WRONG_KEYS,
        lastVerdictRef.current
      );
      lastVerdictRef.current = key;
      const line = quizLine(key);
      void playLine({ key, text: line.text }, () => {});
    }

    const token = questionTokenRef.current;
    revealTimerRef.current = setTimeout(() => advance(token), REVEAL_SECONDS * 1000);
  }

  function advance(token: number) {
    if (leftRef.current || questionTokenRef.current !== token) return;
    clearTimers();
    stopLine();
    const next = indexRef.current + 1;
    if (next >= total) {
      setPhase("finished");
      const line = quizLine("quiz-finished");
      void playLine({ key: "quiz-finished", text: line.text }, () => {
        if (leftRef.current) return;
        onFinish(
          Object.entries(answersRef.current).map(([questionId, userAnswer]) => ({
            questionId,
            userAnswer,
          }))
        );
      });
      return;
    }
    askQuestion(next);
  }

  function start() {
    clearTimers();
    setError(null);
    askQuestion(0);
  }

  function replayQuestion() {
    if (!question || answersRef.current[question.id] !== undefined) return;
    const token = questionTokenRef.current;
    clearQuiet();
    clipQuietUntilRef.current = 0;
    audioBusyRef.current = true;
    setAudioBusy(true);
    const spoken = questionNarration(question, indexRef.current + 1, total);
    void playLine(
      {
        url: `/api/quiz/${quizId}/audio/${question.audioFile ?? `${question.id}.wav`}`,
        fallbackText: spoken,
      },
      () => {
        if (leftRef.current || questionTokenRef.current !== token) return;
        clipQuietUntilRef.current = Date.now() + CLIP_ECHO_GUARD_MS;
        audioBusyRef.current = false;
        setAudioBusy(false);
      }
    );
  }

  function leave() {
    leftRef.current = true;
    clearTimers();
    stopLine();
    micRef.current.abort();
    onLeave();
  }

  // ---------------------------------------------------------- recognition ---

  function acceptHeard(trimmed: string) {
    const phaseNow = phaseRef.current;
    if (phaseNow !== "reading" && phaseNow !== "answering") return false;
    if (answersRef.current[questions[indexRef.current]?.id ?? ""] !== undefined) {
      return false;
    }
    if (audioBusyRef.current || Date.now() < clipQuietUntilRef.current) {
      clearMicInterimRef.current();
      clearQuiet();
      return false;
    }
    if (!trimmed) return false;
    return true;
  }

  function handleSpoken(finalText: string) {
    const trimmed = finalText.trim();
    if (!acceptHeard(trimmed)) return;
    draftRef.current = `${draftRef.current} ${trimmed}`.replace(/\s+/g, " ").trim();
    setHeard(draftRef.current);
    clearQuiet();
    // Read the live transcript when the window closes: the browser may still be
    // holding words the final result did not include.
    quietRef.current = setTimeout(() => void submitAnswer(), AUTO_SUBMIT_MS);
  }

  function handleInterim(interimText: string) {
    const shown = `${draftRef.current} ${interimText}`.replace(/\s+/g, " ").trim();
    if (!acceptHeard(shown)) return;
    setHeard(shown);
    clearQuiet();
    // Chrome often keeps a short answer interim and never finalizes it, so the
    // answer is read from the live buffer when the quiet window closes.
    quietRef.current = setTimeout(() => void submitAnswer(), AUTO_SUBMIT_MS);
  }

  const {
    supported,
    listening,
    blocked,
    error: recognitionError,
    start: startMic,
    abort: abortMic,
    clearError: clearMicError,
    clearInterim: clearMicInterim,
    getInterim,
  } = useSpeechRecognition(handleSpoken, handleInterim);

  useEffect(() => {
    micRef.current = { abort: abortMic, getInterim };
  }, [abortMic, getInterim]);
  useEffect(() => {
    clearMicErrorRef.current = clearMicError;
  }, [clearMicError]);
  useEffect(() => {
    clearMicInterimRef.current = clearMicInterim;
  }, [clearMicInterim]);

  const questionText = question?.question ?? "";
  const canListen = supported && !blocked;
  const errorCode = recognitionError?.code ?? null;

  /** The microphone opens with the question and stays through answering. */
  useEffect(() => {
    if (
      (phase !== "reading" && phase !== "answering") ||
      !micOn ||
      !canListen
    ) {
      abortMic();
      return;
    }
    if (errorCode !== null && errorCode !== "language-not-supported") {
      abortMic();
      return;
    }

    const previous = micLangRef.current;
    let attempt =
      previous?.question === questionText
        ? previous.lang
        : speechLangFor(detectLanguage(questionText));

    if (
      errorCode === "language-not-supported" &&
      previous?.question === questionText &&
      previous.lang === attempt
    ) {
      const fallback = LANG_FALLBACK[attempt];
      if (!fallback) {
        abortMic();
        return;
      }
      attempt = fallback;
    }
    micLangRef.current = { question: questionText, lang: attempt };

    startMic(attempt, { continuous: true, keepInterim: true });
    return () => abortMic();
  }, [
    phase,
    micOn,
    canListen,
    errorCode,
    startMic,
    abortMic,
    questionText,
    micSession,
  ]);

  // Chrome ends a recognition session on silence; reopen it while the question
  // still waits. Paused while the clip is playing so the reopen cannot catch the
  // clip's own voice.
  useEffect(() => {
    if (phase !== "answering" || !micOn || !canListen || listening || audioBusy) {
      return;
    }
    if (quietRef.current) return;
    if (errorCode === "language-not-supported") {
      const attempted = micLangRef.current;
      if (attempted?.question === questionText && !LANG_FALLBACK[attempted.lang]) {
        return;
      }
    }
    const timer = setTimeout(() => setMicSession((session) => session + 1), 500);
    return () => clearTimeout(timer);
  }, [
    phase,
    micOn,
    canListen,
    listening,
    audioBusy,
    errorCode,
    questionText,
    micSession,
  ]);

  // Cleanup on leave. The body resets `leftRef` because React StrictMode
  // simulates unmount+remount in development; without the reset the first
  // cleanup would leave the whole session marked as "left" before start.
  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
      clearTimers();
      stopLine();
      micRef.current.abort();
    };
  }, [clearTimers, stopLine]);

  // ----------------------------------------------------------------- view ---

  const stage: MicStage =
    phase === "ready"
      ? "ready"
      : phase === "reading"
        ? "asking"
        : phase === "answering"
          ? listening
            ? "listening"
            : "asking"
          : phase === "judging"
            ? "judging"
            : phase === "reveal"
              ? "verdict"
              : "finished";

  const view = STAGE_VIEW[stage];
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const answered = question ? answersRef.current[question.id] !== undefined : false;

  if (phase === "ready") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
        <section className={cn(panel, "p-6 sm:p-8")}>
          <div className="flex flex-col items-center py-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-lg shadow-brand-500/30">
              <Mic className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {quizTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {total} questions, {DEFAULT_QUESTION_SECONDS} seconds each. Tap an
              option or type at any time — the microphone and countdown are
              improvements, not the only way to answer.
            </p>
            <button
              type="button"
              onClick={start}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg"
            >
              <Play className="h-4 w-4" />
              Start the voice quiz
            </button>
            {!canListen && (
              <p className="mt-4 max-w-md rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
                {blocked
                  ? "The microphone is blocked, so you'll pick your answers instead — the questions are still read aloud."
                  : "This browser cannot listen for speech, so you'll pick your answers instead — the questions are still read aloud."}
              </p>
            )}
          </div>
        </section>

        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the quiz
        </button>
      </motion.div>
    );
  }

  if (!question) return null;

  const options = question.options ?? [];
  const correctAnswer = feedback?.correctAnswer ?? "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Header — the manual quiz's panel, plus the room's timer chip. */}
      <div className={cn(panel, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={leave}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave quiz
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Question {index + 1} of {total}
            </span>
            {(phase === "reading" || phase === "answering") && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                  phase === "answering" && remainingSeconds <= 5
                    ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                )}
              >
                {phase === "reading" ? (
                  <>
                    <Volume2 className="h-3.5 w-3.5" />
                    Reading…
                  </>
                ) : (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    {remainingSeconds}s
                  </>
                )}
              </span>
            )}
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {answeredCount} answered
            </span>
          </div>
        </div>

        <div
          className="mt-3 flex items-center gap-1.5"
          role="group"
          aria-label="Question progress"
        >
          {questions.map((entry, position) => {
            const done = answeredIds.includes(entry.id);
            const active = position === index;
            return (
              <span
                key={entry.id}
                aria-label={`Question ${position + 1}${done ? " — answered" : ""}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-all duration-200",
                  active
                    ? "bg-brand-500"
                    : done
                      ? "bg-brand-300 dark:bg-brand-500/50"
                      : "bg-zinc-200 dark:bg-zinc-700"
                )}
              />
            );
          })}
        </div>

        {(phase === "reading" || phase === "answering") && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-brand-400 to-brand-500 transition-[width] duration-200 ease-linear"
              style={{
                width: `${
                  phase === "reading"
                    ? 100
                    : Math.min(100, (remainingMs / fullMs) * 100)
                }%`,
              }}
            />
          </div>
        )}
      </div>

      {/* The manual quiz's question card. */}
      <section className={cn(panel, "p-6 sm:p-8")}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
            {TYPE_LABELS[question.type] ?? "Question"}
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {question.type === "short_answer" ? "Write it in your own words" : "Choose one"}
          </span>
        </div>

        <p className="mt-4 text-lg font-medium leading-8 text-zinc-900 dark:text-zinc-100 sm:text-xl">
          {question.question}
        </p>

        <div className="mt-4 flex items-center gap-2.5">
          <MicOrb stage={stage} correct={feedback?.correct ?? null} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
              {view.label}
            </p>
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {view.hint}
            </p>
          </div>
        </div>

        {question.type === "short_answer" ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Type your answer"
              aria-label="Your answer"
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
            />
            <button
              type="button"
              onClick={() => void submitAnswer(typed)}
              disabled={typed.trim().length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              Answer
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {options.map((option, position) => {
              const isAnswer =
                feedback !== null &&
                correctAnswer.length > 0 &&
                option.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
              const isMine =
                feedback !== null &&
                feedback.answer.length > 0 &&
                option.trim().toLowerCase() === feedback.answer.trim().toLowerCase();
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => void submitAnswer(option)}
                  // The manual quiz's rule: these buttons are never disabled, so
                  // no stage, countdown, or audio state can lock them. A tap on
                  // an answered question is ignored by `submitAnswer`.
                  className={cn(
                    "group flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left text-sm transition-all duration-200",
                    isAnswer
                      ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:ring-emerald-500/25"
                      : isMine
                        ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200 dark:border-brand-500/60 dark:bg-brand-500/10 dark:ring-brand-500/25"
                        : "border-zinc-200 hover:border-brand-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold",
                      isAnswer
                        ? "border-emerald-400 bg-emerald-400 text-emerald-950"
                        : isMine
                          ? "border-brand-400 bg-brand-400 text-brand-950"
                          : "border-zinc-200 text-zinc-500 group-hover:border-brand-300 group-hover:text-brand-700 dark:border-zinc-700 dark:text-zinc-400 dark:group-hover:text-brand-300"
                    )}
                  >
                    {optionLetter(position)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 leading-6",
                      isAnswer
                        ? "font-medium text-emerald-900 dark:text-emerald-200"
                        : isMine
                          ? "font-medium text-brand-900 dark:text-brand-200"
                          : "text-zinc-700 dark:text-zinc-300"
                    )}
                  >
                    {option}
                  </span>
                  {isAnswer && (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!answered && heard && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
            <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
            <span className="min-w-0">“{heard}”</span>
          </p>
        )}

        {phase === "judging" && (
          <p className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking that answer…
          </p>
        )}

        {feedback && (
          <div
            className={cn(
              "mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm ring-1",
              feedback.correct === true
                ? "bg-emerald-50 text-emerald-800 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                : "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                feedback.correct === true
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
              )}
            >
              {feedback.correct === true ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">
                {feedback.correct === true
                  ? "Correct"
                  : feedback.correct === false
                    ? "Not this one"
                    : "No answer"}
                {feedback.heard.trim().length > 0 && (
                  <span className="font-normal"> — you said “{feedback.heard}”</span>
                )}
              </p>
              {feedback.correct !== true && correctAnswer && (
                <p className="mt-1">
                  The answer is{" "}
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    {correctAnswer}
                  </span>
                </p>
              )}
              {feedback.explanation && (
                <p className="mt-1 text-xs leading-5 opacity-90">
                  {feedback.explanation}
                </p>
              )}
            </div>
          </div>
        )}

        {!answered && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={replayQuestion}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Repeat className="h-4 w-4" />
              Repeat question
            </button>
            {supported && !blocked && (
              <button
                type="button"
                aria-pressed={micOn}
                onClick={() => setMicOn((on) => !on)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors",
                  micOn
                    ? "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                )}
              >
                {micOn ? (
                  <>
                    <MicOff className="h-4 w-4" />
                    Stop listening
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    Answer by voice
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submitAnswer(undefined, { skip: true })}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <SkipForward className="h-4 w-4" />
              Skip
            </button>
          </div>
        )}

        {!canListen && !answered && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            {blocked
              ? "The browser refused the microphone — allow it, or tap an option above."
              : "This browser can't listen for speech — tap an option above, or type a short answer."}
          </p>
        )}

        {canListen && !answered && recognitionError !== null && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            {recognitionError.message} You can still tap an option or type your answer.
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}
      </section>

      {phase === "finished" && (
        <p className="flex items-center justify-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-3 text-sm font-medium text-brand-800 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
          <Loader2 className="h-4 w-4 animate-spin" />
          All {total} answered — adding up your score…
        </p>
      )}
    </motion.div>
  );
}
