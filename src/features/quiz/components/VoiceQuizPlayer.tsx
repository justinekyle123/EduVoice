"use client";

// The voice quiz: one attempt, answered out loud, hands free.
//
// A question is played from the clip the quiz was generated with — one WAV per
// question under data/quiz-audio/<quizId>/ (see server/voiceRender.ts) — the mic
// opens when that clip ends, and the answer is judged as soon as the student
// stops talking. Then the verdict is spoken and the next question starts on its
// own. Nothing here is tapped.
//
// Why the clips matter: a quiz is taken again and again, and this is the half of
// the feature that makes a repeat free. A question with no clip — rendering
// failed, or the quiz was written before this feature existed — is synthesized
// live instead, from the same text builder (lib/narration.ts), so both paths say
// exactly the same thing.
//
// What is said out loud is split deliberately:
//   • the questions and the verdicts are pre-rendered, so repeating them is free
//     (features/chat/lib/phrases.ts, server/voiceRender.ts),
//   • the answer to a question that was missed is per question, so it is
//     synthesized on demand and cached by its words: a question only ever pays
//     for its reveal when the student actually gets it wrong.
//
// Playing the WAV bytes here rather than through the chat engine
// (features/chat/lib/speechEngine.ts) is the one thing this component does
// differently from the rest of the app, and it is deliberate: a hands-free flow
// has to know when a line has *finished*, and the engine schedules audio without
// reporting that. The audio is still Gemini TTS from this app's own route —
// never the browser's voices.
//
// Answers are not graded in the browser: a question reaches the client without
// its answer (see SafeQuestion), so each one is judged by the server
// (`gradeQuizAnswer`) and the attempt is graded again on submit.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
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
import {
  normalizeSpeech,
  resolveSpokenAnswer,
} from "@/features/rooms/lib/voiceAnswer";
import { answerReveal, optionLetter, questionNarration } from "../lib/narration";
import { gradeQuizAnswer, type SafeQuestion } from "../server/actions";

/** Quiet time after the last recognised word before the answer is judged. */
const AUTO_SUBMIT_MS = 900;
/** Do not leave the voice flow stuck when the server or database is unavailable. */
const ANSWER_CHECK_TIMEOUT_MS = 10_000;
/** How many times a question is asked again when nothing usable was heard. */
const MISS_LIMIT = 2;
/** Ceiling on one question's read-aloud, in case a clip never reports its end. */
const QUESTION_CAP_MS = 45_000;

/**
 * Words a student says *to* the quiz rather than in answer to it. Matched as a
 * whole utterance or as its opening words, so "repeat the question please" is a
 * command while "the sun" stays an answer.
 */
const REPEAT_WORDS = [
  "repeat",
  "repeat the question",
  "say it again",
  "say that again",
  "again",
  "ulit",
  "ulitin",
  "balik",
];
const STOP_WORDS = ["stop", "quit", "exit", "cancel", "tapos", "tigil"];
const SKIP_WORDS = ["skip", "skip this", "next", "pass", "laktaw", "lipat"];

type Stage = "ready" | "asking" | "listening" | "judging" | "verdict" | "finished";

type Feedback = {
  correct: boolean;
  heard: string;
  correctAnswer: string;
  explanation: string | null;
};

/** Where a spoken passage's bytes come from. */
type LineSource =
  /** A file that is already on disk: a question clip, or a bank line by key. */
  | { url: string; fallbackText?: string }
  /** Words to synthesize (and cache server-side) before playing. */
  | { text: string }
  /** A bank line: play its file when it exists, else say the words. */
  | { key: string; text: string };

/** True when what was heard is one of these commands, not an answer. */
function isCommand(spoken: string, words: readonly string[]): boolean {
  const text = normalizeSpeech(spoken);
  if (!text) return false;
  return words.some((word) => text === word || text.startsWith(`${word} `));
}

