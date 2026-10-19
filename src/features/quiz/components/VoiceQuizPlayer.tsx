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
// Grading: a question still reaches the client without its answer (see
// SafeQuestion). The player fetches the quiz's small answer key once, while the
// intro is playing, and checks each answer locally with the same comparison the
// server uses — a per-answer round trip left the student looking at "Checking
// that answer…" between questions. The finished attempt is graded again by
// `submitQuizAttempt`, which remains the authority for the stored score. If the
// prefetch failed, the player falls back to `gradeQuizAnswer`.

import { useCallback, useEffect, useRef, useState } from "react";
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
import { useVoiceNav } from "@/features/voice-nav/context";
import { MicOrb } from "./MicOrb";
import { isAnswerCorrect } from "../lib/grading";
import { answerReveal, optionLetter, questionNarration } from "../lib/narration";
import {
  getQuizAnswerKey,
  gradeQuizAnswer,
  type QuizAnswerKeyEntry,
  type SafeQuestion,
} from "../server/actions";

/** Quiet time after the last recognised word before the answer is judged. */
const AUTO_SUBMIT_MS = 900;
/** Do not leave the voice flow stuck when the server or database is unavailable. */
const ANSWER_CHECK_TIMEOUT_MS = 8_000;
/** How many times a question is asked again when nothing usable was heard. */
const MISS_LIMIT = 2;
/** Ceiling on one question's read-aloud, in case a clip never reports its end. */
const QUESTION_CAP_MS = 45_000;
/**
 * Silence allowed while the mic is open. Without this, a recognizer that opens
 * but never returns a word leaves the quiz on the question forever; the same
 * "I did not catch that" path as a misheard answer is used instead.
 */
const LISTEN_WATCHDOG_MS = 10_000;
/** A live synthesis that never comes back must not hold the quiz. */
const SPEECH_REQUEST_TIMEOUT_MS = 30_000;
/**
 * The spoken answer reveal is optional: the answer is already on screen and the
 * verdict has been said. Waiting the full synthesis timeout before the next
 * question made a wrong answer feel like a freeze, so the quiz moves on without
 * the line if it is still rendering.
 */
const REVEAL_TIMEOUT_MS = 8_000;

/**
 * Recognition languages the browser almost never serves, and the closest one it
 * does. A Cebuano question must not leave the microphone asking for "ceb-PH"
 * forever — that is one more way the quiz hears nothing at all.
 */
