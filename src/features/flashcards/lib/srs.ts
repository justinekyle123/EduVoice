// Spaced repetition for Smart Flashcards (feature 6.12).
//
// SM-2 in the shape the schema can store: a card carries an ease factor, an
// interval in days, and a repetition count, and each rating turns those into the
// next due date. `again` is the failing grade — the card resets and comes back
// inside the same sitting — while the other three extend the interval, `easy`
// further than `good`, `hard` less.
//
// The whole thing is a pure function of (state, rating, now), so the same answer
// always produces the same next review and the behaviour can be reasoned about
// without a database.

import type { reviewRating } from "@/lib/db/schema";

/** The four buttons a student can press after seeing a card's answer. */
export type ReviewRating = (typeof reviewRating.enumValues)[number];

export type ReviewState = {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
};

/** A card that has never been reviewed: due immediately, default ease. */
export const INITIAL_REVIEW_STATE: ReviewState = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
};

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
/** A year is long enough that anything beyond it is effectively "learned". */
const MAX_INTERVAL_DAYS = 365;
/** How soon a failed card returns — within the same review session. */
const RELEARN_MINUTES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampInterval(days: number): number {
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

export type ScheduledReview = ReviewState & {
  /** When the card should next be shown. */
  dueAt: Date;
};

/**
 * Where a card goes after a rating. Deterministic: the same state, rating, and
 * `now` always produce the same next review.
 */
export function scheduleReview(
  state: ReviewState,
  rating: ReviewRating,
  now: Date = new Date()
): ScheduledReview {
  const ease = clamp(
    Number.isFinite(state.easeFactor) ? state.easeFactor : INITIAL_REVIEW_STATE.easeFactor,
    MIN_EASE,
    MAX_EASE
  );
  const interval = Math.max(0, Math.round(state.intervalDays));
  const repetitions = Math.max(0, Math.round(state.repetitions));

  let nextEase = ease;
  let nextInterval = interval;
  let nextRepetitions = repetitions;
  let dueAt: Date;

  switch (rating) {
    case "again":
      // Forgot it: drop back to the start and see it again shortly.
      nextEase = clamp(ease - 0.2, MIN_EASE, MAX_EASE);
      nextInterval = 0;
      nextRepetitions = 0;
      dueAt = new Date(now.getTime() + RELEARN_MINUTES * 60_000);
      break;

    case "hard":
      // Remembered, but barely — a small step and a slightly lower ease.
      nextEase = clamp(ease - 0.15, MIN_EASE, MAX_EASE);
      nextInterval = clampInterval(interval * 1.2 || 1);
      nextRepetitions = repetitions + 1;
      dueAt = new Date(now.getTime() + nextInterval * DAY_MS);
      break;

    case "easy":
      // Remembered well — the longest jump, and the card gets easier.
      nextEase = clamp(ease + 0.15, MIN_EASE, MAX_EASE);
      nextInterval = clampInterval(Math.max(4, (interval || 1) * ease * 1.3));
      nextRepetitions = repetitions + 1;
      dueAt = new Date(now.getTime() + nextInterval * DAY_MS);
      break;

    case "good":
    default:
      // The classic SM-2 steps: 1 day, then 6, then the running interval
      // multiplied by the ease factor.
      nextInterval = clampInterval(
        repetitions === 0 ? 1 : repetitions === 1 ? 6 : (interval || 1) * ease
      );
      nextRepetitions = repetitions + 1;
      dueAt = new Date(now.getTime() + nextInterval * DAY_MS);
      break;
  }

  return {
    easeFactor: round2(nextEase),
    intervalDays: nextInterval,
    repetitions: nextRepetitions,
    dueAt,
  };
}

/** True when a card with this review state should be shown now. */
export function isDue(dueAt: Date | null, now: Date = new Date()): boolean {
  return dueAt === null || dueAt.getTime() <= now.getTime();
}

/** Human label for a due date, e.g. "now", "in 5 minutes", "in 6 days". */
export function describeDue(dueAt: Date | null, now: Date = new Date()): string {
  if (!dueAt) return "now";
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs <= 60_000) return "now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  return `in ${months} month${months === 1 ? "" : "s"}`;
}
