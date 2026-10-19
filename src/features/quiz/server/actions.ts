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
  canQuizFromFile,
  generateQuizQuestions,
  generateQuizQuestionsFromFile,
  isAnswerCorrect,
  type QuestionType,
} from "../lib/generate";
import {
  renderQuizQuestionAudio,
  type QuizAudioStatus,
} from "./voiceRender";

// Same Clerk → Postgres user resolution the chat and rooms features use.
const userIdCache = new Map<string, string>();

async function requireUserId(clerkId: string): Promise<string> {
  const cached = userIdCache.get(clerkId);
  if (cached) return cached;

  let user = await getUserByClerkId(clerkId);
  if (!user) {
    const clerkUser = await currentUser();
    user = await upsertUser({
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: clerkUser?.fullName ?? clerkUser?.username ?? null,
    });
  }
  userIdCache.set(clerkId, user.id);
  return user.id;
}

/** A question as the student should see it — no answer or explanation attached. */
export type SafeQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options: string[] | null;
  order: number;
  /**
   * The question's pre-rendered narration clip in this quiz's audio folder, or
   * null when it could not be rendered — the voice quiz then synthesizes the
   * line live (see server/voiceRender.ts). A file name, never a path.
   */
  audioFile: string | null;
};

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 15;
const DEFAULT_QUESTIONS = 5;

/**
 * Largest file we will send to the model. Sits under the 16MB server-action
 * body limit (which also counts multipart overhead) and the inline-data cap in
 * `../lib/generate`.
 */
const MAX_QUIZ_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

