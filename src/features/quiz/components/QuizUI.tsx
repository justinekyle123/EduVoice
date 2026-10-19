"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleSlash,
  ClipboardList,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  RotateCcw,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useVoiceNavCommands,
} from "@/features/voice-nav/hooks/useVoiceNavCommands";
import type { PageCommand } from "@/features/voice-nav/context";
import { getRoomState } from "@/features/rooms/server/actions";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { getSpeechEngine } from "@/features/chat/lib/speechEngine";
import { VoiceQuizPlayer } from "./VoiceQuizPlayer";
import {
  generateQuiz,
  generateQuizFromFile,
  getRecentAttempts,
  getRecentQuizzes,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAnswerKeyEntry,
} from "../server/actions";

type SafeQuestion = Awaited<ReturnType<typeof generateQuiz>>["questions"][number];

/** Which documents the quiz writer can read directly. */
const QUIZ_FILE_ACCEPT = ".pdf,.txt,.md,.csv";

function canUseFile(file: File) {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || type.startsWith("text/")) return true;
  return [".pdf", ".txt", ".md", ".csv"].some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );
}
type AttemptResult = Awaited<ReturnType<typeof submitQuizAttempt>>;
type RecentQuiz = Awaited<ReturnType<typeof getRecentQuizzes>>[number];
type RecentAttempt = Awaited<ReturnType<typeof getRecentAttempts>>[number];
type AudioStatus = "ready" | "quota" | "unavailable";

