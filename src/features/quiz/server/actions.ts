"use server";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  studyRooms,
} from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import { membershipFor } from "@/features/rooms/server/membership";
import {
  generateQuizQuestions,
  isAnswerCorrect,
  type QuestionType,
} from "../lib/generate";

// Same Clerk → Postgres user resolution the chat and rooms features use.
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

/** A question as the student should see it — no answer or explanation attached. */
export type SafeQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options: string[] | null;
  order: number;
};

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 15;
const DEFAULT_QUESTIONS = 5;

async function questionsFor(quizId: string): Promise<SafeQuestion[]> {
  const rows = await db
    .select({
      id: quizQuestions.id,
      question: quizQuestions.question,
      type: quizQuestions.type,
      options: quizQuestions.options,
      order: quizQuestions.order,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.order));

  return rows as SafeQuestion[];
}

/**
 * Open a new attempt at a quiz. When `roomId` is supplied the attempt is stamped
 * with it, which is what puts the score on that room's shared leaderboard
 * (schema feature 6.13) — so membership is verified before the stamp is applied.
 */
async function openAttempt(quizId: string, userId: string, roomId?: string | null) {
  let attributedRoomId: string | null = null;

  if (roomId) {
    const member = await membershipFor(roomId, userId);
    if (!member) throw new Error("You are not a member of that study room");
    attributedRoomId = roomId;
  }

  const total = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));

  const [attempt] = await db
    .insert(quizAttempts)
    .values({
      quizId,
      userId,
      roomId: attributedRoomId,
      totalQuestions: total[0]?.value ?? 0,
    })
    .returning();

  return attempt;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * Write a quiz with the AI and immediately open an attempt at it, so a student
 * goes from typing a topic to answering questions in one round trip.
 */
