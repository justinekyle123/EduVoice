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

/**
 * How long the narrator is expected to take with a question, so the shared
 * clock can wait for it.
 *
 * The question is read aloud before anyone can answer it, and a countdown that
 * runs while it is being read eats the very time it is counting. The lead is
 * estimated from the words themselves — the same text that is rendered into a
 * clip before the round starts — so every screen agrees on when the clock
 * begins, and a slow client cannot steal another student's answering time.
 *
 * This is the fallback for a question with no clip the server can measure (or a
 * live-synthesized one). The cap is deliberately generous: a long question can
 * take well over 15 seconds to read, and a short cap is what let the countdown
 * begin while the tutor was still talking.
 */
export function narrationLeadMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(Math.max(words * 420 + 800, 1_500), 60_000);
}

/**
 * Length of a PCM WAV clip in milliseconds, or null when the bytes are not a
 * PCM WAV this app wrote.
 *
 * Room quiz narration is rendered by `synthesizeSpeechBytes` (`pcmToWav`): a
 * 44-byte RIFF header followed by 16-bit PCM. The shared question clock has to
 * start *after* that clip has finished, so the server takes the exact duration
 * from the header instead of estimating it from the words. Host-uploaded clips
 * can be MP3, OGG, M4A or WebM, so anything that is not a WAV falls back to
 * `narrationLeadMs`.
 */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const ascii = (offset: number) =>
    String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
  if (ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  // Walk the chunks rather than assuming the canonical 44-byte layout: a
  // `LIST`/`fact` chunk ahead of `data` is legal and would shift everything.
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      const format = view.getUint16(offset + 8, true);
      // 1 = PCM; 0xfffe = WAVE_FORMAT_EXTENSIBLE, PCM underneath.
      if (format !== 1 && format !== 0xfffe) return null;
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === "data") {
      dataSize = Math.min(size, bytes.length - offset - 8);
    }
    // Chunks are word-aligned; an odd-sized chunk carries one pad byte.
    offset += 8 + size + (size % 2);
  }

  if (byteRate <= 0 || dataSize <= 0) return null;
  return Math.round((dataSize / byteRate) * 1000);
}

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

/**
 * Milliseconds left on the current question (0 once it is closed).
 *
 * A question opened with a narration lead (see `narrationLeadMs`) starts with
 * the full duration and only counts down once the reading is over, so the bar
 * visibly waits for the audio instead of spending the clock while it plays.
 */
export function remainingMs(clock: LiveClock, now: Date): number {
  if (clock.status !== "question") return 0;
  const full = clock.questionSeconds * 1000;
  const left = full - (now.getTime() - clock.questionStartedAt.getTime());
  return Math.min(Math.max(0, left), full);
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
