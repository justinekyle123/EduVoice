// Live room quiz (feature 6.13) — the shared clock and scoring, as pure code.
//
// Everyone in a room sees the same question at the same instant. Rather than
// push events between browsers, the session row holds the timing
// (`question_started_at` + `question_seconds`) and every client derives the same
// phase from it — so the countdown matches to the second and a client that
// refreshes lands back in step. Keeping the arithmetic here (no DB, no React)
// means it can be exercised directly.

// `lobby` is the waiting room: the quiz exists but hasn't opened, and every
// member readies up before the host starts it.
export type LiveStatus = "lobby" | "question" | "reveal" | "ended";

/** Seconds a question stays open by default before it closes itself. */
export const DEFAULT_QUESTION_SECONDS = 30;
export const MIN_QUESTION_SECONDS = 10;
export const MAX_QUESTION_SECONDS = 120;

/** How long the answer + explanation stay up before the next question. */
export const REVEAL_SECONDS = 8;

/** The timing fields of a session row that decide which phase is showing. */
export type LiveClock = {
  status: LiveStatus;
  currentIndex: number;
  questionCount: number;
  questionSeconds: number;
  questionStartedAt: Date;
  revealedAt: Date | null;
};

/** What the session should do next, given the wall clock. */
export type LiveTransition =
  | { kind: "none" }
  | { kind: "reveal" }
  | { kind: "next"; index: number }
  | { kind: "end" };

/** Keep a requested time limit inside the range the UI allows. */
export function clampQuestionSeconds(
  value: number | undefined,
  fallback = DEFAULT_QUESTION_SECONDS
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(
    Math.max(Math.round(value), MIN_QUESTION_SECONDS),
    MAX_QUESTION_SECONDS
  );
}

/**
 * The single step the session is due for right now.
 *
 * A question closes itself once its limit elapses; the reveal is held for
 * `REVEAL_SECONDS`; then the next question opens, or the quiz ends after the
 * last one. Callers apply transitions in a loop, so a session that nobody
 * polled for a minute still catches up rather than stalling.
 */
export function nextTransition(clock: LiveClock, now: Date): LiveTransition {
  // The lobby has no clock of its own — it advances only when the host starts
  // the quiz (see `startRoomLiveSession`).
  if (clock.status === "ended" || clock.status === "lobby") {
    return { kind: "none" };
  }

  if (clock.status === "question") {
    const elapsed = now.getTime() - clock.questionStartedAt.getTime();
    return elapsed >= clock.questionSeconds * 1000
      ? { kind: "reveal" }
      : { kind: "none" };
  }

  // reveal
  const since = now.getTime() - (clock.revealedAt ?? clock.questionStartedAt).getTime();
  if (since < REVEAL_SECONDS * 1000) return { kind: "none" };
  const next = clock.currentIndex + 1;
  return next >= clock.questionCount ? { kind: "end" } : { kind: "next", index: next };
}

/** Milliseconds left on the current question (0 once it is closed). */
export function remainingMs(clock: LiveClock, now: Date): number {
  if (clock.status !== "question") return 0;
  const left = clock.questionSeconds * 1000 - (now.getTime() - clock.questionStartedAt.getTime());
  return Math.max(0, left);
}

/** Where the quiz stands overall, for the header. */
export function liveProgress(clock: {
  currentIndex: number;
  questionCount: number;
}): { position: number; total: number } {
  return {
    position: Math.min(clock.currentIndex + 1, Math.max(clock.questionCount, 1)),
    total: Math.max(clock.questionCount, 1),
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type LiveScoreInput = {
  userId: string;
  correct: number;
  answered: number;
  /** Sum of this player's response times, for the speed tie-break. */
  totalMs: number;
};

export type LiveScoreRow = LiveScoreInput & {
  rank: number;
  /** Mean time per answer in milliseconds, or null when nothing was answered. */
  avgMs: number | null;
};

/**
 * Rank a room's players: most correct first, then fastest overall, then the one
 * who answered more of the quiz. Speed only breaks ties, so a careful student is
 * never punished for being slow. Generic so the caller's extra columns (name,
 * email) ride along into the ranked rows.
 */
export function rankLiveScores<T extends LiveScoreInput>(
  rows: readonly T[]
): (T & { rank: number; avgMs: number | null })[] {
  return [...rows]
    .map((row) => ({
      ...row,
      avgMs: row.answered > 0 ? Math.round(row.totalMs / row.answered) : null,
    }))
    .sort(
      (a, b) =>
        b.correct - a.correct ||
        a.totalMs - b.totalMs ||
        b.answered - a.answered
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

// ---------------------------------------------------------------------------
// Standings (the leaderboard across many rounds)
// ---------------------------------------------------------------------------

export type LiveStandingInput = {
  userId: string;
  correct: number;
  answered: number;
  /** Sum of this player's response times across every round. */
  totalMs: number;
};

/**
 * Rank a room's all-time live-quiz players. Where `rankLiveScores` orders one
 * round by raw correct answers, the standing spans rounds of different lengths
 * (3 or 15 questions, one round or ten), so accuracy leads — one sharp round
 * should outrank many sloppy ones, matching the room leaderboard's philosophy.
 * Correct answers, then speed, then participation break the ties. Generic, like
 * `rankLiveScores`, so extra caller columns (name, email, rounds) ride along.
 */
export function rankLiveStandings<T extends LiveStandingInput>(
  rows: readonly T[]
): (T & { accuracy: number; avgMs: number | null; rank: number })[] {
  return [...rows]
    .map((row) => ({
      ...row,
      accuracy: row.answered > 0 ? row.correct / row.answered : 0,
      avgMs: row.answered > 0 ? Math.round(row.totalMs / row.answered) : null,
    }))
    .sort(
      (a, b) =>
        b.accuracy - a.accuracy ||
        b.correct - a.correct ||
        a.totalMs - b.totalMs ||
        b.answered - a.answered
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
