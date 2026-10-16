"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  CircleSlash,
  ClipboardList,
  FileText,
  Loader2,
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
import {
  generateQuiz,
  generateQuizFromFile,
  getRecentAttempts,
  getRecentQuizzes,
  startQuizAttempt,
  submitQuizAttempt,
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
}: {
  roomId?: string | null;
  /** A finished quiz to reopen on arrival (from the history & scores page). */
  retakeQuizId?: string | null;
}) {
  const [phase, setPhase] = useState<"lobby" | "taking" | "results">("lobby");
  const [roomName, setRoomName] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  // When set, the quiz is written from this uploaded file instead of a topic.
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [questions, setQuestions] = useState<SafeQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
    (next: { questions: SafeQuestion[]; attemptId: string }) => {
      setQuestions(next.questions);
      setAttemptId(next.attemptId);
      setAnswers({});
      setResult(null);
      setError(null);
      setPhase("taking");
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
        if (!cancelled) beginAttempt(opened);
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

  async function handleRetake(quizId: string) {
    if (busy) return;
    setBusy("start");
    setError(null);
    try {
      const opened = await startQuizAttempt({ quizId, roomId });
      beginAttempt(opened);
    } catch (err) {
      setError(errorMessage(err, "Could not open that quiz"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit() {
    if (!attemptId || busy) return;

    setBusy("submit");
    setError(null);
    try {
      const graded = await submitQuizAttempt({
        attemptId,
        answers: questions.map((question) => ({
          questionId: question.id,
          userAnswer: answers[question.id] ?? "",
        })),
      });
      setResult(graded);
      setPhase("results");
      await refreshHistory();
    } catch (err) {
      setError(errorMessage(err, "Could not submit your answers"));
    } finally {
      setBusy(null);
    }
  }

  const answeredCount = questions.filter((question) =>
    (answers[question.id] ?? "").trim().length > 0
  ).length;

  // Voice Navigation Mode (feature 6.14): the quiz exposes its own commands so a
  // student can drive it by voice — "start the quiz", "submit answers", "take
  // another quiz". The handlers are read through a ref that is refreshed every
  // render, so the registered commands never capture a stale `topic`/`busy`.
  const voiceActionsRef = useRef({
    start: () => {},
    submit: () => {},
    leave: () => {},
  });
  useEffect(() => {
    voiceActionsRef.current = {
      start: () => void startQuiz(),
      submit: () => void handleSubmit(),
      leave: () => {
        setPhase("lobby");
        setResult(null);
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

  // -------------------------------------------------------------------------
  // Taking
  // -------------------------------------------------------------------------

  if (phase === "taking") {
    return (
      <div className="space-y-4">
        <div className={cn(panel, "flex flex-wrap items-center justify-between gap-3 p-4")}>
          <button
            type="button"
            onClick={() => setPhase("lobby")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave quiz
          </button>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {answeredCount} of {questions.length} answered
          </span>
        </div>

        {roomName && (
          <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs text-brand-800 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
            <Trophy className="h-3.5 w-3.5" />
            This score counts toward {roomName}&apos;s leaderboard.
          </p>
        )}

        {questions.map((question, index) => (
          <section key={question.id} className={cn(panel, "p-5")}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {index + 1}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {QUESTION_LABELS[question.type] ?? question.type}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium leading-6 text-zinc-900 dark:text-zinc-100">
              {question.question}
            </p>

            {question.type === "short_answer" ? (
              <input
                value={answers[question.id] ?? ""}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [question.id]: event.target.value,
                  }))
                }
                placeholder="Type your answer"
                className={cn(field, "mt-3")}
              />
            ) : (
              <div className="mt-3 space-y-2">
                {(question.options ?? []).map((option) => {
                  const selected = answers[question.id] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setAnswers((prev) => ({ ...prev, [question.id]: option }))
                      }
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                        selected
                          ? "border-brand-400 bg-brand-50 text-brand-900 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-200"
                          : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                          selected
                            ? "border-brand-500 bg-brand-500 text-brand-950"
                            : "border-zinc-300 dark:border-zinc-600"
                        )}
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ))}

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
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
          {answeredCount < questions.length && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {questions.length - answeredCount} still blank — blank answers score
              zero.
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

    return (
      <div className="space-y-4">
        <section className={cn(panel, "p-6 text-center")}>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            You scored
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {result.score}
            <span className="text-2xl text-zinc-400 dark:text-zinc-500">
              /{result.total}
            </span>
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {Math.round(percent)}% correct
          </p>

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