async function questionsFor(quizId: string): Promise<SafeQuestion[]> {
  const rows = await db
    .select({
      id: quizQuestions.id,
      question: quizQuestions.question,
      type: quizQuestions.type,
      options: quizQuestions.options,
      order: quizQuestions.order,
      audioFile: quizQuestions.audioFile,
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

/** One document handed to the quiz writer instead of a topic. */
type QuizFile = {
  fileName: string;
  mimeType: string;
  data: Buffer;
} | null;

/**
 * The shared body of both generators: resolve the room (if any), write the quiz
 * — from a topic or an uploaded file — store it, and open the attempt. Callers
 * have already authenticated and decided which source they have.
 */
async function createQuiz(input: {
  userId: string;
  topic: string;
  count: number;
  roomId?: string | null;
  file: QuizFile;
}) {
  const topic = input.topic.trim();
  // A file already names the subject, so a topic is only required without one.
  if (!input.file && topic.length < 3) throw new Error("Give the quiz a longer topic");
  if (topic.length > 200) throw new Error("That topic is too long");

  const requested = input.count;
  const count = Math.min(Math.max(Math.round(requested), MIN_QUESTIONS), MAX_QUESTIONS);

  // Validate room membership before spending an AI request on the quiz.
  let room: { id: string; name: string; documentId: string | null } | null = null;
  if (input.roomId) {
    const member = await membershipFor(input.roomId, input.userId);
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
  const generated = input.file
    ? await generateQuizQuestionsFromFile({
        fileName: input.file.fileName,
        topic,
        count,
        mimeType: input.file.mimeType,
        data: input.file.data,
      })
    : await generateQuizQuestions({ topic, count });

  const [quiz] = await db
    .insert(quizzes)
    .values({
      userId: input.userId,
      title: generated.title,
      topic: input.file ? input.file.fileName : topic,
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
      audioFile: quizQuestions.audioFile,
    });

  // Finish the best-effort render before handing the quiz over. This keeps a
  // newly generated voice quiz continuous from its first question onward and
  // avoids relying on post-response work that may be interrupted by a runtime.
  const prepared = await withNarrationClips(
    quiz.id,
    inserted as SafeQuestion[]
  );

  const attempt = await openAttempt(quiz.id, input.userId, room?.id ?? null);

  return {
    quiz,
    questions: prepared.questions,
    audioStatus: prepared.status,
    attemptId: attempt.id,
    provider: generated.provider,
    roomName: room?.name ?? null,
    // The quiz was just written, so its answers are already in hand. Handing
    // them over with the quiz is what lets the voice player mark an answer the
    // instant the student stops talking — no round trip, no second request to
    // race with the first question.
    answerKey: inserted.map((row, index) => ({
      questionId: row.id,
      type: row.type,
      correctAnswer: generated.questions[index]?.correctAnswer ?? "",
      explanation: generated.questions[index]?.explanation ?? null,
    })),
  };
}

/**
 * Render a new quiz's questions into narration clips and stamp each key onto its
 * row. Best-effort by design: a question with no clip is still perfectly
 * answerable, because the voice player synthesizes the line it has no file for.
 */
async function withNarrationClips(
  quizId: string,
  questions: SafeQuestion[]
): Promise<{ questions: SafeQuestion[]; status: QuizAudioStatus }> {
  if (questions.length === 0) return { questions, status: "ready" };

  let rendered: Map<string, string>;
  let status: QuizAudioStatus;
  try {
    const result = await renderQuizQuestionAudio({ quizId, questions });
    rendered = result.clips;
    status = result.status;
  } catch (err) {
    console.warn("[quiz] could not prepare the voice quiz audio:", err);
    return { questions, status: "unavailable" };
  }
  if (rendered.size === 0) return { questions, status };

  // One update per clip: the key only exists once the file is written, and a quiz
  // is at most fifteen questions.
  try {
    await Promise.all(
      [...rendered].map(([questionId, key]) =>
        db
          .update(quizQuestions)
          .set({ audioFile: key })
          .where(eq(quizQuestions.id, questionId))
      )
    );
  } catch (err) {
    // The clips are on disk either way; a failed stamp only costs a re-render on
    // the next attempt, and the stored key is what the player is told to use — so
    // a row that kept a null still plays, just through live synthesis.
    console.warn("[quiz] rendered the clips but could not record them:", err);
  }

  return {
    questions: questions.map((question) => ({
      ...question,
      audioFile: rendered.get(question.id) ?? question.audioFile,
    })),
    status,
  };
}

/**
 * Write a quiz from a topic and immediately open an attempt at it.
 */
export async function generateQuiz(input: {
  topic: string;
  count?: number;
  roomId?: string | null;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  return createQuiz({
    userId,
    topic: input.topic,
    count: input.count ?? DEFAULT_QUESTIONS,
    roomId: input.roomId,
    file: null,
  });
}

/**
 * Write a quiz grounded in an uploaded file. The file arrives in a FormData body
 * (so the browser streams it rather than base64-ing it into the call) and is
 * read by the model directly — this is what makes the questions based on the
 * student's own material rather than on a topic string.
 */
export async function generateQuizFromFile(formData: FormData) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a file to generate from");
  if (file.size === 0) throw new Error("That file is empty");
  if (file.size > MAX_QUIZ_FILE_BYTES) {
    throw new Error(
      `Files must be ${Math.round(MAX_QUIZ_FILE_BYTES / (1024 * 1024))} MB or smaller`
    );
  }
  if (!canQuizFromFile(file.name, file.type)) {
    throw new Error("Quizzing from a file works with PDF and text files");
  }

  const topicValue = formData.get("topic");
  const countValue = formData.get("count");
  const roomValue = formData.get("roomId");

  const data = Buffer.from(await file.arrayBuffer());

  return createQuiz({
    userId,
    topic: typeof topicValue === "string" ? topicValue : "",
    count:
      typeof countValue === "string" ? Number(countValue) : DEFAULT_QUESTIONS,
    roomId:
      typeof roomValue === "string" && roomValue.length > 0 ? roomValue : null,
    file: {
      fileName: file.name.slice(0, 200),
      mimeType: file.type || "application/octet-stream",
      data,
    },
  });
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

  return {
    quiz,
    questions,
    attemptId: attempt.id,
    audioStatus: questions.every((question) => question.audioFile)
      ? "ready"
      : "unavailable",
    // Sent with the quiz so the voice player can grade an answer locally and at
    // once, exactly like a generated quiz's key.
    answerKey: await answerKeyFor(quiz.id),
  };
}

/**
 * A quiz's answer key, without the ownership check `getQuizAnswerKey` makes —
 * callers here have already resolved the quiz for this student.
 */
async function answerKeyFor(quizId: string): Promise<QuizAnswerKeyEntry[]> {
  const rows = await db
    .select({
      questionId: quizQuestions.id,
      type: quizQuestions.type,
      correctAnswer: quizQuestions.correctAnswer,
      explanation: quizQuestions.explanation,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.order));
  return rows as QuizAnswerKeyEntry[];
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

/** One question's answer key, as the voice quiz prefetches it. */
export type QuizAnswerKeyEntry = {
  questionId: string;
  type: QuestionType;
  correctAnswer: string;
  explanation: string | null;
};

/**
 * The answer key for a voice quiz, fetched once before the first question.
 *
 * Checking an answer through `gradeQuizAnswer` costs a server-action round trip
 * (plus Clerk auth and a database query), which is enough to leave the student
 * looking at "Checking that answer…" between every question. The voice player
 * prefetches this key while the intro is still being read, then grades locally
 * with the same `isAnswerCorrect` comparison. The finished attempt is still
 * graded by `submitQuizAttempt` on the server, so the stored score never trusts
 * the browser. Ownership is checked here, and the key never includes anything
 * the quiz page did not already need in order to explain a verdict.
 */
export async function getQuizAnswerKey(
  quizId: string
): Promise<QuizAnswerKeyEntry[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const rows = await db
    .select({
      questionId: quizQuestions.id,
      type: quizQuestions.type,
      correctAnswer: quizQuestions.correctAnswer,
      explanation: quizQuestions.explanation,
    })
    .from(quizQuestions)
    .innerJoin(quizzes, eq(quizzes.id, quizQuestions.quizId))
    .where(and(eq(quizQuestions.quizId, quizId), eq(quizzes.userId, userId)))
    .orderBy(asc(quizQuestions.order));

  if (rows.length === 0) {
    throw new Error("That quiz is not part of one of your quizzes");
  }
  return rows as QuizAnswerKeyEntry[];
}

/**
 * Judge a single answer, for callers that have not prefetched the key.
 *
 * A question reaches the browser without its answer (see `SafeQuestion`), so if
 * the voice quiz's prefetch failed this is the safe fallback. Nothing is
 * written: the attempt is graded again by `submitQuizAttempt` at the end, through
 * the same comparison, so the verdict the student heard and the score they end up
 * with cannot disagree.
 */
export async function gradeQuizAnswer(input: {
  questionId: string;
  userAnswer: string;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [row] = await db
    .select({
      type: quizQuestions.type,
      correctAnswer: quizQuestions.correctAnswer,
      explanation: quizQuestions.explanation,
    })
    .from(quizQuestions)
    .innerJoin(quizzes, eq(quizzes.id, quizQuestions.quizId))
    .where(
      and(eq(quizQuestions.id, input.questionId), eq(quizzes.userId, userId))
    );
  if (!row) throw new Error("That question is not part of one of your quizzes");

  return {
    correct: isAnswerCorrect(row.type, row.correctAnswer, input.userAnswer.trim()),
    correctAnswer: row.correctAnswer,
    explanation: row.explanation,
  };
}

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
      // The outer column is named with its table explicitly. A bare
      // `${quizzes.id}` in a select projection renders unqualified (just "id"),
      // which inside these subqueries binds to the subquery's own id column and
      // silently counts nothing.
      questionCount: sql<number>`(
        select count(*)::int from ${quizQuestions} q
        where q.quiz_id = ${sql.raw('"quizzes"."id"')}
      )`,
      attempts: sql<number>`(
        select count(*)::int from ${quizAttempts} a
        where a.quiz_id = ${sql.raw('"quizzes"."id"')} and a.completed_at is not null
      )`,
      bestScore: sql<number>`coalesce((
        select max(a.score) from ${quizAttempts} a
        where a.quiz_id = ${sql.raw('"quizzes"."id"')} and a.completed_at is not null
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