/** A verdict line, never the one that was just used. */
function pickLine(
  keys: readonly QuizLineKey[],
  previous: QuizLineKey | null
): QuizLineKey {
  const pool = keys.filter((key) => key !== previous);
  const choices = pool.length > 0 ? pool : keys;
  return choices[Math.floor(Math.random() * choices.length)];
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

/** What the orb is doing and what the student should do about it. */
const STAGE_VIEW: Record<Stage, { label: string; hint: string }> = {
  ready: {
    label: "Ready",
    hint: "Press start and the first question is read aloud.",
  },
  asking: {
    label: "Reading the question…",
    hint: "Listen — the microphone opens the moment the reading ends.",
  },
  listening: {
    label: "Listening",
    hint: "Say the letter of your answer, or say it in full, then pause.",
  },
  judging: {
    label: "Checking that answer…",
    hint: "One moment while the answer is marked.",
  },
  verdict: {
    label: "Here's how that went",
    hint: "It moves on by itself.",
  },
  finished: {
    label: "Finishing up…",
    hint: "Adding up your score.",
  },
};

/**
 * The voice counterpart of a flashcard's front: a single round indicator that
 * says, without words, whether the quiz is speaking, listening, thinking, or
 * done. It pulses only while the microphone is actually open.
 */
function MicOrb({ stage, correct }: { stage: Stage; correct: boolean | null }) {
  const pulsing = stage === "listening";
  const tone =
    stage === "verdict"
      ? correct
        ? "bg-gradient-to-br from-emerald-400 to-emerald-500 text-emerald-950 shadow-emerald-500/30"
        : "bg-gradient-to-br from-red-400 to-red-500 text-red-950 shadow-red-500/30"
      : pulsing || stage === "asking"
        ? "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-brand-500/30"
        : "bg-zinc-100 text-zinc-400 shadow-zinc-900/5 dark:bg-zinc-800 dark:text-zinc-500";

  const icon =
    stage === "listening" ? (
      <Mic className="h-7 w-7" />
    ) : stage === "judging" ? (
      <Loader2 className="h-7 w-7 animate-spin" />
    ) : stage === "verdict" ? (
      correct ? (
        <Check className="h-7 w-7" />
      ) : (
        <X className="h-7 w-7" />
      )
    ) : stage === "finished" ? (
      <Check className="h-7 w-7" />
    ) : (
      <Volume2 className="h-7 w-7" />
    );

  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      {pulsing && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-400/30"
            animate={{ scale: [1, 1.35, 1], opacity: [0.45, 0.05, 0.45] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-400/20"
            animate={{ scale: [1, 1.55, 1], opacity: [0.35, 0, 0.35] }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.4,
            }}
          />
        </>
      )}
      <span
        className={cn(
          "relative flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-colors duration-300",
          tone
        )}
      >
        {icon}
      </span>
    </span>
  );
}

