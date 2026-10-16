// Aggregation for Progress Visualization and Summary Trends (feature 6.10).
//
// Everything the page shows — scores, accuracy, study time, per-topic mastery,
// day-by-day activity — is derived here from two flat lists the server hands
// over: completed quiz attempts and the per-question answers to them. Keeping it
// as pure functions (no database, no clock of its own) means the numbers on the
// charts can be checked in isolation, and the same rules apply to every panel on
// the page.
//
// Two rules come straight from the feature spec:
//   * only completed attempts count — an abandoned quiz is not performance;
//   * a learner with no completed work gets a useful empty state, so every
//     summary value is nullable rather than a misleading zero.

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Longest a single quiz attempt can contribute to practice time. An attempt left
 * open overnight would otherwise swamp the total, and a quiz that takes longer
 * than two hours was not two hours of studying.
 */
export const MAX_ATTEMPT_MINUTES = 120;

/** Below this, a topic counts as one to review rather than one you know. */
export const WEAK_TOPIC_ACCURACY = 80;

/** How many attempts the trend line plots. */
export const TREND_POINTS = 10;

/** How many days the activity columns cover. */
export const ACTIVITY_DAYS = 7;

export type QuestionTypeName = "multiple_choice" | "true_false" | "short_answer";

/** A completed quiz attempt, joined to the quiz it came from. */
export type AttemptInput = {
  id: string;
  title: string;
  topic: string | null;
  score: number;
  totalQuestions: number;
  startedAt: Date;
  completedAt: Date;
  roomId: string | null;
};

/** One graded question. `topic` is the resolved label (quiz topic or title). */
export type AnswerInput = {
  topic: string;
  questionType: QuestionTypeName;
  isCorrect: boolean;
};

export type ProgressSummary = {
  quizzesTaken: number;
  questionsAnswered: number;
  questionsCorrect: number;
  /** Mean of the attempts' own percentages, rounded; null with no attempts. */
  averageScorePct: number | null;
  bestScorePct: number | null;
  /** Share of graded questions answered correctly; null with no answers. */
  accuracyPct: number | null;
  /** Minutes spent in quizzes, clamped per attempt (see MAX_ATTEMPT_MINUTES). */
  practiceMinutes: number;
  activeDays: number;
  streakDays: number;
};

export type TrendPoint = {
  attemptId: string;
  /** "Oct 16", for the axis under the point. */
  label: string;
  /** Full title, shown on hover. */
  title: string;
  pct: number;
  score: number;
  total: number;
  completedAt: Date;
  inRoom: boolean;
};

export type TopicStat = {
  /** Display form: the first spelling seen for this topic. */
  topic: string;
  answers: number;
  correct: number;
  accuracyPct: number | null;
  attempts: number;
  lastPracticedAt: Date | null;
};

export type DayStat = {
  /** Local calendar day, "2026-10-16". */
  day: string;
  /** "Thu", for the axis. */
  label: string;
  /** "Oct 16", for the tooltip/title. */
  title: string;
  attempts: number;
  minutes: number;
  isToday: boolean;
};

export type QuestionTypeStat = {
  type: QuestionTypeName;
  label: string;
  answers: number;
  correct: number;
  accuracyPct: number | null;
};

export type NextStep =
  | { kind: "get-started"; message: string; href: string }
  | { kind: "weak-topic"; topic: string; accuracyPct: number; message: string; href: string }
  | { kind: "stretch"; message: string; href: string };