export async function generateQuiz(input: {
  topic: string;
  count?: number;
  roomId?: string | null;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const topic = input.topic.trim();
  if (topic.length < 3) throw new Error("Give the quiz a longer topic");
  if (topic.length > 200) throw new Error("That topic is too long");

  const requested = input.count ?? DEFAULT_QUESTIONS;
  const count = Math.min(Math.max(Math.round(requested), MIN_QUESTIONS), MAX_QUESTIONS);

  // Validate room membership before spending an AI request on the quiz.
  let room: { id: string; name: string; documentId: string | null } | null = null;
  if (input.roomId) {
    const member = await membershipFor(input.roomId, userId);
    if (!member) throw new Error("You are not a member of that study room");
    const [roomRow] = await db
      .select({
        id: studyRooms.id,
        name: studyRooms.name,
        documentId: studyRooms.documentId,
      })
      .from(studyRooms)
      .where(eq(studyRooms.id, input.roomId));
    if (!roomRow) throw new Error("That study room no longer exists");
    room = roomRow;
  }

  // A room's shared material is the source of truth for its quizzes; without a
  // document attached the topic carries the context instead.
  const generated = await generateQuizQuestions({ topic, count });

  const [quiz] = await db
    .insert(quizzes)
    .values({
      userId,
      title: generated.title,
      topic,
      documentId: room?.documentId ?? null,
    })
    .returning();

  const inserted = await db
    .insert(quizQuestions)
    .values(
      generated.questions.map((question, index) => ({
        quizId: quiz.id,
        question: question.question,
        type: question.type,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        order: index,
      }))
    )
    .returning({
      id: quizQuestions.id,
      question: quizQuestions.question,
      type: quizQuestions.type,
      options: quizQuestions.options,
      order: quizQuestions.order,
    });

  const attempt = await openAttempt(quiz.id, userId, room?.id ?? null);

  return {
    quiz,
    questions: inserted as SafeQuestion[],
    attemptId: attempt.id,
    provider: generated.provider,
    roomName: room?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Retake an existing quiz
// ---------------------------------------------------------------------------

/** Reopen an existing quiz — handy for a second run at a room leaderboard. */
export async function startQuizAttempt(input: {
  quizId: string;
  roomId?: string | null;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [quiz] = await db
    .select({ id: quizzes.id, title: quizzes.title })
    .from(quizzes)
    .where(eq(quizzes.id, input.quizId));
  if (!quiz) throw new Error("That quiz no longer exists");

  const questions = await questionsFor(quiz.id);
  if (questions.length === 0) throw new Error("That quiz has no questions");

  const attempt = await openAttempt(quiz.id, userId, input.roomId);

  return { quiz, questions, attemptId: attempt.id };
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

/**
 * Grade a finished attempt, store the per-question answers, and close the
 * attempt out. `completed_at` and the room id together are what the shared
 * leaderboard reads.
 */
export async function submitQuizAttempt(input: {
  attemptId: string;
  answers: { questionId: string; userAnswer: string }[];
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.id, input.attemptId), eq(quizAttempts.userId, userId))
    );
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.completedAt) throw new Error("This attempt was already submitted");

  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, attempt.quizId))
    .orderBy(asc(quizQuestions.order));
  if (questions.length === 0) throw new Error("This quiz has no questions");

  const givenByQuestion = new Map(
    input.answers.map((answer) => [answer.questionId, answer.userAnswer.trim()])
  );

  const graded = questions.map((question) => {
    const userAnswer = givenByQuestion.get(question.id) ?? "";
    const isCorrect = isAnswerCorrect(
      question.type,
      question.correctAnswer,
      userAnswer
    );
    return { question, userAnswer, isCorrect };
  });

  // UNIQUE (attempt_id, question_id) makes a re-submit an update, not a dupe.
  await db
    .insert(quizAnswers)
    .values(
      graded.map((entry) => ({
        attemptId: attempt.id,
        questionId: entry.question.id,
        userAnswer: entry.userAnswer,
        isCorrect: entry.isCorrect,
      }))
    )
    .onConflictDoUpdate({
      target: [quizAnswers.attemptId, quizAnswers.questionId],
      set: {
        userAnswer: sql`excluded.user_answer`,
        isCorrect: sql`excluded.is_correct`,
      },
    });

  const score = graded.filter((entry) => entry.isCorrect).length;

  const [closed] = await db
    .update(quizAttempts)
    .set({
      score,
      totalQuestions: questions.length,
      completedAt: new Date(),
    })
    .where(eq(quizAttempts.id, attempt.id))
    .returning();

  return {
    attempt: closed,
    score,
    total: questions.length,
    roomId: closed.roomId,
    results: graded.map((entry) => ({
      questionId: entry.question.id,
      question: entry.question.question,
      type: entry.question.type,
      options: entry.question.options,
      userAnswer: entry.userAnswer,
      correctAnswer: entry.question.correctAnswer,
      explanation: entry.question.explanation,
      isCorrect: entry.isCorrect,
    })),
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** The signed-in student's quizzes, newest first, with their best score. */
export async function getRecentQuizzes(limit = 8) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  return db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      topic: quizzes.topic,
      createdAt: quizzes.createdAt,
      questionCount: sql<number>`(
        select count(*)::int from ${quizQuestions} q
        where q.quiz_id = ${quizzes.id}
      )`,
      attempts: sql<number>`(
        select count(*)::int from ${quizAttempts} a
        where a.quiz_id = ${quizzes.id} and a.completed_at is not null
      )`,
      bestScore: sql<number>`coalesce((
        select max(a.score) from ${quizAttempts} a
        where a.quiz_id = ${quizzes.id} and a.completed_at is not null
      ), 0)`,
    })
    .from(quizzes)
    .where(eq(quizzes.userId, userId))
    .orderBy(desc(quizzes.createdAt))
    .limit(limit);
}

/** Recent completed attempts, used to show quiz history on the quiz page. */
export async function getRecentAttempts(limit = 5) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  return db
    .select({
      id: quizAttempts.id,
      quizId: quizAttempts.quizId,
      title: quizzes.title,
      score: quizAttempts.score,
      totalQuestions: quizAttempts.totalQuestions,
      roomId: quizAttempts.roomId,
      completedAt: quizAttempts.completedAt,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(
      and(eq(quizAttempts.userId, userId), isNotNull(quizAttempts.completedAt))
    )
    .orderBy(desc(quizAttempts.completedAt))
    .limit(limit);
}