export function VoiceQuizPlayer({
  quizId,
  quizTitle,
  questions,
  onFinish,
  onLeave,
}: {
  quizId: string;
  quizTitle: string;
  questions: SafeQuestion[];
  /** Hand the collected answers to the page, which submits and grades them. */
  onFinish: (answers: { questionId: string; userAnswer: string }[]) => void;
  onLeave: () => void;
}) {
  const [stage, setStage] = useState<Stage>("ready");
  const [index, setIndex] = useState(0);
  const [heard, setHeard] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Typed fallback, used only on a short-answer question when the browser cannot
  // listen — otherwise there would be no way to answer it at all.
  const [typed, setTyped] = useState("");

  const lineRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const answersRef = useRef<Record<string, string>>({});
  const missesRef = useRef(0);
  const draftRef = useRef("");
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);
  const stageRef = useRef<Stage>("ready");
  const leftRef = useRef(false);
  const lastVerdictRef = useRef<QuizLineKey | null>(null);
  // The microphone lives in the hook below, which is declared after the flow that
  // uses it; this ref is how the flow reaches it without a circular declaration.
  const micRef = useRef<{ abort: () => void; getInterim: () => string }>({
    abort: () => {},
    getInterim: () => "",
  });

  const question = questions[index];
  const total = questions.length;
  // Read straight off the ref: every recorded answer also moves the stage, so a
  // render always follows a change here.
  const answeredCount = Object.keys(answersRef.current).length;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  // ------------------------------------------------------------------ audio --

  const clearTimers = () => {
    if (quietRef.current) {
      clearTimeout(quietRef.current);
      quietRef.current = null;
    }
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
  };

  const stopLine = () => {
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
  };

  /**
   * Play one passage and continue when it stops.
   *
   * Every failure path — a missing bank file, no TTS key, a blocked autoplay, a
   * clip that never ends — calls `next` anyway: the quiz must move on rather than
   * wait for audio that is not coming. `next` is a plain callback, so the flow is
   * driven by playback rather than by watching state.
   */
  async function playLine(source: LineSource, next: () => void) {
    stopLine();
    clearTimers();

    let url: string;
    if ("url" in source) {
      url = source.url;
    } else if ("key" in source) {
      // A bank line is a file when the bank has been generated, and is
      // synthesized under the same key the first time if it has not.
      url = `/api/chat/speech/${source.key}`;
      return playUrl(url, next, () => void playByText(source.text, next));
    } else {
      return playByText(source.text, next);
    }

    return playUrl(url, next, () => {
      if ("fallbackText" in source && source.fallbackText) {
        void playByText(source.fallbackText, next);
        return;
      }
      next();
    });
  }

  /** Synthesize (or replay from the server's cache) and then play. */
  async function playByText(text: string, next: () => void) {
    try {
      const res = await fetch("/api/chat/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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
      setError("Voice audio could not be reached. You can continue the quiz manually.");
      return next();
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
    // A stalled request would otherwise hold the whole quiz.
    capRef.current = setTimeout(() => once(onProblem), QUESTION_CAP_MS);
    void audio.play().catch(() => once(onProblem));
  }

  // ------------------------------------------------------------ the flow ---

  /** Ask the current question: its clip when it has one, else live synthesis. */
  function askQuestion() {
    const current = questions[indexRef.current];
    if (!current) return;

    missesRef.current = 0;
    draftRef.current = "";
    setHeard("");
    setTyped("");
    setFeedback(null);
    setStage("asking");

    const spoken = questionNarration(current, indexRef.current + 1, total);
    const openMic = () => setStage("listening");

    // The remaining clips may still be rendering after quiz generation returned.
    // Probe the protected file route for every question and fall back to live
    // synthesis when the file is not ready (or this is an older quiz).
    void playLine(
      {
        url: `/api/quiz/${quizId}/audio/${current.audioFile ?? `${current.id}.wav`}`,
        fallbackText: spoken,
      },
      openMic
    );
  }

  /** Play the current question again — a clip replay costs nothing. */
  function replay() {
    clearTimers();
    micRef.current.abort();
    setHeard("");
    draftRef.current = "";
    askQuestion();
  }

  function advance() {
    const nextIndex = indexRef.current + 1;
    if (nextIndex >= total) {
      setStage("finished");
      void playLine(
        { key: "quiz-finished", text: quizLine("quiz-finished").text },
        () => {
          if (leftRef.current) return;
          onFinish(
            Object.entries(answersRef.current).map(([questionId, userAnswer]) => ({
              questionId,
              userAnswer,
            }))
          );
        }
      );
      return;
    }
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    askQuestion();
  }

  /** Record an answer, say how it went, then move on. */
  async function finishQuestion(current: SafeQuestion, answer: string, heardText: string) {
    answersRef.current[current.id] = answer;
    setStage("judging");

    let verdict: Awaited<ReturnType<typeof gradeQuizAnswer>>;
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
      // Nothing honest to say without a verdict, so the quiz reports it and
      // carries on instead of inventing feedback.
      setError(err instanceof Error ? err.message : "Could not grade that answer");
      setStage("verdict");
      void playLine({ text: "Moving on." }, advance);
      return;
    }
    if (leftRef.current) return;

    setFeedback({
      correct: verdict.correct,
      heard: heardText,
      correctAnswer: verdict.correctAnswer,
      explanation: verdict.explanation,
    });
    setStage("verdict");

    const key = pickLine(
      verdict.correct ? QUIZ_CORRECT_KEYS : QUIZ_WRONG_KEYS,
      lastVerdictRef.current
    );
    lastVerdictRef.current = key;
    const line = quizLine(key);

    void playLine({ key, text: line.text }, () => {
      if (verdict.correct) {
        advance();
        return;
      }
      void playLine({ text: answerReveal(current, verdict.correctAnswer) }, advance);
    });
  }

  /** Judge what was said, or ask again when nothing usable came through. */
  async function judge(spoken: string) {
    const current = questions[indexRef.current];
    if (!current || stageRef.current !== "listening") return;

    clearTimers();
    micRef.current.abort();
    setStage("judging");

    // Include the words the browser has heard but not yet committed: a student
    // who pauses mid-sentence should not lose the second half of it.
    const text = `${spoken} ${micRef.current.getInterim()}`.replace(/\s+/g, " ").trim();
    const resolved = resolveSpokenAnswer(current, text);
    // A choice question answered with words that name no option was not really
    // answered — asking again beats marking someone wrong for what the mic
    // misheard. A short answer is taken as it was said, because that is the
    // answer itself.
    const isChoice = current.type !== "short_answer";
    const usable = text.length > 0 && (!isChoice || resolved.source !== "verbatim");

    if (!usable && missesRef.current < MISS_LIMIT) {
      missesRef.current += 1;
      draftRef.current = "";
      setHeard("");
      const line = quizLine("quiz-not-heard");
      setStage("asking");
      void playLine({ key: "quiz-not-heard", text: line.text }, () =>
        setStage("listening")
      );
      return;
    }

    await finishQuestion(current, usable ? resolved.answer : "", text);
  }

  /** The student stopped talking: give them a beat, then judge. */
  function handleSpoken(finalText: string) {
    if (stageRef.current !== "listening") return;
    const trimmed = finalText.trim();
    if (!trimmed) return;

    // Commands are checked before answers: "repeat" is a word said to the quiz.
    if (isCommand(trimmed, REPEAT_WORDS)) {
      replay();
      return;
    }
    if (isCommand(trimmed, STOP_WORDS)) {
      leave();
      return;
    }
    if (isCommand(trimmed, SKIP_WORDS)) {
      void judge("");
      return;
    }

    draftRef.current = `${draftRef.current} ${trimmed}`.trim();
    setHeard(draftRef.current);
    if (quietRef.current) clearTimeout(quietRef.current);
    quietRef.current = setTimeout(() => void judge(draftRef.current), AUTO_SUBMIT_MS);
  }

  function leave() {
    leftRef.current = true;
    clearTimers();
    stopLine();
    micRef.current.abort();
    onLeave();
  }

  function start() {
    setError(null);
    setStage("asking");
    const line = quizLine("quiz-intro");
    void playLine({ key: "quiz-intro", text: line.text }, askQuestion);
  }

  // ---------------------------------------------------------- recognition ---

  // Declared after the flow above: the browser calls this back with a transcript,
  // and everything it needs is already in scope.
  const {
    supported,
    listening,
    interim,
    blocked,
    start: startMic,
    abort: abortMic,
    getInterim,
  } = useSpeechRecognition(handleSpoken);

  useEffect(() => {
    micRef.current = { abort: abortMic, getInterim };
  }, [abortMic, getInterim]);

  const canListen = supported && !blocked;

  /** The mic is open only while a question is actually waiting for an answer. */
  useEffect(() => {
    if (stage !== "listening" || !canListen) {
      abortMic();
      return;
    }
    startMic(speechLangFor(detectLanguage(question?.question ?? "")), {
      continuous: true,
      keepInterim: true,
    });
    return () => abortMic();
  }, [stage, canListen, startMic, abortMic, question?.question]);

  // A quiz that is left, or a screen that goes away, must not keep talking or
  // listening behind the student's back.
  useEffect(
    () => () => {
      leftRef.current = true;
      if (quietRef.current) clearTimeout(quietRef.current);
      if (capRef.current) clearTimeout(capRef.current);
      stopLine();
      micRef.current.abort();
    },
    []
  );

  // ----------------------------------------------------------------- view ---

  if (!question) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div className={cn(panel, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={leave}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave voice quiz
          </button>

          <div className="flex items-center gap-2">
            <span className="hidden max-w-[16rem] truncate text-xs text-zinc-400 sm:inline dark:text-zinc-500">
              {quizTitle}
            </span>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Question {index + 1} of {total}
            </span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {answeredCount} answered
            </span>
          </div>
        </div>

        {/* One segment per question — answered, current, or still to come. */}
        <div
          className="mt-3 flex items-center gap-1.5"
          role="group"
          aria-label="Question progress"
        >
          {questions.map((entry, position) => {
            const done = entry.id in answersRef.current;
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
      </div>

      <section className={cn(panel, "p-6 sm:p-8")}>
        {stage === "ready" ? (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-lg shadow-brand-500/30">
              <Mic className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {quizTitle}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {total} questions. Each one is read aloud, you answer out loud, and
              the next starts by itself. Say “repeat”, “skip” or “stop” at any
              time.
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
        ) : (
          <>
            {/* The orb states the stage without words; the labels under it name
                it for anyone who cannot see the colour. */}
            <div className="flex flex-col items-center text-center">
              <MicOrb stage={stage} correct={feedback?.correct ?? null} />

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
                  {TYPE_LABELS[question.type] ?? "Question"}
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {STAGE_VIEW[stage].label}
                </span>
              </div>

              <p className="mt-2 max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                {STAGE_VIEW[stage].hint}
              </p>
            </div>

            <p className="mt-6 text-lg font-medium leading-8 text-zinc-900 dark:text-zinc-100 sm:text-xl">
              {question.question}
            </p>

            {/* The options in the same lettered cards the manual quiz uses, so
                the two ways of taking a quiz read alike. */}
            {(question.options ?? []).length > 0 && (
              <div className="mt-5 space-y-2.5">
                {(question.options ?? []).map((option, position) => {
                  const isAnswer =
                    feedback !== null &&
                    option.trim().toLowerCase() ===
                      feedback.correctAnswer.trim().toLowerCase();
                  return (
                    <div
                      key={option}
                      className={cn(
                        "flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-sm transition-all duration-200",
                        isAnswer
                          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:ring-emerald-500/25"
                          : "border-zinc-200 dark:border-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold",
                          isAnswer
                            ? "border-emerald-400 bg-emerald-400 text-emerald-950"
                            : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                        )}
                      >
                        {optionLetter(position)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 leading-6",
                          isAnswer
                            ? "font-medium text-emerald-900 dark:text-emerald-200"
                            : "text-zinc-700 dark:text-zinc-300"
                        )}
                      >
                        {option}
                      </span>
                      {isAnswer && (
                        <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {stage === "listening" && (heard || interim) && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
                <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                <span className="min-w-0">“{heard || interim}”</span>
              </p>
            )}

            {feedback && (
              <div
                className={cn(
                  "mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm ring-1",
                  feedback.correct
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                    : "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    feedback.correct
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
                  )}
                >
                  {feedback.correct ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    {feedback.correct ? "Correct" : "Not this one"}
                    {feedback.heard.trim().length > 0 && (
                      <span className="font-normal">
                        {" "}
                        — you said “{feedback.heard}”
                      </span>
                    )}
                  </p>
                  {!feedback.correct && (
                    <p className="mt-1">
                      The answer is{" "}
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">
                        {feedback.correctAnswer}
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

            {stage === "finished" && (
              <p className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-3 text-sm font-medium text-brand-800 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
                <Loader2 className="h-4 w-4 animate-spin" />
                All {total} answered — adding up your score…
              </p>
            )}

            {!canListen && (
              <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
                {blocked
                  ? "The browser refused the microphone — allow it, or pick your answer below."
                  : "This browser can't listen for speech — pick your answer below instead."}
              </p>
            )}

            {/* Picking by hand, for a browser or a moment with no microphone. A
                short answer has no options, so it gets a field instead. */}
            {!canListen && stage !== "verdict" && question.type === "short_answer" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = typed.trim();
                  if (!value) return;
                  void finishQuestion(question, value, value);
                }}
                className="mt-4 flex flex-wrap items-center gap-2"
              >
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder="Type your answer"
                  aria-label="Your answer"
                  className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
                />
                <button
                  type="submit"
                  disabled={typed.trim().length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-4 w-4" />
                  Answer
                </button>
              </form>
            )}

            {!canListen && stage !== "verdict" && question.type !== "short_answer" && (
              <div className="mt-4 space-y-2.5">
                {(question.options ?? []).map((option, position) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => void finishQuestion(question, option, option)}
                    className="group flex w-full items-center gap-3.5 rounded-2xl border border-zinc-200 px-4 py-3.5 text-left text-sm text-zinc-700 transition-all duration-200 hover:border-brand-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200 text-xs font-bold text-zinc-500 transition-colors group-hover:border-brand-300 group-hover:text-brand-700 dark:border-zinc-700 dark:text-zinc-400">
                      {optionLetter(position)}
                    </span>
                    <span className="min-w-0 flex-1 leading-6">{option}</span>
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
                {error}
              </p>
            )}
          </>
        )}
      </section>

      {stage !== "ready" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={replay}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Repeat className="h-4 w-4" />
            Repeat question
          </button>
          {stage === "listening" && (
            <button
              type="button"
              onClick={() => void judge("")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <SkipForward className="h-4 w-4" />
              Skip
            </button>
          )}
          {listening && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <MicOff className="h-3.5 w-3.5" />
              Say “repeat”, “skip” or “stop”.
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
