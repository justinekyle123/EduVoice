"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock,
  ListChecks,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DailyActivityChart, ScoreTrendChart, TopicBars } from "./charts";
import {
  formatMinutes,
  formatPct,
  type NextStep,
  type QuestionTypeStat,
} from "../lib/trends";
import { getProgressOverview, type ProgressOverview } from "../server/actions";

// Progress Visualization and Summary Trends (feature 6.10).
//
// The page answers one question — "what do I know, and what should I review?" —
// so it is ordered by usefulness rather than by data type: the headline numbers,
// then the one recommended next activity, then the evidence behind both. Scores,
// accuracy, study time and per-topic mastery all come from
// getProgressOverview; nothing is computed here.

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

type Loadable = ProgressOverview | null;

export function ProgressUI() {
  const [data, setData] = useState<Loadable>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getProgressOverview({
      // Bucket the week and the streak by the student's own day, not the
      // server's — the same convention task capture uses.
      tzOffsetMinutes: new Date().getTimezoneOffset(),
    })
      .then((overview) => {
        if (cancelled) return;
        setData(overview);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load your progress");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The skeleton is turned back on from the click rather than from inside the
  // effect: setting state synchronously in an effect body cascades renders.
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Your progress
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Scores, accuracy, and study time from every quiz you finish — so you can
            see which topics are holding and which ones need another pass.
          </p>
        </div>

        {data && summary && summary.quizzesTaken > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip icon={<Target className="h-3 w-3" />}>
              {summary.activeDays} active {summary.activeDays === 1 ? "day" : "days"}
            </Chip>
            {summary.streakDays > 1 && (
              <Chip icon={<Sparkles className="h-3 w-3" />} accent>
                {summary.streakDays}-day streak
              </Chip>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <ProgressSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !data || !summary || summary.quizzesTaken === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={<ClipboardList className="h-4 w-4" />}
              label="Quizzes taken"
              value={String(summary.quizzesTaken)}
              hint={`${summary.questionsAnswered} questions answered`}
            />
            <StatCard
              icon={<Trophy className="h-4 w-4" />}
              label="Average score"
              value={formatPct(summary.averageScorePct)}
              hint={
                data.change ? (
                  <ChangeHint change={data.change} />
                ) : (
                  `Best ${formatPct(summary.bestScorePct)}`
                )
              }
            />
            <StatCard
              icon={<Target className="h-4 w-4" />}
              label="Accuracy"
              value={formatPct(summary.accuracyPct)}
              hint={`${summary.questionsCorrect} of ${summary.questionsAnswered} right`}
            />
            <StatCard
              icon={<Clock className="h-4 w-4" />}
              label="Practice time"
              value={formatMinutes(summary.practiceMinutes)}
              hint="Time spent in quizzes"
            />
          </div>

          <NextStepCard step={data.nextStep} />

          {/* Trend */}
          <ScoreTrendChart points={data.trend} />

          {/* Topics: what needs review, and what is holding */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TopicBars
              topics={data.weak.slice(0, 5)}
              title="Needs review"
              hint="Below 80% on at least two questions"
              emptyLabel={
                data.topics.length === 0
                  ? "Answer a few quiz questions to see this"
                  : "Nothing is below 80% — keep it up"
              }
            />
            <TopicBars
              topics={data.strong.slice(0, 5)}
              title="Looking solid"
              hint="80% or better"
              emptyLabel="No topic is above 80% yet"
            />
          </div>

          {/* Time and question shapes */}
          <div className="grid gap-4 lg:grid-cols-2">
            <DailyActivityChart days={data.daily} />
            <QuestionTypeCard types={data.questionTypes} />
          </div>

          {/* Evidence */}
          <RecentAttempts attempts={data.recent} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Chip({
  children,
  icon,
  accent,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
        accent
          ? "bg-brand-50 text-brand-800 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30"
          : "bg-zinc-100 text-zinc-600 ring-zinc-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: React.ReactNode;
}) {
  return (
    <div className={panel}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:text-brand-300 dark:ring-brand-500/30">
        {icon}
      </span>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
      <p className="mt-0.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
      <p className="mt-0.5 text-xs leading-5 text-zinc-400 dark:text-zinc-500">{hint}</p>
    </div>
  );
}

/** "▲ 8% vs your last 3 quizzes…" — the change over time the spec asks for. */
function ChangeHint({ change }: { change: NonNullable<ProgressOverview["change"]> }) {
  const tone =
    change.direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : change.direction === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-500 dark:text-zinc-400";

  return (
    <span className={tone}>
      {change.direction === "flat"
        ? "Level"
        : `${change.deltaPct > 0 ? "▲" : "▼"} ${Math.abs(change.deltaPct)}%`}{" "}
      <span className="text-zinc-400 dark:text-zinc-500">vs {change.label}</span>
    </span>
  );
}

/** The one recommended activity, given its own band because it is the point of the page. */
function NextStepCard({ step }: { step: NextStep }) {
  const label =
    step.kind === "weak-topic" ? "Practise this topic" : step.kind === "stretch" ? "Try a new topic" : "Take a quiz";

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm dark:border-brand-500/25 dark:from-brand-500/10 dark:to-zinc-900"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-md shadow-brand-500/25">
          <TrendingUp className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            What to study next
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            {step.message}
          </p>
        </div>
      </div>

      <Link
        href={step.href}
        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg"
      >
        {label}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </motion.section>
  );
}

/** Accuracy by question shape — a score of 70% hides whether it was the essays. */
function QuestionTypeCard({ types }: { types: QuestionTypeStat[] }) {
  const answered = types.filter((type) => type.answers > 0);

  return (
    <section className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            By question type
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Where your answers land
          </p>
        </div>
        <ListChecks className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
      </div>

      {answered.length === 0 ? (
        <div className="mt-4 flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-200 px-4 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          Answer a few quiz questions to see this
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {answered.map((type) => {
            const pct = type.accuracyPct ?? 0;
            return (
              <li key={type.type}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    {type.label}
                  </span>
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                      {formatPct(type.accuracyPct)}
                    </span>
                    <span className="ml-1.5">
                      {type.correct}/{type.answers}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RecentAttempts({ attempts }: { attempts: ProgressOverview["recent"] }) {
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recent quizzes
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Your last {attempts.length} finished {attempts.length === 1 ? "quiz" : "quizzes"}
          </p>
        </div>
        <Link
          href="/dashboard/quiz"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
        >
          Take another quiz
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="flex items-center gap-3 py-2.5">
            <span
              className={cn(
                "flex h-9 w-12 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                attempt.pct >= 80
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                  : attempt.pct >= 50
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"
                    : "bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30"
              )}
            >
              {attempt.pct}%
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">{attempt.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <CalendarDays className="h-3 w-3" />
                {new Date(attempt.completedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                <span>
                  · {attempt.score}/{attempt.total} right
                </span>
                {attempt.inRoom && <span>· study room</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A learner with nothing recorded yet. The spec is explicit that this must be
 * useful rather than a wall of zeroed charts, so it says what will appear and
 * where to start.
 */
function EmptyState() {
  return (
    <div className={cn(panel, "px-6 py-12 text-center")}>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
        <TrendingUp className="h-5 w-5 text-brand-600 dark:text-brand-400" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        Your progress starts with one quiz
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        Finish a quiz and this page fills in with your scores, the topics you are
        strongest at, the ones worth another pass, and how long you have studied
        this week.
      </p>

      <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-xs text-zinc-500 dark:text-zinc-400">
        {[
          "Average score and accuracy",
          "Score trend across your quizzes",
          "Weak topics, with a quiz to practise them",
          "Practice time, day by day",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
            {line}
          </li>
        ))}
      </ul>

      <Link
        href="/dashboard/quiz"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg"
      >
        <ClipboardList className="h-4 w-4" />
        Take your first quiz
      </Link>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cn(panel, "flex items-start gap-3")}>
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Could not load your progress
        </p>
        <p className="mt-1 break-words text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-3.5 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your progress…</span>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className={panel}>
            <div className="h-8 w-8 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-zinc-200/50 dark:bg-zinc-800/70" />
          </div>
        ))}
      </div>

      <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60" />
      <div className="h-64 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60" />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60" />
        <div className="h-56 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/60" />
      </div>
    </div>
  );
}
