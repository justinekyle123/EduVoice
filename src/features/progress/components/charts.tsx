"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { DayStat, TopicStat, TrendPoint } from "../lib/trends";

// Charts for the progress page (feature 6.10).
//
// Hand-drawn rather than pulled from a charting package: the app ships no chart
// dependency, and the whole dashboard is already built from Tailwind panels. Two
// rules keep them accessible as well as readable:
//
//   * numbers are always visible as text, never only as a bar height, so the
//     charts survive a screen reader, a printed page, and colour blindness;
//   * each chart carries a one-line `aria-label` summary of what it shows.
//
// Labels are HTML rather than SVG text: text inside a scaled <svg> stretches with
// it, while HTML keeps its own size at every width.

const CARD =
  "rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

/** Colour a percentage: weak, middling, or solid. */
function toneFor(pct: number) {
  if (pct >= 80) return { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (pct >= 50) return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" };
}

// ---------------------------------------------------------------------------
// Score trend
// ---------------------------------------------------------------------------

/**
 * The score of each recent attempt, oldest to newest, as an area line.
 *
 * Drawn in a 600×180 viewBox that scales with its container. The x axis is the
 * attempt order rather than elapsed time on purpose: a learner's last ten quizzes
 * read as a progression, while a gap of three weeks would otherwise flatten the
 * line into one corner.
 */
export function ScoreTrendChart({ points }: { points: TrendPoint[] }) {
  const gridLines = [0, 25, 50, 75, 100];

  if (points.length === 0) {
    return (
      <div className={CARD}>
        <ChartHeading title="Score trend" hint="Your last quizzes, oldest to newest" />
        <ChartEmpty label="No completed quizzes yet" />
      </div>
    );
  }

  const width = 600;
  const height = 180;
  const padX = 12;
  const padY = 14;

  const xFor = (index: number) =>
    points.length === 1
      ? width / 2
      : padX + (index * (width - padX * 2)) / (points.length - 1);
  const yFor = (pct: number) => height - padY - (pct / 100) * (height - padY * 2);

  const coords = points.map((point, index) => ({
    point,
    x: xFor(index),
    y: yFor(point.pct),
  }));

  const line = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M ${padX},${height - padY} L ${coords
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" L ")} L ${(width - padX).toFixed(1)},${height - padY} Z`;

  const first = points[0].pct;
  const last = points[points.length - 1].pct;

  return (
    <div className={CARD}>
      <ChartHeading
        title="Score trend"
        hint={`Your last ${points.length} ${points.length === 1 ? "quiz" : "quizzes"}, oldest to newest`}
        aside={
          points.length > 1 && (
            <span
              className={cn(
                "text-xs font-medium",
                last >= first ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              )}
            >
              {last === first ? "Level" : last > first ? `+${last - first}%` : `${last - first}%`}
            </span>
          )
        }
      />

      <div className="mt-4 flex gap-3">
        {/* Y axis as HTML, so the numbers never stretch with the chart. */}
        <div className="flex h-[180px] flex-col justify-between py-[14px] text-right text-[10px] leading-none text-zinc-400 dark:text-zinc-500">
          {[...gridLines].reverse().map((value) => (
            <span key={value}>{value}%</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full overflow-visible"
            role="img"
            aria-label={`Quiz scores over time: ${points
              .map((point) => `${point.label} ${point.pct}%`)
              .join(", ")}.`}
          >
            <defs>
              <linearGradient id="progress-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {gridLines.map((value) => (
              <line
                key={value}
                x1={0}
                x2={width}
                y1={yFor(value)}
                y2={yFor(value)}
                className="stroke-zinc-200/80 dark:stroke-zinc-800"
                strokeWidth={1}
                strokeDasharray={value === 0 ? undefined : "3 5"}
              />
            ))}

            {coords.length > 1 && (
              <>
                <motion.path
                  d={area}
                  fill="url(#progress-trend-fill)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.15 }}
                />
                <motion.polyline
                  points={line}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              </>
            )}

            {coords.map(({ point, x, y }) => (
              <g key={point.attemptId}>
                <circle
                  cx={x}
                  cy={y}
                  r={4.5}
                  fill="#ffffff"
                  className="stroke-brand-500 dark:fill-zinc-900"
                  strokeWidth={2.5}
                />
                <title>{`${point.title} — ${point.score}/${point.total} (${point.pct}%) · ${point.label}`}</title>
              </g>
            ))}
          </svg>

          <div className="mt-1.5 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
            {points.map((point) => (
              <span key={point.attemptId} className="truncate px-0.5">
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/**
 * One bar per topic, strongest first — the shape of the list is what a student
 * reads: long green bars at the top, short red ones at the bottom.
 */
export function TopicBars({
  topics,
  title,
  hint,
  emptyLabel,
}: {
  topics: TopicStat[];
  title: string;
  hint?: string;
  emptyLabel: string;
}) {
  return (
    <div className={CARD}>
      <ChartHeading title={title} hint={hint} />

      {topics.length === 0 ? (
        <ChartEmpty label={emptyLabel} />
      ) : (
        <ul className="mt-4 space-y-3">
          {topics.map((topic, index) => {
            const pct = topic.accuracyPct ?? 0;
            const tone = toneFor(pct);
            return (
              <li key={topic.topic}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">
                    {topic.topic}
                  </span>
                  <span className={cn("shrink-0 font-semibold", tone.text)}>
                    {topic.accuracyPct === null ? "—" : `${topic.accuracyPct}%`}
                    <span className="ml-1.5 font-normal text-zinc-400 dark:text-zinc-500">
                      {topic.correct}/{topic.answers}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <motion.div
                    className={cn("h-full rounded-full", tone.bar)}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: 0.05 * index, ease: "easeOut" }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily activity
// ---------------------------------------------------------------------------

/** Practice time per day for the last week, with the attempt count under each. */
export function DailyActivityChart({ days }: { days: DayStat[] }) {
  const peak = Math.max(...days.map((day) => day.minutes), 0);
  const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className={CARD}>
      <ChartHeading
        title="This week"
        hint="Time in quizzes, day by day"
        aside={
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {totalMinutes} min
          </span>
        }
      />

      <div
        className="mt-4 flex h-32 items-end gap-2"
        role="img"
        aria-label={`Practice time this week: ${days
          .map((day) => `${day.label} ${day.minutes} minutes`)
          .join(", ")}.`}
      >
        {days.map((day) => {
          // A day with a finished quiz but no recorded minutes (a retake that was
          // answered instantly) still deserves a visible stub.
          const heightPct = peak > 0 ? Math.round((day.minutes / peak) * 100) : 0;
          const hasActivity = day.attempts > 0;
          return (
            <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
              <motion.div
                className={cn(
                  "w-full rounded-t-lg",
                  hasActivity
                    ? "bg-gradient-to-t from-brand-500 to-brand-400"
                    : "bg-zinc-100 dark:bg-zinc-800"
                )}
                initial={{ height: 0 }}
                animate={{ height: hasActivity ? `${Math.max(heightPct, 6)}%` : "4px" }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                title={`${day.title}: ${day.minutes} min, ${day.attempts} quiz ${day.attempts === 1 ? "try" : "tries"}`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-2">
        {days.map((day) => (
          <div key={day.day} className="min-w-0 flex-1 text-center">
            <p
              className={cn(
                "text-[10px] font-medium",
                day.isToday ? "text-brand-700 dark:text-brand-400" : "text-zinc-400 dark:text-zinc-500"
              )}
            >
              {day.label}
            </p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {day.minutes > 0 ? `${day.minutes}m` : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function ChartHeading({
  title,
  hint,
  aside,
}: {
  title: string;
  hint?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </div>
      {aside}
    </div>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="mt-4 flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-200 px-4 text-center text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
      {label}
    </div>
  );
}