export type ChangeOverTime = {
  /** Percentage points gained (+) or lost (−) between the two windows. */
  deltaPct: number;
  direction: "up" | "down" | "flat";
  /** Attempts compared, e.g. "your last 3 quizzes". */
  label: string;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Rounded percentage, or null when there is nothing to divide by. */
export function percentage(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * The label a topic is grouped under: the quiz's topic when it has one, the quiz
 * title otherwise, so a quiz made from a document without a topic still appears.
 */
export function topicLabelOf(topic: string | null | undefined, title: string): string {
  const trimmed = topic?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : title.trim();
}

/** Case-insensitive grouping key, so "Biology" and "biology" are one row. */
function topicKey(topic: string): string {
  return topic.toLowerCase();
}

/** Minutes a single attempt contributed, clamped and never negative. */
export function attemptMinutes(attempt: AttemptInput): number {
  const span = (attempt.completedAt.getTime() - attempt.startedAt.getTime()) / MS_PER_MINUTE;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.min(Math.round(span), MAX_ATTEMPT_MINUTES);
}

/** The student's local calendar day, as "2026-10-16". */
export function localDayKey(instant: Date, tzOffsetMinutes: number): string {
  const shifted = new Date(instant.getTime() - tzOffsetMinutes * MS_PER_MINUTE);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate()
  )}`;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * The headline numbers. `tzOffsetMinutes` is minutes behind UTC as
 * `new Date().getTimezoneOffset()` reports it (-480 for Polomolok), so a study
 * day is the student's day and not the server's.
 */
export function summarize(
  attempts: AttemptInput[],
  answers: AnswerInput[],
  options: { now: Date; tzOffsetMinutes: number }
): ProgressSummary {
  const scoredAttempts = attempts.filter((attempt) => attempt.totalQuestions > 0);
  const percentages = scoredAttempts
    .map((attempt) => percentage(attempt.score, attempt.totalQuestions))
    .filter((value): value is number => value !== null);

  const questionsCorrect = answers.filter((answer) => answer.isCorrect).length;
  const days = new Set(attempts.map((a) => localDayKey(a.completedAt, options.tzOffsetMinutes)));

  return {
    quizzesTaken: attempts.length,
    questionsAnswered: answers.length,
    questionsCorrect,
    averageScorePct: mean(percentages),
    bestScorePct: percentages.length > 0 ? Math.max(...percentages) : null,
    accuracyPct: percentage(questionsCorrect, answers.length),
    practiceMinutes: attempts.reduce((sum, attempt) => sum + attemptMinutes(attempt), 0),
    activeDays: days.size,
    streakDays: streakDays(attempts, options),
  };
}

/**
 * Consecutive days ending today (or yesterday, so a streak isn't shown as broken
 * before the student has had a chance to study today).
 */
export function streakDays(
  attempts: AttemptInput[],
  options: { now: Date; tzOffsetMinutes: number }
): number {
  if (attempts.length === 0) return 0;

  const days = new Set(
    attempts.map((attempt) => localDayKey(attempt.completedAt, options.tzOffsetMinutes))
  );
  const today = localDayKey(options.now, options.tzOffsetMinutes);

  const start = days.has(today)
    ? options.now.getTime()
    : options.now.getTime() - MS_PER_DAY;
  if (!days.has(localDayKey(new Date(start), options.tzOffsetMinutes))) return 0;

  let streak = 0;
  for (let day = start; ; day -= MS_PER_DAY) {
    if (!days.has(localDayKey(new Date(day), options.tzOffsetMinutes))) break;
    streak += 1;
  }
  return streak;
}

/**
 * Whether the student is improving: this half of their attempts against the
 * part before it. Null until there is enough history for the comparison to mean
 * anything.
 */
export function changeOverTime(
  attempts: AttemptInput[],
  window = 3
): ChangeOverTime | null {
  const scored = attempts.filter((attempt) => attempt.totalQuestions > 0);
  if (scored.length < window * 2) return null;

  const toPct = (attempt: AttemptInput) =>
    percentage(attempt.score, attempt.totalQuestions) ?? 0;

  const recent = scored.slice(-window).map(toPct);
  const earlier = scored.slice(-window * 2, -window).map(toPct);
  const recentMean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const earlierMean = earlier.reduce((sum, value) => sum + value, 0) / earlier.length;
  const deltaPct = Math.round(recentMean - earlierMean);

  return {
    deltaPct,
    direction: deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "flat",
    label: `your last ${window} quizzes vs the ${window} before`,
  };
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** The last `limit` attempts, oldest first, ready to plot as a line. */
export function buildScoreTrend(
  attempts: AttemptInput[],
  limit = TREND_POINTS
): TrendPoint[] {
  return attempts
    .slice(-limit)
    .filter((attempt) => attempt.totalQuestions > 0)
    .map((attempt) => ({
      attemptId: attempt.id,
      label: new Date(attempt.completedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      title: attempt.title,
      pct: percentage(attempt.score, attempt.totalQuestions) ?? 0,
      score: attempt.score,
      total: attempt.totalQuestions,
      completedAt: attempt.completedAt,
      inRoom: attempt.roomId !== null,
    }));
}

/**
 * Topics ranked weakest first, from the graded answers. A topic with no answers
 * yet (a quiz opened but whose questions were never submitted) still appears,
 * with a null accuracy.
 */
export function buildTopicStats(
  attempts: AttemptInput[],
  answers: AnswerInput[]
): TopicStat[] {
  const stats = new Map<string, TopicStat>();

  const ensure = (topic: string, at: Date | null): TopicStat => {
    const key = topicKey(topic);
    let stat = stats.get(key);
    if (!stat) {
      stat = {
        topic,
        answers: 0,
        correct: 0,
        accuracyPct: null,
        attempts: 0,
        lastPracticedAt: null,
      };
      stats.set(key, stat);
    }
    if (at && (!stat.lastPracticedAt || at > stat.lastPracticedAt)) {
      stat.lastPracticedAt = at;
    }
    return stat;
  };

  for (const attempt of attempts) {
    const stat = ensure(topicLabelOf(attempt.topic, attempt.title), attempt.completedAt);
    stat.attempts += 1;
  }

  for (const answer of answers) {
    const stat = ensure(answer.topic, null);
    stat.answers += 1;
    if (answer.isCorrect) stat.correct += 1;
  }

  return [...stats.values()]
    .map((stat) => ({ ...stat, accuracyPct: percentage(stat.correct, stat.answers) }))
    .sort((a, b) => {
      // Weakest first; a topic with no answers sits just after those with some,
      // and ties break towards the one answered more often (stronger evidence).
      if (a.accuracyPct === null && b.accuracyPct !== null) return 1;
      if (b.accuracyPct === null && a.accuracyPct !== null) return -1;
      if (a.accuracyPct !== b.accuracyPct) {
        return (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0);
      }
      return b.answers - a.answers;
    });
}

/** Topic rows that deserve review: enough evidence and below the bar. */
export function weakTopics(stats: TopicStat[], minimumAnswers = 2): TopicStat[] {
  return stats.filter(
    (stat) =>
      stat.answers >= minimumAnswers &&
      stat.accuracyPct !== null &&
      stat.accuracyPct < WEAK_TOPIC_ACCURACY
  );
}

/** Topic rows the student is solid on, strongest first. */
export function strongTopics(stats: TopicStat[], minimumAnswers = 2): TopicStat[] {
  return stats
    .filter(
      (stat) =>
        stat.answers >= minimumAnswers &&
        stat.accuracyPct !== null &&
        stat.accuracyPct >= WEAK_TOPIC_ACCURACY
    )
    .sort((a, b) => (b.accuracyPct ?? 0) - (a.accuracyPct ?? 0));
}

/** The last `days` local days, each with its attempts and practice minutes. */
export function buildDailyActivity(
  attempts: AttemptInput[],
  options: { days?: number; now: Date; tzOffsetMinutes: number }
): DayStat[] {
  const days = options.days ?? ACTIVITY_DAYS;
  const byDay = new Map<string, { attempts: number; minutes: number }>();

  for (const attempt of attempts) {
    const day = localDayKey(attempt.completedAt, options.tzOffsetMinutes);
    const entry = byDay.get(day) ?? { attempts: 0, minutes: 0 };
    entry.attempts += 1;
    entry.minutes += attemptMinutes(attempt);
    byDay.set(day, entry);
  }

  const todayKey = localDayKey(options.now, options.tzOffsetMinutes);
  const result: DayStat[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const instant = new Date(options.now.getTime() - offset * MS_PER_DAY);
    const day = localDayKey(instant, options.tzOffsetMinutes);
    const entry = byDay.get(day) ?? { attempts: 0, minutes: 0 };
    result.push({
      day,
      label: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
      title: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      attempts: entry.attempts,
      minutes: entry.minutes,
      isToday: day === todayKey,
    });
  }

  return result;
}

const TYPE_LABELS: Record<QuestionTypeName, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

export function buildQuestionTypeStats(answers: AnswerInput[]): QuestionTypeStat[] {
  const order: QuestionTypeName[] = ["multiple_choice", "true_false", "short_answer"];

  return order.map((type) => {
    const rows = answers.filter((answer) => answer.questionType === type);
    const correct = rows.filter((answer) => answer.isCorrect).length;
    return {
      type,
      label: TYPE_LABELS[type],
      answers: rows.length,
      correct,
      accuracyPct: percentage(correct, rows.length),
    };
  });
}

// ---------------------------------------------------------------------------
// What to do next
// ---------------------------------------------------------------------------

/**
 * One actionable suggestion, in the order the spec cares about: practise the
 * weakest topic, otherwise stretch. The href carries the topic to the quiz page,
 * which pre-fills it, so the suggestion is one click away from starting.
 */
export function pickNextStep(attempts: AttemptInput[], stats: TopicStat[]): NextStep {
  if (attempts.length === 0) {
    return {
      kind: "get-started",
      message: "Take your first quiz and this page fills in with your scores and trends.",
      href: "/dashboard/quiz",
    };
  }

  const weakest = weakTopics(stats)[0];
  if (weakest && weakest.accuracyPct !== null) {
    return {
      kind: "weak-topic",
      topic: weakest.topic,
      accuracyPct: weakest.accuracyPct,
      message: `${weakest.topic} is your weakest topic at ${weakest.accuracyPct}% — practise it while it is fresh.`,
      href: `/dashboard/quiz?topic=${encodeURIComponent(weakest.topic)}`,
    };
  }

  return {
    kind: "stretch",
    message:
      "Every topic you have practised is at or above 80%. Push into a topic you have not quizzed yourself on yet.",
    href: "/dashboard/quiz",
  };
}

// ---------------------------------------------------------------------------
// Formatting shared with the UI
// ---------------------------------------------------------------------------

/** "1h 25m", "45m", "—" when nothing was recorded. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "100%" / "—" when there is nothing to show. */
export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}