const LANG_FALLBACK: Record<string, string> = {
  "ceb-PH": "fil-PH",
  "fil-PH": "en-PH",
};

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
  "ulita",
  "usba",
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
    hint: "Say the letter or the words, then pause — or tap an option.",
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
  // Typed answer for a short-answer question. It stays available even while the
  // microphone works, so a question can always be answered by hand.
  const [typed, setTyped] = useState("");
  // A render-safe mirror of which questions have an answer. `answersRef` is the
  // source the flow writes to, but refs must not be read while rendering.
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  // Bumped to reopen the mic after Chrome closes a recognition session on its
  // own. Without it the quiz still says "Listening" while nothing is recording.
  const [micSession, setMicSession] = useState(0);

  const lineRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // A live synthesis still in flight when the student taps an answer or leaves.
  // `cancelled` separates that deliberate stop from the timeout abort below.
  const synthesisRef = useRef<{
    controller: AbortController;
    cancelled: boolean;
  } | null>(null);
  /**
   * The quiz's answer key, prefetched while the intro is being read.
   *
   * Asking the server to judge each answer took long enough to sit on
   * "Checking that answer…" between questions. The key is fetched once, in
   * parallel with audio that is playing anyway, and the same `isAnswerCorrect`
   * comparison gives an instant verdict. `submitQuizAttempt` still grades the
   * finished attempt on the server, so the stored score never trusts this.
   */
  const answerKeyRef = useRef<Map<string, QuizAnswerKeyEntry>>(new Map());
  const answersRef = useRef<Record<string, string>>({});
  const missesRef = useRef(0);
  const draftRef = useRef("");
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);
  const stageRef = useRef<Stage>("ready");
  const leftRef = useRef(false);
  /**
   * The recognition language last tried for a question. Kept across restarts so a
   * rejected Cebuano/Filipino question settles on a language the browser serves
   * instead of cycling back to the one it just refused.
   */
  const micLangRef = useRef<{ question: string; lang: string } | null>(null);
  const lastVerdictRef = useRef<QuizLineKey | null>(null);
  // The microphone lives in the hook below, which is declared after the flow that
  // uses it; this ref is how the flow reaches it without a circular declaration.
  const micRef = useRef<{ abort: () => void; getInterim: () => string }>({
    abort: () => {},
    getInterim: () => "",
  });
  // The silence watchdog outlives one render, so it reaches the latest `judge`
  // through a ref instead of capturing the first one.
  const judgeRef = useRef<(spoken: string) => void>(() => {});
  const clearMicErrorRef = useRef<() => void>(() => {});
  const clearMicInterimRef = useRef<() => void>(() => {});

  const question = questions[index];
  const total = questions.length;
  const answeredCount = answeredIds.length;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  /**
   * Load the answer key once. It is one small query, and it makes every later
   * verdict immediate. A failure is harmless: `finishQuestion` falls back to the
   * per-answer server action, and pressing Start retries the prefetch if it is
   * still missing.
   */
  const loadAnswerKey = useCallback(async () => {
    try {
      const key = await getQuizAnswerKey(quizId);
      if (leftRef.current) return;
      answerKeyRef.current = new Map(
        key.map((entry) => [entry.questionId, entry])
      );
    } catch (err) {
      console.warn("[voice-quiz] could not prefetch the answer key:", err);
    }
  }, [quizId]);

  // Fetch it now, while the student is still on the intro or the first question.
  useEffect(() => {
    void loadAnswerKey();
  }, [loadAnswerKey]);

  // Voice navigation listens continuously on this page. Chrome has one speech
  // recognition input per tab, so leaving it running starves the quiz's own
  // recognizer — the student answers and nothing is heard. Pause it while the
  // voice quiz is mounted; its preference is untouched and it resumes on leave.
  const { suspendListening, resumeListening } = useVoiceNav();
  useEffect(() => {
    suspendListening();
    return () => resumeListening();
  }, [suspendListening, resumeListening]);

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
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  /**
   * Re-arm the silence watchdog for the current listening window. Every word
   * restarts it, so it only fires when the student has genuinely said nothing.
   */
  const armWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      if (stageRef.current !== "listening") return;
      judgeRef.current("");
    }, LISTEN_WATCHDOG_MS);
  }, []);

  const stopLine = () => {
    // A queued synthesis would otherwise play over the verdict or the next page.
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
  };

  /**
   * Play one passage and continue when it stops.
   *
   * Every failure path — a missing bank file, no TTS key, a blocked autoplay, a
   * clip that never ends — calls `next` anyway: the quiz must move on rather than
   * wait for audio that is not coming. `next` is a plain callback, so the flow is
   * driven by playback rather than by watching state.
   */
  async function playLine(
    source: LineSource,
    next: () => void,
    options?: { timeoutMs?: number }
  ) {
    stopLine();
    clearTimers();

    let url: string;
    if ("url" in source) {
      url = source.url;
    } else if ("key" in source) {
      // A bank line is a file when the bank has been generated, and is
      // synthesized under the same key the first time if it has not.
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

  /** Synthesize (or replay from the server's cache) and then play. */
  async function playByText(
    text: string,
    next: () => void,
    timeoutMs = SPEECH_REQUEST_TIMEOUT_MS
  ) {
    // A synthesis request may be slow on the free TTS tier. Cap it, and move on
    // without the line rather than leaving the quiz looking frozen.
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
      // A line stopped by `stopLine` was cancelled on purpose: do not report it
      // and do not continue the flow it belonged to. A timeout still moves on.
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
    // A recognition error belongs to the question that produced it; the next
    // question gets a fresh attempt with the microphone. The buffer is cleared
    // too: otherwise an interim answer that was judged without a final result
    // would still be read as this new question's answer by the watchdog.
    clearMicErrorRef.current();
    clearMicInterimRef.current();
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
    if (leftRef.current) return;
    answersRef.current[current.id] = answer;
    setAnsweredIds((ids) =>
      ids.includes(current.id) ? ids : [...ids, current.id]
    );

    // The prefetched key is the fast path: no round trip, so the verdict is
    // ready in the same render and the "checking" spinner never appears.
    const prefetched = answerKeyRef.current.get(current.id);
    let verdict: {
      correct: boolean;
      correctAnswer: string;
      explanation: string | null;
    };

    if (prefetched) {
      verdict = {
        correct: isAnswerCorrect(
          prefetched.type,
          prefetched.correctAnswer,
          answer
        ),
        correctAnswer: prefetched.correctAnswer,
        explanation: prefetched.explanation,
      };
    } else {
      setStage("judging");
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
        const line = quizLine("quiz-move-on");
        void playLine({ key: "quiz-move-on", text: line.text }, advance);
        return;
      }
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
      void playLine(
        { text: answerReveal(current, verdict.correctAnswer) },
        advance,
        { timeoutMs: REVEAL_TIMEOUT_MS }
      );
    });
  }

  /**
   * Judge what was said, or ask again when nothing usable came through.
   * `force` is for a deliberate skip: it records the empty answer and moves on
   * instead of spending the two "I did not catch that" re-asks on it.
   */
  async function judge(spoken: string, options?: { force?: boolean }) {
    const current = questions[indexRef.current];
    if (!current || stageRef.current !== "listening") return;

    clearTimers();
    micRef.current.abort();

    // `finishQuestion` only enters "judging" when it actually has to ask the
    // server. With the prefetched key the verdict replaces this stage in the
    // same update, so the spinner never appears.

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

    if (!usable && !options?.force && missesRef.current < MISS_LIMIT) {
      missesRef.current += 1;
      draftRef.current = "";
      setHeard("");
      // The re-ask starts a fresh listen: keeping the words that were just
      // judged unusable would prepend them to the next answer. The error is
      // cleared too, so a transient recognition failure gets another attempt.
      clearMicInterimRef.current();
      clearMicErrorRef.current();
      const line = quizLine("quiz-not-heard");
      setStage("asking");
      void playLine({ key: "quiz-not-heard", text: line.text }, () =>
        setStage("listening")
      );
      return;
    }

    await finishQuestion(current, usable ? resolved.answer : "", text);
  }

  // No dependency array: `judge` closes over the current question and refs, so
  // the watchdog must always call this render's version.
  useEffect(() => {
    judgeRef.current = judge;
  });

  /**
   * Answer without the microphone: a tap on an option or a typed short answer.
   *
   * The voice quiz used to offer this only after the recognizer was known to be
   * dead. A microphone that opens but never returns words is indistinguishable
   * from one that works, so the student was left on question one with no way to
   * answer. Clicking always wins: it stops the question clip and any pending
   * listen before grading.
   */
  function answerByHand(answer: string) {
    if (stageRef.current !== "listening" && stageRef.current !== "asking") return;
    const current = questions[indexRef.current];
    if (!current) return;
    clearTimers();
    micRef.current.abort();
    stopLine();
    void finishQuestion(current, answer, answer);
  }

  /**
   * The browser has heard words but has not committed to them yet.
   *
   * Waiting only for a final result is what left the voice quiz stuck on the
   * first question: Chrome can keep a short answer as an interim result, so no
   * timer ever started and the mic stayed open forever. Treat the interim words
   * as an answer too — the same quiet window after the last one decides when to
   * judge. Commands work the moment they are heard.
   */
  function handleInterimSpoken(interimText: string) {
    if (stageRef.current !== "listening") return;
    const trimmed = interimText.trim();
    if (!trimmed) return;

    if (isCommand(trimmed, REPEAT_WORDS)) {
      replay();
      return;
    }
    if (isCommand(trimmed, STOP_WORDS)) {
      leave();
      return;
    }
    if (isCommand(trimmed, SKIP_WORDS)) {
      void judge("", { force: true });
      return;
    }

    // Show the words immediately; `judge` reads the live interim text too, so
    // nothing is lost if no final result ever arrives.
    setHeard(
      `${draftRef.current} ${trimmed}`.replace(/\s+/g, " ").trim()
    );
    armWatchdog();
    if (quietRef.current) clearTimeout(quietRef.current);
    quietRef.current = setTimeout(
      () => void judge(draftRef.current),
      AUTO_SUBMIT_MS
    );
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
      void judge("", { force: true });
      return;
    }

    draftRef.current = `${draftRef.current} ${trimmed}`.trim();
    setHeard(draftRef.current);
    armWatchdog();
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
    // The prefetch normally finished long ago; retry a failed one now rather
    // than falling back to a server round trip for the first answer.
    if (answerKeyRef.current.size === 0) void loadAnswerKey();
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
    error: recognitionError,
    start: startMic,
    abort: abortMic,
    clearError: clearMicError,
    clearInterim: clearMicInterim,
    getInterim,
  } = useSpeechRecognition(handleSpoken, handleInterimSpoken);

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

  // The browser refused the question's own language and it is already the
  // English fallback: there is nothing left to step down to.
  const languageUnavailable =
    recognitionError?.code === "language-not-supported" &&
    speechLangFor(detectLanguage(questionText)) === "en-PH";
  // A connection or service error also leaves the mic silent. Rather than loop
  // restarting it, let the student tap or type the answer.
  const recognitionFailed =
    recognitionError !== null && recognitionError.code !== "language-not-supported";
  const canListen =
    supported && !blocked && !languageUnavailable && !recognitionFailed;

  /** The mic is open only while a question is actually waiting for an answer. */
  useEffect(() => {
    if (stage !== "listening" || !canListen) {
      abortMic();
      return;
    }

    // A generated quiz can be in Cebuano or Filipino, and many browsers only
    // serve English. Step down to the closest supported language instead of
    // retrying one the service rejects forever.
    const previous = micLangRef.current;
    let attempt =
      previous?.question === questionText
        ? previous.lang
        : speechLangFor(detectLanguage(questionText));

    if (
      recognitionError?.code === "language-not-supported" &&
      previous?.question === questionText &&
      previous.lang === attempt
    ) {
      const fallback = LANG_FALLBACK[attempt];
      if (!fallback) return;
      attempt = fallback;
    }
    micLangRef.current = { question: questionText, lang: attempt };

    startMic(attempt, {
      continuous: true,
      keepInterim: true,
      // The question clip is played through a plain <audio> element and the mic
      // opens only after it ends, so there is no tutor playback to filter. The
      // shared engine may still be winding down a navigation confirmation; the
      // echo guard would otherwise drop the student's answer entirely.
      listenWhileSpeaking: true,
    });
    return () => abortMic();
  }, [
    stage,
    canListen,
    startMic,
    abortMic,
    questionText,
    recognitionError,
    micSession,
  ]);

  /**
   * The silence clock belongs to the listening window, not to one recognition
   * session: reopening the mic after Chrome ends it must not postpone the
   * watchdog forever. Only a new question, a re-ask, or a heard word re-arms it.
   */
  useEffect(() => {
    if (stage !== "listening" || !canListen) return;
    armWatchdog();
    return () => {
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, [stage, canListen, armWatchdog]);

  /**
   * Chrome ends a recognition session after a few seconds of silence even with
   * `continuous: true`. The quiz has to reopen it while the question is still
   * waiting, or the screen says "Listening" with the microphone already closed
   * — the student answers and nothing happens.
   */
  useEffect(() => {
    if (stage !== "listening" || !canListen || listening) return;
    // Words were just heard and the quiet timer is about to grade them. Do not
    // reopen the mic into the gap: it would catch the room and reset that timer
    // with noise before the answer is judged.
    if (quietRef.current) return;
    // The last language the browser served has no fallback left. Reopening it
    // would only loop; the options are tappable instead.
    if (recognitionError?.code === "language-not-supported") {
      const attempted = micLangRef.current;
      if (
        attempted?.question === questionText &&
        !LANG_FALLBACK[attempted.lang]
      ) {
        return;
      }
    }
    const timer = setTimeout(() => setMicSession((session) => session + 1), 500);
    return () => clearTimeout(timer);
  }, [stage, canListen, listening, recognitionError, questionText, micSession]);

  // A quiz that is left, or a screen that goes away, must not keep talking or
  // listening behind the student's back.
  useEffect(
    () => () => {
      leftRef.current = true;
      if (quietRef.current) clearTimeout(quietRef.current);
      if (capRef.current) clearTimeout(capRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
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
                    <button
                      key={option}
                      type="button"
                      onClick={() => answerByHand(option)}
                      disabled={stage !== "listening" && stage !== "asking"}
                      className={cn(
                        "flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left text-sm transition-all duration-200",
                        isAnswer
                          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:ring-emerald-500/25"
                          : "border-zinc-200 hover:border-brand-300 hover:bg-zinc-50 disabled:hover:border-zinc-200 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60 dark:disabled:hover:border-zinc-700 dark:disabled:hover:bg-transparent",
                        "disabled:cursor-default"
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
                    </button>
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
                  ? "The browser refused the microphone — allow it, or tap the correct option above."
                  : "This browser can't listen for speech — tap the correct option above, or type a short answer."}
              </p>
            )}

            {/* A short answer has no options to tap, so the field is always
                available while the question waits — even with a live mic. */}
            {(stage === "listening" || stage === "asking") &&
              question.type === "short_answer" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = typed.trim();
                  if (!value) return;
                  answerByHand(value);
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
              onClick={() => void judge("", { force: true })}
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
