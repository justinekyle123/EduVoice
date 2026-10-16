"use server";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { quizAnswers, quizAttempts, quizQuestions, quizzes } from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import {
  ACTIVITY_DAYS,
  TREND_POINTS,
  buildDailyActivity,
  buildQuestionTypeStats,
  buildScoreTrend,
  buildTopicStats,
  changeOverTime,
  pickNextStep,
  strongTopics,
  summarize,
  topicLabelOf,
  weakTopics,
  type AnswerInput,
  type AttemptInput,
  type ChangeOverTime,
  type DayStat,
  type NextStep,
  type ProgressSummary,
  type QuestionTypeName,
  type QuestionTypeStat,
  type TopicStat,
  type TrendPoint,
} from "../lib/trends";

// Progress Visualization and Summary Trends (feature 6.10).
//
// Reads the two things a student's performance is recorded in — completed quiz
// attempts and the per-question answers to them — and hands them to
// features/progress/lib/trends.ts, which does all of the arithmetic. Queries are
// deliberately dumb (no GROUP BY, no scoring in SQL): the rules that decide what
// "weak topic" or "study time" mean stay in one testable place, and the two
// result sets are small because they are one student's own history.

// Same Clerk → Postgres user resolution the chat, quiz, rooms and tasks features
// use: rows are keyed by `users.id` (uuid) while `auth()` returns the Clerk id,
// and the row is created on demand if the webhook hasn't synced yet.
async function requireUserId(clerkId: string): Promise<string> {
  let user = await getUserByClerkId(clerkId);
  if (!user) {
    const clerkUser = await currentUser();
    user = await upsertUser({
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: clerkUser?.fullName ?? clerkUser?.username ?? null,
    });
  }
  return user.id;
}

/** A student's history is bounded, so the page can never balloon. */
const MAX_ATTEMPTS = 200;
const MAX_ANSWERS = 2_000;

export type ProgressOverview = {
  generatedAt: string;
  summary: ProgressSummary;
  change: ChangeOverTime | null;
  trend: TrendPoint[];
  topics: TopicStat[];
  weak: TopicStat[];
  strong: TopicStat[];
  daily: DayStat[];
  questionTypes: QuestionTypeStat[];
  recent: {
    id: string;
    title: string;
    score: number;
    total: number;
    pct: number;
    completedAt: Date;
    inRoom: boolean;
  }[];
  nextStep: NextStep;
};

/**
 * Everything the progress page draws, in one round trip.
 *
 * `tzOffsetMinutes` is the caller's own offset (minutes behind UTC), passed so
 * the activity columns and the streak are bucketed by the student's calendar day
 * rather than the server's.
 */
export async function getProgressOverview(input?: {
  tzOffsetMinutes?: number;
}): Promise<ProgressOverview> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const tzOffsetMinutes = Number.isFinite(input?.tzOffsetMinutes)
    ? Math.trunc(input?.tzOffsetMinutes as number)
    : 0;
  const now = new Date();

  // 1. Completed attempts only — an abandoned quiz is not performance.
  const attemptRows = await db
    .select({
      id: quizAttempts.id,
      title: quizzes.title,
      topic: quizzes.topic,
      score: quizAttempts.score,
      totalQuestions: quizAttempts.totalQuestions,
      startedAt: quizAttempts.startedAt,
      completedAt: quizAttempts.completedAt,
      roomId: quizAttempts.roomId,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAttempts.completedAt)))
    .orderBy(desc(quizAttempts.completedAt))
    .limit(MAX_ATTEMPTS);

  const attempts: AttemptInput[] = attemptRows
    .map((row) => ({
      id: row.id,
      title: row.title,
      topic: row.topic,
      score: row.score,
      totalQuestions: row.totalQuestions,
      startedAt: row.startedAt,
      // Non-null by the WHERE clause; the column is nullable so it is asserted.
      completedAt: row.completedAt as Date,
      roomId: row.roomId,
    }))
    // The charts read oldest → newest, which is the opposite of the query's
    // newest-first ordering (kept so the LIMIT takes the most recent history).
    .reverse();

  // 2. Each graded question, with the topic it belongs to. A score alone cannot
  //    say which topic is weak, so the answers travel with their quiz.
  const answerRows = await db
    .select({
      isCorrect: quizAnswers.isCorrect,
      questionType: quizQuestions.type,
      topic: quizzes.topic,
      title: quizzes.title,
      completedAt: quizAttempts.completedAt,
    })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .innerJoin(quizQuestions, eq(quizQuestions.id, quizAnswers.questionId))
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAttempts.completedAt)))
    .orderBy(asc(quizAttempts.completedAt))
    .limit(MAX_ANSWERS);

  const answers: AnswerInput[] = answerRows.map((row) => ({
    topic: topicLabelOf(row.topic, row.title),
    questionType: row.questionType as QuestionTypeName,
    isCorrect: row.isCorrect,
  }));

  const topics = buildTopicStats(attempts, answers);

  return {
    generatedAt: now.toISOString(),
    summary: summarize(attempts, answers, { now, tzOffsetMinutes }),
    change: changeOverTime(attempts),
    trend: buildScoreTrend(attempts, TREND_POINTS),
    topics,
    weak: weakTopics(topics),
    strong: strongTopics(topics),
    daily: buildDailyActivity(attempts, {
      days: ACTIVITY_DAYS,
      now,
      tzOffsetMinutes,
    }),
    questionTypes: buildQuestionTypeStats(answers),
    recent: attempts
      .slice(-5)
      .reverse()
      .map((attempt) => ({
        id: attempt.id,
        title: attempt.title,
        score: attempt.score,
        total: attempt.totalQuestions,
        pct:
          attempt.totalQuestions > 0
            ? Math.round((attempt.score / attempt.totalQuestions) * 100)
            : 0,
        completedAt: attempt.completedAt,
        inRoom: attempt.roomId !== null,
      })),
    nextStep: pickNextStep(attempts, topics),
  };
}