const QUESTION_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const quietButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function QuizUI({
  roomId,
  retakeQuizId,
  initialTopic,
}: {
  roomId?: string | null;
  /** A finished quiz to reopen on arrival (from the history & scores page). */
  retakeQuizId?: string | null;
  /** A topic to name up front (the progress page's "practise this" link). */
  initialTopic?: string | null;
}) {
  const [phase, setPhase] = useState<
    "lobby" | "choose" | "taking" | "voice" | "results"
  >("lobby");
  const [roomName, setRoomName] = useState<string | null>(null);
  // The quiz being taken — a voice attempt needs its id, because that is where
  // its pre-rendered clips live (see features/quiz/server/quizAudio.ts).
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");

  const [topic, setTopic] = useState(initialTopic ?? "");
  const [count, setCount] = useState(5);
  // When set, the quiz is written from this uploaded file instead of a topic.
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [questions, setQuestions] = useState<SafeQuestion[]>([]);
  // The answers come with the attempt (see `startQuizAttempt`), so the voice
  // player can mark each answer the moment it is spoken instead of asking the
  // server to check it while the student waits.
  const [answerKey, setAnswerKey] = useState<QuizAnswerKeyEntry[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("ready");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Manual quiz position. Questions are shown one card at a time, like the
  // flashcard review, rather than as one long scrolling list.
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<AttemptResult | null>(null);

  const [recentQuizzes, setRecentQuizzes] = useState<RecentQuiz[]>([]);
  const [recentAttempts, setRecentAttempts] = useState<RecentAttempt[]>([]);
  // Arriving with a retake already queued (history & scores → Repeat), the
  // lobby opens in its "start" state rather than going idle first.
  const [busy, setBusy] = useState<"generate" | "start" | "submit" | null>(
    retakeQuizId ? "start" : null
  );
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const [quizzes, attempts] = await Promise.all([
      getRecentQuizzes(),
      getRecentAttempts(),
    ]);
    setRecentQuizzes(quizzes);
    setRecentAttempts(attempts);
  }, []);

  // Room context: tells the student their score will land on a shared board.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    getRoomState(roomId)
      .then((state) => {
        if (!cancelled) setRoomName(state?.room.name ?? null);
      })
      .catch(() => {
        // The quiz still works without the room banner.
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRecentQuizzes(), getRecentAttempts()])
      .then(([quizzes, attempts]) => {
        if (cancelled) return;
        setRecentQuizzes(quizzes);
        setRecentAttempts(attempts);
      })
      .catch(() => {
        // History is a convenience; the generator above still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const beginAttempt = useCallback(
    (next: {
      questions: SafeQuestion[];
      attemptId: string;
      answerKey?: QuizAnswerKeyEntry[];
    }) => {
      setQuestions(next.questions);
      setAnswerKey(next.answerKey ?? []);
      setAttemptId(next.attemptId);
      setAudioStatus((next as { audioStatus?: AudioStatus }).audioStatus ?? "ready");
      setAnswers({});
      setCurrent(0);
      setResult(null);
      setError(null);
      // A written quiz — or a retake — is offered the same two ways to take it.
      setPhase("choose");
    },
    []
  );

  // Opened from the history & scores page's "Repeat" button: jump straight
  // into a fresh attempt at that finished quiz instead of the lobby.
  useEffect(() => {
    if (!retakeQuizId) return;
    let cancelled = false;
    startQuizAttempt({ quizId: retakeQuizId, roomId })
      .then((opened) => {
        if (cancelled) return;
        setQuizId(opened.quiz.id);
        setQuizTitle(opened.quiz.title);
        beginAttempt(opened);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not open that quiz"));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [retakeQuizId, roomId, beginAttempt]);

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!picked) return;
    if (!canUseFile(picked)) {
      setError("Attach a PDF or a text file (PDF, TXT, MD, CSV).");
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function startQuiz() {
    if (busy) return;
    if (!file && topic.trim().length < 3) {
      setError("Name a topic, or attach a file to base the quiz on.");
      return;
    }

    setBusy("generate");
    setError(null);
    try {
      let created;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("topic", topic);
        form.append("count", String(count));
        if (roomId) form.append("roomId", roomId);
        created = await generateQuizFromFile(form);
      } else {
        created = await generateQuiz({ topic, count, roomId });
      }
      setFile(null);
      setQuizId(created.quiz.id);
      setQuizTitle(created.quiz.title);
      beginAttempt(created);
    } catch (err) {
      setError(errorMessage(err, "Could not generate a quiz"));
    } finally {
      setBusy(null);
    }
  }

  function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    void startQuiz();
  }

  // Named `id` rather than `quizId`: the state holding the quiz being taken uses
  // that name, and a parameter that shadows it reads like a bug.
  async function handleRetake(id: string) {
    if (busy) return;
    setBusy("start");
    setError(null);
    try {
      const opened = await startQuizAttempt({ quizId: id, roomId });
      setQuizId(opened.quiz.id);
      setQuizTitle(opened.quiz.title);
      beginAttempt(opened);
    } catch (err) {
      setError(errorMessage(err, "Could not open that quiz"));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Grade and close the attempt out. Both ways of taking a quiz end here: the
   * on-screen answers come from `answers`, the voice quiz hands over the answers
   * it collected out loud, and either list is graded the same way.
   */
  async function gradeAttempt(list: { questionId: string; userAnswer: string }[]) {
    if (!attemptId || busy) return;

    setBusy("submit");
    setError(null);
    try {
      const graded = await submitQuizAttempt({ attemptId, answers: list });
      setResult(graded);
      setPhase("results");
      await refreshHistory();
    } catch (err) {
      setError(errorMessage(err, "Could not submit your answers"));
    } finally {
      setBusy(null);
    }
  }

  function handleSubmit() {
    return gradeAttempt(
      questions.map((question) => ({
        questionId: question.id,
        userAnswer: answers[question.id] ?? "",
      }))
    );
  }

  const answeredCount = questions.filter((question) =>
    (answers[question.id] ?? "").trim().length > 0
  ).length;

  // Read only to tell the student, before they pick voice mode, whether this
  // browser can listen at all; the microphone itself belongs to the player.
  const { supported: micSupported } = useSpeechRecognition(() => {});
  const withoutClips = questions.filter((question) => !question.audioFile).length;

  // Voice Navigation Mode (feature 6.14): the quiz exposes its own commands so a
  // student can drive it by voice — "start the quiz", "submit answers", "take
  // another quiz". The handlers are read through a ref that is refreshed every
  // render, so the registered commands never capture a stale `topic`/`busy`.
  const voiceActionsRef = useRef({
    start: () => {},
    submit: () => {},
    leave: () => {},
    voice: () => {},
    manual: () => {},
  });
  useEffect(() => {
    voiceActionsRef.current = {
      start: () => void startQuiz(),
      submit: () => void handleSubmit(),
      leave: () => {
        setPhase("lobby");
        setResult(null);
      },
      // Choosing how to take the quiz only means something on the picker, so a
      // command heard anywhere else is ignored rather than jumping the student
      // into a half-open attempt.
      voice: () => {
        if (phase !== "choose") return;
        getSpeechEngine().unlock();
        setPhase("voice");
      },
      manual: () => {
        if (phase !== "choose") return;
        setPhase("taking");
      },
    };
  });

  const voiceCommands = useMemo<PageCommand[]>(
    () => [
      {
        id: "quiz-start",
        description: "Start a quiz on the topic in the field",
        phrases: ["start the quiz", "start quiz", "generate a quiz", "take the quiz"],
        // The confirmation is fixed, so it plays the pre-generated line instead
        // of being synthesized (see features/chat/lib/phrases.ts).
        spokenKey: "nav-quiz-start",
        run: () => voiceActionsRef.current.start(),
      },
      {
        id: "quiz-voice",
        description: "Take the quiz that was just written by voice",
        phrases: ["voice quiz", "take the voice quiz", "start the voice quiz"],
        spokenKey: "nav-quiz-voice",
        run: () => voiceActionsRef.current.voice(),
      },
      {
        id: "quiz-manual",
        description: "Take the quiz that was just written on screen",
        phrases: ["manual quiz", "take the manual quiz", "take it on screen"],
        spokenKey: "nav-quiz-manual",
        run: () => voiceActionsRef.current.manual(),
      },
      {
        id: "quiz-submit",
        description: "Submit your answers",
        phrases: ["submit answers", "submit the quiz", "finish the quiz"],
        spokenKey: "nav-quiz-submit",
        run: () => voiceActionsRef.current.submit(),
      },
      {
        id: "quiz-leave",
        description: "Leave the quiz and return to the quiz lobby",
        phrases: ["leave the quiz", "quit the quiz", "take another quiz", "another quiz"],
        spokenKey: "nav-quiz-leave",
        run: () => voiceActionsRef.current.leave(),
      },
    ],
    []
  );
  useVoiceNavCommands("quiz", voiceCommands);

  const selectAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  // Keyboard shortcuts for the card-at-a-time manual quiz: number keys pick an
  // option, the arrow keys move between cards, Enter advances. Ignored while the
  // student is typing into the short-answer field.
  useEffect(() => {
    if (phase !== "taking") return;

    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCurrent((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        setCurrent((index) => Math.min(questions.length - 1, index + 1));
        return;
      }

      const slot = Number(event.key);
      if (!Number.isInteger(slot) || slot < 1 || slot > 9) return;

      const question = questions[current];
      const option = (question?.options ?? [])[slot - 1];
      if (question && option) {
        event.preventDefault();
        selectAnswer(question.id, option);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, questions, current, selectAnswer]);

  // -------------------------------------------------------------------------
  // Choosing how to take it
  // -------------------------------------------------------------------------

  // Every quiz lands here first — a freshly written one and a retake alike. The
  // questions are identical either way; which mode to use is a mood, not a
  // setting, so it is asked every time instead of being remembered.
  if (phase === "choose") {
    return (
      <motion.div
        key="choose"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
        <section className={cn(panel, "p-6")}>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {questions.length} questions ready
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {quizTitle || "Your quiz"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            How do you want to take it? Both modes ask the same questions, and the
            score lands in the same place.
          </p>
          {audioStatus === "quota" && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              Question audio could not be pre-generated because voice credits are
              unavailable. The quiz still works, but some questions may be silent.
            </p>
          )}
          {audioStatus === "unavailable" && (
            <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              Some question audio could not be generated. The quiz will use live
              audio where possible and remains available in manual mode.
            </p>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPhase("taking")}
              className={cn(
                panel,
                "flex items-start gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-950/[0.08] dark:hover:border-brand-500/40"
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <ClipboardList className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Manual quiz
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Read the questions and answer on screen — the way a quiz normally
                  works.
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                // The click is the gesture that lets the browser play audio at all.
                getSpeechEngine().unlock();
                setPhase("voice");
              }}
              className={cn(
                panel,
                "flex items-start gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-950/[0.08] dark:hover:border-brand-500/40"
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                <Mic className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Voice quiz
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Hands free: each question is read aloud, you answer out loud, and it
                  moves on by itself.
                </span>
              </span>
            </button>
          </div>

          <p className="mt-4 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            The questions were recorded when the quiz was written, so a voice quiz —
            and every repeat — plays them from disk without another text-to-speech
            request.
            {withoutClips > 0 &&
              ` ${withoutClips} of them will be spoken live instead.`}
          </p>

          {!micSupported && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              This browser cannot listen for speech, so voice mode will ask you to
              pick your answers instead — the questions are still read aloud.
            </p>
          )}

          {error && (
            <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setPhase("lobby");
              setResult(null);
            }}
            className={cn(quietButton, "mt-5")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to the quiz lobby
          </button>
        </section>
      </motion.div>
    );
  }

  // -------------------------------------------------------------------------
  // Voice quiz
  // -------------------------------------------------------------------------

  if (phase === "voice" && quizId) {
    return (
      <VoiceQuizPlayer
        quizId={quizId}
        quizTitle={quizTitle || "Your quiz"}
        questions={questions}
        answerKey={answerKey}
        onFinish={(list) => void gradeAttempt(list)}
        onLeave={() => setPhase("choose")}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Taking
  // -------------------------------------------------------------------------

  if (phase === "taking") {
    const question = questions[current];
    const questionId = question?.id ?? "";
    const total = questions.length;
    const selected = question ? answers[question.id] ?? "" : "";
    const isFirst = current === 0;
    const isLast = current >= total - 1;
    const blanks = questions.filter(
      (entry) => (answers[entry.id] ?? "").trim().length === 0
    ).length;

    const goToPrevious = () => setCurrent((index) => Math.max(0, index - 1));
    const goToNext = () => setCurrent((index) => Math.min(total - 1, index + 1));
    const goToFirstBlank = () => {
      const index = questions.findIndex(
        (entry) => (answers[entry.id] ?? "").trim().length === 0
      );
      if (index >= 0) setCurrent(index);
    };

    return (
      <div className="space-y-4">
        <div className={cn(panel, "p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setPhase("lobby");
                setCurrent(0);
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Leave quiz
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Question {current + 1} of {total}
              </span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {answeredCount} answered
              </span>
            </div>
          </div>

          {/* One segment per question — answered, current, or still blank.
              Tapping a segment jumps straight to that question. */}
          <div
            className="mt-3 flex items-center gap-1.5"
            role="group"
            aria-label="Question progress"
          >
            {questions.map((entry, index) => {
              const done = (answers[entry.id] ?? "").trim().length > 0;
              const active = index === current;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setCurrent(index)}
                  aria-label={`Go to question ${index + 1}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-200",
                    active
                      ? "bg-brand-500"
                      : done
                        ? "bg-brand-300 dark:bg-brand-500/50"
                        : "bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                  )}
                />
              );
            })}
          </div>
        </div>

        {roomName && (
          <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs text-brand-800 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
            <Trophy className="h-3.5 w-3.5" />
            This score counts toward {roomName}&apos;s leaderboard.
          </p>
        )}

        {/* The card: one question at a time, the way a flashcard shows one front. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={questionId || "no-question"}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            className={cn(panel, "p-6 sm:p-8")}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
                {QUESTION_LABELS[question?.type ?? ""] ?? "Question"}
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {question?.type === "short_answer"
                  ? "Write it in your own words"
                  : "Choose one"}
              </span>
            </div>

            <p className="mt-4 text-lg font-medium leading-8 text-zinc-900 dark:text-zinc-100 sm:text-xl">
              {question?.question}
            </p>

            {question?.type === "short_answer" ? (
              <input
                value={selected}
                onChange={(event) => selectAnswer(questionId, event.target.value)}
                placeholder="Type your answer"
                aria-label="Your answer"
                className={cn(field, "mt-5 text-base")}
              />
            ) : (
              <div className="mt-5 space-y-2.5">
                {(question?.options ?? []).map((option, index) => {
                  const isSelected = selected === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => selectAnswer(questionId, option)}
                      aria-pressed={isSelected}
                      className={cn(
                        "group flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left text-sm transition-all duration-200",
                        isSelected
                          ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200 dark:border-brand-500/60 dark:bg-brand-500/10 dark:ring-brand-500/25"
                          : "border-zinc-200 hover:border-brand-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-colors",
                          isSelected
                            ? "border-brand-400 bg-brand-400 text-brand-950"
                            : "border-zinc-200 text-zinc-500 group-hover:border-brand-300 group-hover:text-brand-700 dark:border-zinc-700 dark:text-zinc-400 dark:group-hover:text-brand-300"
                        )}
                      >
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 leading-6",
                          isSelected
                            ? "font-medium text-brand-900 dark:text-brand-200"
                            : "text-zinc-700 dark:text-zinc-300"
                        )}
                      >
                        {option}
                      </span>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.section>
        </AnimatePresence>

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={goToPrevious}
            disabled={isFirst}
            className={cn(quietButton, isFirst && "cursor-not-allowed opacity-50")}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy === "submit"}
              className={primaryButton}
            >
              {busy === "submit" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Submit answers
            </button>
          ) : (
            <button type="button" onClick={goToNext} className={primaryButton}>
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {isLast && blanks > 0 && (
            <>
              <button
                type="button"
                onClick={goToFirstBlank}
                className="text-xs font-medium text-brand-700 underline-offset-2 transition-colors hover:underline dark:text-brand-400"
              >
                Go to the first blank
              </button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {blanks} still blank — blank answers score zero.
              </span>
            </>
          )}

          {question && question.type !== "short_answer" && (
            <span className="hidden text-xs text-zinc-400 dark:text-zinc-500 sm:inline">
              Number keys pick an answer · ← → move between questions
            </span>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  if (phase === "results" && result) {
    const percent = result.total > 0 ? (result.score / result.total) * 100 : 0;
    const correctCount = result.results.filter((entry) => entry.isCorrect).length;
    const wrongCount = Math.max(0, result.total - correctCount);

    return (
      <div className="space-y-4">
        <section className={cn(panel, "p-6 text-center")}>
          {/* The score as a ring, so the result reads at a glance. */}
          <div className="relative mx-auto h-36 w-36">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="52"
                pathLength={100}
                strokeDasharray="100"
                className="fill-none stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth="10"
              />
              <motion.circle
                cx="60"
                cy="60"
                r="52"
                pathLength={100}
                strokeDasharray="100"
                initial={{ strokeDashoffset: 100 }}
                animate={{ strokeDashoffset: 100 - percent }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="fill-none stroke-brand-500"
                strokeWidth="10"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {Math.round(percent)}%
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {result.score} of {result.total}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
              {correctCount} correct
            </span>
            {wrongCount > 0 && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
                {wrongCount} to review
              </span>
            )}
          </div>

          {result.roomId && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2 text-xs text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
              <Trophy className="h-3.5 w-3.5" />
              Added to the room leaderboard
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {result.roomId ? (
              <Link href="/dashboard/rooms" className={primaryButton}>
                <Users className="h-4 w-4" />
                Back to the room
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setPhase("lobby");
                setResult(null);
              }}
              className={result.roomId ? quietButton : primaryButton}
            >
              <RotateCcw className="h-4 w-4" />
              Take another quiz
            </button>
          </div>
        </section>

        {result.results.map((entry, index) => (
          <section key={entry.questionId} className={cn(panel, "p-5")}>
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  entry.isCorrect
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                )}
              >
                {entry.isCorrect ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Question {index + 1} ·{" "}
                  {QUESTION_LABELS[entry.type] ?? entry.type}
                </p>
                <p className="mt-1.5 text-sm font-medium leading-6 text-zinc-900 dark:text-zinc-100">
                  {entry.question}
                </p>

                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Your answer:{" "}
                  <span
                    className={cn(
                      "font-medium",
                      entry.isCorrect
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {entry.userAnswer.trim().length > 0 ? (
                      entry.userAnswer
                    ) : (
                      <em>blank</em>
                    )}
                  </span>
                </p>
                {!entry.isCorrect && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Correct answer:{" "}
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">
                      {entry.correctAnswer}
                    </span>
                  </p>
                )}
                {entry.explanation && (
                  <p className="mt-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
                    {entry.explanation}
                  </p>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key="lobby"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Quiz yourself
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Name a topic — or attach a PDF or text file — and EduVoice writes a
            quiz on the spot, then grades your answers with an explanation for
            each one. With a file attached, every question comes from that
            document.
          </p>
        </div>

        {roomId && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
            <p className="flex items-center gap-2 text-sm text-brand-900 dark:text-brand-200">
              <Users className="h-4 w-4" />
              {roomName
                ? `Quizzing in ${roomName} — scores land on its shared leaderboard.`
                : "Quizzing in a study room — scores land on its shared leaderboard."}
            </p>
            <Link
              href="/dashboard/rooms"
              className="text-xs font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
            >
              Back to rooms
            </Link>
          </div>
        )}

        <form onSubmit={handleGenerate} className={cn(panel, "space-y-4 p-5")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Sparkles className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            Generate a quiz
          </h2>

          <input
            ref={fileInputRef}
            type="file"
            accept={QUIZ_FILE_ACCEPT}
            onChange={handleFile}
            className="hidden"
          />

          {file ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50/70 px-3.5 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/10">
              <FileText className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300" />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label="Remove the attached file"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3.5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
            >
              <Paperclip className="h-4 w-4" />
              Attach a file to quiz from (PDF, TXT, MD, CSV)
            </button>
          )}

          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={
              file
                ? "Optional focus — e.g. Chapter 3"
                : roomName
                  ? `e.g. ${roomName} — key concepts`
                  : "e.g. Cell division"
            }
            className={field}
            maxLength={200}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Questions
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {[3, 5, 8, 10, 15].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={
                busy === "generate" || (!file && topic.trim().length < 3)
              }
              className={primaryButton}
            >
              {busy === "generate" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ClipboardList className="h-4 w-4" />
              )}
              {busy === "generate" ? "Writing questions…" : "Start quiz"}
            </button>
          </div>
        </form>

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}

        {recentQuizzes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Retake a quiz
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {recentQuizzes.map((quiz) => (
                <button
                  key={quiz.id}
                  type="button"
                  onClick={() => handleRetake(quiz.id)}
                  disabled={busy !== null}
                  className={cn(
                    panel,
                    "p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-950/[0.08] disabled:opacity-60 dark:hover:border-brand-500/40"
                  )}
                >
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {quiz.title}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {quiz.questionCount} questions
                    {quiz.attempts > 0
                      ? ` · ${quiz.attempts} taken · best ${quiz.bestScore}/${quiz.questionCount}`
                      : " · not taken yet"}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {recentAttempts.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Recent results
            </h2>
            <ul className="space-y-2">
              {recentAttempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className={cn(panel, "flex items-center gap-3 px-4 py-3")}
                >
                  {attempt.totalQuestions > 0 &&
                  attempt.score / attempt.totalQuestions >= 0.5 ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <CircleSlash className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {attempt.title}
                  </span>
                  {attempt.roomId && (
                    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                      room
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {attempt.score}/{attempt.totalQuestions}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
