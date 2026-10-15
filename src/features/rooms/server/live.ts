"use server";

// Live room quiz (feature 6.13) — the synchronized, voice-answered room quiz.
//
// Everyone in the room gets the same question at the same instant and answers it
// out loud; the question is shown as text and read by the narrator on the client.
// The session row is the shared clock: `questionStartedAt` + `questionSeconds`
// decide when a question closes, so every member derives the same phase from the
// same timestamps. Whoever polls first after a deadline applies the transition
// (a conditional UPDATE, so only one caller wins), which is what lets the quiz
// advance without a websocket or a background worker.

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  roomQuizReady,
  roomQuizResponses,
  roomQuizSessions,
  studyRoomMembers,
  studyRooms,
  users,
} from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import {
  generateQuizQuestions,
  generateQuizQuestionsFromFile,
  isAnswerCorrect,
  type QuestionType,
} from "@/features/quiz/lib/generate";
import { membershipFor } from "./membership";
import { readRoomFile } from "./files";
import { hasQuestionAudio } from "./quizAudio";
import {
  MANUAL_LIMITS,
  normalizeManualQuestion,
  type ManualQuestionDraft,
  type NormalizedManualQuestion,
} from "../lib/manualQuiz";
import {
  clampQuestionSeconds,
  nextTransition,
  rankLiveScores,
  rankLiveStandings,
  remainingMs,
  type LiveStatus,
} from "../lib/live";

// Same Clerk → Postgres user resolution the rest of the app uses.
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

type SessionRow = typeof roomQuizSessions.$inferSelect;

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 15;
const DEFAULT_QUESTIONS = 5;
/** A solo round isn't a room quiz — someone has to be competing against. */
const MIN_LIVE_PLAYERS = 2;

export type RoomLiveQuestion = {
  id: string;
  question: string;
  type: QuestionType;
  options: string[] | null;
  order: number;
  /** Only sent once the question is revealed, so nobody can peek early. */
  correctAnswer: string | null;
  explanation: string | null;
  /**
   * Where the host-dropped narration clip is served from, or null when the
   * question is read by TTS instead. Room-scoped: the route checks membership.
   */
  audioUrl: string | null;
};

export type RoomLiveBoardRow = {
  userId: string;
  name: string | null;
  email: string;
  correct: number;
  answered: number;
  totalMs: number;
  avgMs: number | null;
  rank: number;
};

export type RoomLiveState = {
  session: {
    id: string;
    roomId: string;
    quizId: string;
    hostId: string;
    status: LiveStatus;
    currentIndex: number;
    questionCount: number;
    questionSeconds: number;
    /** Epoch ms the current question opened, so clients can tick it locally. */
    questionStartedAtMs: number;
    /** Server clock at answer time, so clients can correct for skew. */
    serverNowMs: number;
  };
  /** Quiz title — shown in the waiting room before the first question. */
  title: string;
  question: RoomLiveQuestion | null;
  revealed: boolean;
  remainingMs: number;
  answeredCount: number;
  memberCount: number;
  /** Waiting-room ready list (only meaningful while `status` is "lobby"). */
  readyUserIds: string[];
  myReady: boolean;
  /** True once every non-host member has readied up. */
  allReady: boolean;
  /** The room roster, for the waiting-room list and host controls. */
  members: {
    userId: string;
    name: string | null;
    email: string;
    role: "owner" | "member";
  }[];
  myAnswer: string | null;
  myCorrect: boolean | null;
  /** Per-player results for the current question, only during the reveal. */
  responses: { userId: string; name: string | null; email: string; answer: string; isCorrect: boolean }[];
  board: RoomLiveBoardRow[];
  isHost: boolean;
  viewerId: string;
};

async function loadQuestions(quizId: string) {
  return db
    .select({
      id: quizQuestions.id,
      question: quizQuestions.question,
      type: quizQuestions.type,
      options: quizQuestions.options,
      correctAnswer: quizQuestions.correctAnswer,
      explanation: quizQuestions.explanation,
      audioFile: quizQuestions.audioFile,
      order: quizQuestions.order,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.order));
}

type QuestionRows = Awaited<ReturnType<typeof loadQuestions>>;

/** Every answer in a session, with the player who gave it attached. */
async function loadResponses(sessionId: string) {
  return db
    .select({
      userId: roomQuizResponses.userId,
      name: users.name,
      email: users.email,
      answer: roomQuizResponses.answer,
      isCorrect: roomQuizResponses.isCorrect,
      questionIndex: roomQuizResponses.questionIndex,
      responseMs: roomQuizResponses.responseMs,
    })
    .from(roomQuizResponses)
    .innerJoin(users, eq(users.id, roomQuizResponses.userId))
    .where(eq(roomQuizResponses.sessionId, sessionId));
}

type ResponseRows = Awaited<ReturnType<typeof loadResponses>>;

/** The room's most recent live session, whatever its status. */
async function latestSession(roomId: string): Promise<SessionRow | null> {
  const [session] = await db
    .select()
    .from(roomQuizSessions)
    .where(eq(roomQuizSessions.roomId, roomId))
    .orderBy(desc(roomQuizSessions.createdAt))
    .limit(1);
  return session ?? null;
}

async function refetch(sessionId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(roomQuizSessions)
    .where(eq(roomQuizSessions.id, sessionId));
  return row ?? null;
}

function clockOf(session: SessionRow) {
  return {
    status: session.status,
    currentIndex: session.currentIndex,
    questionCount: session.questionCount,
    questionSeconds: session.questionSeconds,
    questionStartedAt: session.questionStartedAt,
    revealedAt: session.revealedAt,
  };
}

/**
 * Write a finished session's results into `quiz_attempts`, so a live quiz feeds
 * the same room leaderboard as a solo one (schema feature 6.13). Only the caller
 * that wins the final transition calls this, so it can't double-count.
 */
async function finalizeSession(session: SessionRow) {
  const responses = await db
    .select({
      userId: roomQuizResponses.userId,
      questionIndex: roomQuizResponses.questionIndex,
      userAnswer: roomQuizResponses.answer,
      isCorrect: roomQuizResponses.isCorrect,
    })
    .from(roomQuizResponses)
    .where(eq(roomQuizResponses.sessionId, session.id));

  if (responses.length === 0) return;

  const questions = await loadQuestions(session.quizId);
  const byIndex = new Map(questions.map((q) => [q.order, q.id]));

  const byUser = new Map<string, typeof responses>();
  for (const row of responses) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const [userId, rows] of byUser) {
    const score = rows.filter((row) => row.isCorrect).length;
    const [attempt] = await db
      .insert(quizAttempts)
      .values({
        quizId: session.quizId,
        userId,
        roomId: session.roomId,
        score,
        totalQuestions: session.questionCount,
        startedAt: session.startedAt,
        completedAt: session.endedAt ?? new Date(),
      })
      .returning();

    const answers = rows
      .map((row) => {
        const questionId = byIndex.get(row.questionIndex);
        return questionId
          ? {
              attemptId: attempt.id,
              questionId,
              userAnswer: row.userAnswer,
              isCorrect: row.isCorrect,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (answers.length > 0) {
      await db.insert(quizAnswers).values(answers).onConflictDoNothing();
    }
  }
}

/**
 * Catch the session up to the wall clock: close an expired question, hold the
 * reveal for its moment, then open the next question or end the quiz. Each step
 * is a conditional UPDATE, so concurrent pollers can't double-advance — the
 * loser simply re-reads the row the winner wrote.
 */
async function syncSession(session: SessionRow): Promise<SessionRow> {
  let current = session;
  const now = new Date();
  const guard = current.questionCount + 2;

  for (let step = 0; step < guard; step += 1) {
    const transition = nextTransition(clockOf(current), now);
    if (transition.kind === "none") return current;

    if (transition.kind === "reveal") {
      const [updated] = await db
        .update(roomQuizSessions)
        .set({ status: "reveal", revealedAt: now })
        .where(
          and(
            eq(roomQuizSessions.id, current.id),
            eq(roomQuizSessions.status, "question"),
            eq(roomQuizSessions.currentIndex, current.currentIndex)
          )
        )
        .returning();
      if (!updated) return (await refetch(current.id)) ?? current;
      current = updated;
      continue;
    }

    if (transition.kind === "next") {
      const [updated] = await db
        .update(roomQuizSessions)
        .set({
          status: "question",
          currentIndex: transition.index,
          questionStartedAt: now,
          revealedAt: null,
        })
        .where(
          and(
            eq(roomQuizSessions.id, current.id),
            eq(roomQuizSessions.status, "reveal"),
            eq(roomQuizSessions.currentIndex, current.currentIndex)
          )
        )
        .returning();
      if (!updated) return (await refetch(current.id)) ?? current;
      current = updated;
      continue;
    }

    // end
    const [updated] = await db
      .update(roomQuizSessions)
      .set({ status: "ended", endedAt: now })
      .where(
        and(
          eq(roomQuizSessions.id, current.id),
          eq(roomQuizSessions.status, "reveal"),
          eq(roomQuizSessions.currentIndex, current.currentIndex)
        )
      )
      .returning();
    if (!updated) return (await refetch(current.id)) ?? current;
    current = updated;
    await finalizeSession(current);
    return current;
  }

  return current;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Host writes a quiz — from a topic or an uploaded file — and opens a waiting
 * room for it. Only the room's host (its owner) may start one, and the room
 * needs at least `MIN_LIVE_PLAYERS` members present — a solo "live" round is
 * just a quiz. The session is created in the `lobby` state; the host opens the
 * first question from there once everyone has pressed ready
 * (`startRoomLiveSession`). Any session the room already had is closed first, so
 * there is only ever one clock running.
 */
export async function startRoomLiveQuiz(input: {
  roomId: string;
  topic: string;
  count?: number;
  questionSeconds?: number;
  /** When set, the quiz is written from this shared room file instead. */
  fileId?: string | null;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(input.roomId, userId);
  if (!member) throw new Error("You are not a member of this room");
  if (member.role !== "owner") {
    throw new Error("Only the host can start the live quiz");
  }

  const [countRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(studyRoomMembers)
    .where(eq(studyRoomMembers.roomId, input.roomId));
  if ((countRow?.value ?? 0) < MIN_LIVE_PLAYERS) {
    throw new Error(
      `A live quiz needs at least ${MIN_LIVE_PLAYERS} members — share your join code and wait for a classmate to join`
    );
  }

  const topic = input.topic.trim();
  if (topic.length > 200) throw new Error("That topic is too long");
  // A file already names the subject, so a topic is only required without one.
  if (!input.fileId && topic.length < 3) {
    throw new Error("Give the live quiz a longer topic");
  }

  const requested = input.count ?? DEFAULT_QUESTIONS;
  const count = Math.min(Math.max(Math.round(requested), MIN_QUESTIONS), MAX_QUESTIONS);
  const questionSeconds = clampQuestionSeconds(input.questionSeconds);

  // The source file (if any) is read before the AI request so a missing file
  // fails fast rather than after spending quota.
  const source = input.fileId
    ? await readRoomFile(input.roomId, input.fileId)
    : null;
  if (input.fileId && !source) {
    throw new Error("That shared file is no longer available");
  }

  // Close whatever the room was running before spending an AI request.
  await db
    .update(roomQuizSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(
      and(eq(roomQuizSessions.roomId, input.roomId), ne(roomQuizSessions.status, "ended"))
    );

  const generated = source
    ? await generateQuizQuestionsFromFile({
        fileName: source.fileName,
        topic,
        count,
        mimeType: source.fileType,
        data: source.data,
      })
    : await generateQuizQuestions({ topic, count });

  // A room's shared material is the source of truth for its quizzes.
  const [room] = await db
    .select({ documentId: studyRooms.documentId })
    .from(studyRooms)
    .where(eq(studyRooms.id, input.roomId));

  const [quiz] = await db
    .insert(quizzes)
    .values({
      userId,
      title: generated.title,
      topic: source ? source.fileName : topic,
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
    .returning({ id: quizQuestions.id });

  const now = new Date();
  const [session] = await db
    .insert(roomQuizSessions)
    .values({
      roomId: input.roomId,
      quizId: quiz.id,
      hostId: userId,
      status: "lobby",
      questionCount: inserted.length,
      currentIndex: 0,
      questionSeconds,
      startedAt: now,
      questionStartedAt: now,
    })
    .returning();

  return { sessionId: session.id, quizId: quiz.id, title: generated.title };
}

/**
 * Host writes the room quiz by hand and opens a waiting room for it — the
 * manual counterpart to `startRoomLiveQuiz`. The same host and member-count
 * rules apply, and every question passes through the same validation the
 * builder used before it is stored.
 */
export async function startManualRoomLiveQuiz(input: {
  roomId: string;
  title?: string;
  questionSeconds?: number;
  questions: ManualQuestionDraft[];
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(input.roomId, userId);
  if (!member) throw new Error("You are not a member of this room");
  if (member.role !== "owner") {
    throw new Error("Only the host can start the live quiz");
  }

  const [countRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(studyRoomMembers)
    .where(eq(studyRoomMembers.roomId, input.roomId));
  if ((countRow?.value ?? 0) < MIN_LIVE_PLAYERS) {
    throw new Error(
      `A live quiz needs at least ${MIN_LIVE_PLAYERS} members — share your join code and wait for a classmate to join`
    );
  }

  // Incomplete drafts are dropped; the host is told if too few remain rather
  // than one blank question silently reaching the room.
  const questions = (input.questions ?? [])
    .map(normalizeManualQuestion)
    .filter((question): question is NormalizedManualQuestion => question !== null)
    .slice(0, MANUAL_LIMITS.max);

  if (questions.length < MANUAL_LIMITS.min) {
    throw new Error(`Write at least ${MANUAL_LIMITS.min} complete questions`);
  }

  // A key can go stale (cleared in the builder, or minted into another room's
  // folder). Starting anyway would silently swap the clip for the TTS voice, so
  // refuse instead and let the host drop it again.
  for (const question of questions) {
    if (
      question.audioFile &&
      !(await hasQuestionAudio(input.roomId, question.audioFile))
    ) {
      throw new Error(
        "One question's audio file is missing — drop it onto the question again"
      );
    }
  }

  const questionSeconds = clampQuestionSeconds(input.questionSeconds);
  const title = (input.title ?? "").trim().slice(0, 200) || "Room quiz";

  // Close whatever the room was running before opening the new one.
  await db
    .update(roomQuizSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(
      and(eq(roomQuizSessions.roomId, input.roomId), ne(roomQuizSessions.status, "ended"))
    );

  const [room] = await db
    .select({ documentId: studyRooms.documentId })
    .from(studyRooms)
    .where(eq(studyRooms.id, input.roomId));

  const [quiz] = await db
    .insert(quizzes)
    .values({
      userId,
      title,
      topic: "Written by the host",
      documentId: room?.documentId ?? null,
    })
    .returning();

  const inserted = await db
    .insert(quizQuestions)
    .values(
      questions.map((question, index) => ({
        quizId: quiz.id,
        question: question.question,
        type: question.type,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        audioFile: question.audioFile,
        order: index,
      }))
    )
    .returning({ id: quizQuestions.id });

  const now = new Date();
  const [session] = await db
    .insert(roomQuizSessions)
    .values({
      roomId: input.roomId,
      quizId: quiz.id,
      hostId: userId,
      status: "lobby",
      questionCount: inserted.length,
      currentIndex: 0,
      questionSeconds,
      startedAt: now,
      questionStartedAt: now,
    })
    .returning();

  return { sessionId: session.id, quizId: quiz.id, title };
}

/**
 * Host-only: run a quiz the room already has a second time. The stored questions
 * are reused instead of regenerated, so a group can practise the same material
 * more than once — the counterpart to starting a fresh quiz. A new waiting room
 * is opened, and any session still running is closed first.
 */
export async function replayRoomLiveQuiz(input: {
  roomId: string;
  /** Which quiz to repeat; defaults to the room's most recent one. */
  quizId?: string;
  questionSeconds?: number;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(input.roomId, userId);
  if (!member) throw new Error("You are not a member of this room");
  if (member.role !== "owner") {
    throw new Error("Only the host can start the live quiz");
  }

  const [countRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(studyRoomMembers)
    .where(eq(studyRoomMembers.roomId, input.roomId));
  if ((countRow?.value ?? 0) < MIN_LIVE_PLAYERS) {
    throw new Error(
      `A live quiz needs at least ${MIN_LIVE_PLAYERS} members — share your join code and wait for a classmate to join`
    );
  }

  const previous = await latestSession(input.roomId);
  const quizId = input.quizId ?? previous?.quizId ?? null;
  if (!quizId) throw new Error("There's no quiz in this room to repeat");

  const questions = await loadQuestions(quizId);
  if (questions.length === 0) {
    throw new Error("That quiz has no questions left to repeat");
  }

  const [quizRow] = await db
    .select({ title: quizzes.title })
    .from(quizzes)
    .where(eq(quizzes.id, quizId));
  if (!quizRow) throw new Error("That quiz is no longer available");

  // Close whatever is running, then open a fresh waiting room for the same quiz.
  await db
    .update(roomQuizSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(
      and(eq(roomQuizSessions.roomId, input.roomId), ne(roomQuizSessions.status, "ended"))
    );

  const questionSeconds = clampQuestionSeconds(
    input.questionSeconds ?? previous?.questionSeconds
  );
  const now = new Date();
  const [session] = await db
    .insert(roomQuizSessions)
    .values({
      roomId: input.roomId,
      quizId,
      hostId: userId,
      status: "lobby",
      questionCount: questions.length,
      currentIndex: 0,
      questionSeconds,
      startedAt: now,
      questionStartedAt: now,
    })
    .returning();

  return { sessionId: session.id, quizId, title: quizRow.title };
}

// ---------------------------------------------------------------------------
// Waiting room
// ---------------------------------------------------------------------------

/**
 * Members of a room plus who has pressed ready for this session.
 *
 * `includeReady` is false once the quiz is under way: the ready list only means
 * something in the lobby, and the live poll runs often, so skipping that query
 * during the question and reveal phases keeps each poll lighter.
 */
async function readinessFor(session: SessionRow, includeReady = true) {
  // The roster and the ready list don't depend on each other, so they run as
  // one batch: the waiting-room poll asks for both every second, per member.
  const membersPromise = db
    .select({
      userId: studyRoomMembers.userId,
      role: studyRoomMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(studyRoomMembers)
    .innerJoin(users, eq(users.id, studyRoomMembers.userId))
    .where(eq(studyRoomMembers.roomId, session.roomId));
  const readyPromise = includeReady
    ? db
        .select({ userId: roomQuizReady.userId })
        .from(roomQuizReady)
        .where(eq(roomQuizReady.sessionId, session.id))
    : Promise.resolve<{ userId: string }[]>([]);

  const [members, readyRows] = await Promise.all([membersPromise, readyPromise]);

  if (!includeReady) {
    return { memberCount: members.length, readyUserIds: [], allReady: false, members };
  }

  const readyUserIds = readyRows.map((row) => row.userId);
  // The host runs the start button, so only the other members have to ready up.
  const requiredUserIds = members
    .filter((row) => row.role !== "owner")
    .map((row) => row.userId);
  const allReady =
    requiredUserIds.length > 0 &&
    requiredUserIds.every((id) => readyUserIds.includes(id));

  return { memberCount: members.length, readyUserIds, allReady, members };
}

/** A member toggles their "ready" for the room's current waiting room. */
export async function markRoomReady(input: { roomId: string; ready: boolean }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  // The membership check and the session read are independent of each other, so
  // "I'm ready" costs one round trip instead of two.
  const [member, session] = await Promise.all([
    membershipFor(input.roomId, userId),
    latestSession(input.roomId),
  ]);
  if (!member) throw new Error("You are not a member of this room");
  if (!session || session.status !== "lobby") {
    throw new Error("No live quiz is waiting to start");
  }

  if (input.ready) {
    await db
      .insert(roomQuizReady)
      .values({ sessionId: session.id, userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(roomQuizReady)
      .where(
        and(
          eq(roomQuizReady.sessionId, session.id),
          eq(roomQuizReady.userId, userId)
        )
      );
  }

  return { ready: input.ready };
}

/**
 * Host-only: leave the waiting room and open the first question. Refuses until
 * every other member has pressed ready, which is the whole point of the lobby.
 */
export async function startRoomLiveSession(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const session = await latestSession(roomId);
  if (!session) throw new Error("No live quiz in this room");
  if (session.hostId !== userId) {
    throw new Error("Only the host can start the live quiz");
  }
  if (session.status !== "lobby") return;

  const readiness = await readinessFor(session);
  if (readiness.memberCount < MIN_LIVE_PLAYERS) {
    throw new Error(
      `A live quiz needs at least ${MIN_LIVE_PLAYERS} members — share your join code and wait for a classmate to join`
    );
  }
  if (!readiness.allReady) {
    throw new Error("Everyone has to press ready before the quiz can start");
  }

  const now = new Date();
  const [updated] = await db
    .update(roomQuizSessions)
    .set({
      status: "question",
      currentIndex: 0,
      questionStartedAt: now,
      revealedAt: null,
      startedAt: now,
    })
    .where(
      and(
        eq(roomQuizSessions.id, session.id),
        eq(roomQuizSessions.status, "lobby")
      )
    )
    .returning();

  // The ready list has done its job; clear it so a later round starts fresh.
  if (updated) {
    await db
      .delete(roomQuizReady)
      .where(eq(roomQuizReady.sessionId, session.id));
  }
}

// ---------------------------------------------------------------------------
// Read (the poll)
// ---------------------------------------------------------------------------

/** Everything the live surface needs, resolved against the current clock. */
export async function getRoomLiveState(roomId: string): Promise<RoomLiveState | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const userId = await requireUserId(clerkId);

  // Identity resolution is the only serial step; the roster check and the
  // session read don't depend on each other, so they share a round trip.
  const [member, existing] = await Promise.all([
    membershipFor(roomId, userId),
    latestSession(roomId),
  ]);
  if (!member) return null;
  if (!existing) return null;

  const session = await syncSession(existing);

  // The lobby hasn't opened a question yet, so nothing should be on screen —
  // and neither the questions nor the answers are worth reading while it waits.
  const isLobby = session.status === "lobby";
  const revealed = session.status === "reveal" || session.status === "ended";

  // Everything after the session is independent, so it goes out as one batch:
  // a waiting-room poll is one membership lookup, one session read and this.
  const [questions, [quizRow], responseRows, readiness] = await Promise.all([
    isLobby ? Promise.resolve<QuestionRows>([]) : loadQuestions(session.quizId),
    db
      .select({ title: quizzes.title })
      .from(quizzes)
      .where(eq(quizzes.id, session.quizId)),
    isLobby ? Promise.resolve<ResponseRows>([]) : loadResponses(session.id),
    readinessFor(session, isLobby),
  ]);

  const question = isLobby ? null : questions[session.currentIndex] ?? null;

  const currentResponses = responseRows.filter(
    (row) => row.questionIndex === session.currentIndex
  );
  const mine = currentResponses.find((row) => row.userId === userId) ?? null;

  const totals = new Map<
    string,
    { userId: string; name: string | null; email: string; correct: number; answered: number; totalMs: number }
  >();
  for (const row of responseRows) {
    const entry = totals.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      email: row.email,
      correct: 0,
      answered: 0,
      totalMs: 0,
    };
    entry.answered += 1;
    if (row.isCorrect) entry.correct += 1;
    entry.totalMs += row.responseMs ?? 0;
    totals.set(row.userId, entry);
  }

  const now = new Date();

  return {
    session: {
      id: session.id,
      roomId: session.roomId,
      quizId: session.quizId,
      hostId: session.hostId,
      status: session.status,
      currentIndex: session.currentIndex,
      questionCount: session.questionCount,
      questionSeconds: session.questionSeconds,
      questionStartedAtMs: session.questionStartedAt.getTime(),
      serverNowMs: now.getTime(),
    },
    title: quizRow?.title ?? "Live quiz",
    question: question
      ? {
          id: question.id,
          question: question.question,
          type: question.type,
          options: question.options,
          order: question.order,
          correctAnswer: revealed ? question.correctAnswer : null,
          explanation: revealed ? question.explanation : null,
          audioUrl: question.audioFile
            ? `/api/rooms/${session.roomId}/quiz-audio/${question.audioFile}`
            : null,
        }
      : null,
    revealed,
    remainingMs: remainingMs(clockOf(session), now),
    answeredCount: currentResponses.length,
    memberCount: readiness.memberCount,
    readyUserIds: readiness.readyUserIds,
    myReady: readiness.readyUserIds.includes(userId),
    allReady: readiness.allReady,
    members: readiness.members,
    myAnswer: mine?.answer ?? null,
    myCorrect: revealed ? mine?.isCorrect ?? null : null,
    responses: revealed
      ? currentResponses.map((row) => ({
          userId: row.userId,
          name: row.name,
          email: row.email,
          answer: row.answer,
          isCorrect: row.isCorrect,
        }))
      : [],
    board: rankLiveScores([...totals.values()]),
    isHost: session.hostId === userId,
    viewerId: userId,
  };
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

/**
 * Record one player's spoken answer. The server grades it (never trusting the
 * client's verdict) and refuses anything arriving after the question has closed,
 * so a late answer can't be squeezed in under the wire.
 */
export async function submitRoomLiveAnswer(input: {
  roomId: string;
  questionIndex: number;
  answer: string;
  responseMs?: number;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(input.roomId, userId);
  if (!member) throw new Error("You are not a member of this room");

  const session = await latestSession(input.roomId);
  if (!session || session.status === "ended") {
    return { accepted: false as const, isCorrect: false };
  }
  if (session.currentIndex !== input.questionIndex || session.status !== "question") {
    return { accepted: false as const, isCorrect: false };
  }

  const [question] = await db
    .select({
      id: quizQuestions.id,
      type: quizQuestions.type,
      correctAnswer: quizQuestions.correctAnswer,
    })
    .from(quizQuestions)
    .where(
      and(
        eq(quizQuestions.quizId, session.quizId),
        eq(quizQuestions.order, input.questionIndex)
      )
    );

  if (!question) return { accepted: false as const, isCorrect: false };

  const answer = input.answer.trim().slice(0, 500);
  if (!answer) return { accepted: false as const, isCorrect: false };

  const isCorrect = isAnswerCorrect(question.type, question.correctAnswer, answer);

  await db
    .insert(roomQuizResponses)
    .values({
      sessionId: session.id,
      questionIndex: input.questionIndex,
      userId,
      answer,
      isCorrect,
      responseMs:
        input.responseMs !== undefined && Number.isFinite(input.responseMs)
          ? Math.min(Math.max(Math.round(input.responseMs), 0), 600_000)
          : null,
    })
    .onConflictDoUpdate({
      target: [
        roomQuizResponses.sessionId,
        roomQuizResponses.questionIndex,
        roomQuizResponses.userId,
      ],
      set: {
        answer: sql`excluded.answer`,
        isCorrect: sql`excluded.is_correct`,
        responseMs: sql`excluded.response_ms`,
      },
    });

  return { accepted: true as const, isCorrect };
}

// ---------------------------------------------------------------------------
// Host controls
// ---------------------------------------------------------------------------

/** Host-only: close the current question now instead of waiting out the clock. */
export async function revealRoomLiveQuestion(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const session = await latestSession(roomId);
  if (!session) throw new Error("No live quiz in this room");
  if (session.hostId !== userId) throw new Error("Only the host can reveal the answer");
  if (session.status !== "question") return;

  await db
    .update(roomQuizSessions)
    .set({ status: "reveal", revealedAt: new Date() })
    .where(
      and(
        eq(roomQuizSessions.id, session.id),
        eq(roomQuizSessions.status, "question")
      )
    );
}

/** Host-only: move past the reveal, to the next question or the final results. */
export async function nextRoomLiveQuestion(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const session = await latestSession(roomId);
  if (!session) throw new Error("No live quiz in this room");
  if (session.hostId !== userId) throw new Error("Only the host can advance the quiz");
  // The lobby advances through `startRoomLiveSession`, not by skipping questions.
  if (session.status === "ended" || session.status === "lobby") return;

  const now = new Date();

  if (session.status === "question") {
    // The host skipped ahead: close the question first, then advance next time.
    const [updated] = await db
      .update(roomQuizSessions)
      .set({ status: "reveal", revealedAt: now })
      .where(
        and(
          eq(roomQuizSessions.id, session.id),
          eq(roomQuizSessions.status, "question")
        )
      )
      .returning();
    if (!updated) return;
    return;
  }

  const nextIndex = session.currentIndex + 1;
  if (nextIndex >= session.questionCount) {
    const [ended] = await db
      .update(roomQuizSessions)
      .set({ status: "ended", endedAt: now })
      .where(
        and(eq(roomQuizSessions.id, session.id), eq(roomQuizSessions.status, "reveal"))
      )
      .returning();
    if (ended) await finalizeSession(ended);
    return;
  }

  await db
    .update(roomQuizSessions)
    .set({
      status: "question",
      currentIndex: nextIndex,
      questionStartedAt: now,
      revealedAt: null,
    })
    .where(
      and(
        eq(roomQuizSessions.id, session.id),
        eq(roomQuizSessions.status, "reveal"),
        eq(roomQuizSessions.currentIndex, session.currentIndex)
      )
    );
}

/** Host-only: stop the quiz and post everyone's results to the room board. */
export async function endRoomLiveSession(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const session = await latestSession(roomId);
  if (!session) return;
  if (session.hostId !== userId) throw new Error("Only the host can end the live quiz");
  if (session.status === "ended") return;

  const [ended] = await db
    .update(roomQuizSessions)
    .set({ status: "ended", endedAt: new Date() })
    .where(
      and(eq(roomQuizSessions.id, session.id), ne(roomQuizSessions.status, "ended"))
    )
    .returning();
  if (ended) await finalizeSession(ended);
}

// ---------------------------------------------------------------------------
// Leaderboard (many rounds)
// ---------------------------------------------------------------------------

export type RoomLiveStandingRow = {
  userId: string;
  name: string | null;
  email: string;
  correct: number;
  answered: number;
  /** How many live rounds this student has played in the room. */
  rounds: number;
  totalMs: number;
  accuracy: number;
  avgMs: number | null;
  rank: number;
};

/**
 * The room's live-voice-quiz leaderboard: every answer ever spoken in a live
 * round of this room, aggregated per student and ranked accuracy-first (so one
 * sharp round beats grinding out many sloppy ones), then on correct answers
 * and speed. In-progress rounds count too, so the board moves while a quiz is
 * being played.
 */
export async function getRoomLiveLeaderboard(
  roomId: string
): Promise<RoomLiveStandingRow[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(roomId, userId);
  if (!member) return [];

  const rows = await db
    .select({
      userId: roomQuizResponses.userId,
      name: users.name,
      email: users.email,
      correct: sql<number>`coalesce(sum(case when ${roomQuizResponses.isCorrect} then 1 else 0 end), 0)::int`,
      answered: sql<number>`count(${roomQuizResponses.id})::int`,
      rounds: sql<number>`count(distinct ${roomQuizResponses.sessionId})::int`,
      totalMs: sql<number>`coalesce(sum(${roomQuizResponses.responseMs}), 0)::int`,
    })
    .from(roomQuizResponses)
    .innerJoin(
      roomQuizSessions,
      eq(roomQuizSessions.id, roomQuizResponses.sessionId)
    )
    .innerJoin(users, eq(users.id, roomQuizResponses.userId))
    .where(eq(roomQuizSessions.roomId, roomId))
    .groupBy(roomQuizResponses.userId, users.name, users.email);

  return rankLiveStandings(rows);
}

// ---------------------------------------------------------------------------
// Past rounds (the history page)
// ---------------------------------------------------------------------------

export type RoomLiveRound = {
  sessionId: string;
  /** The quiz behind the round — replayed from the history page. */
  quizId: string;
  title: string;
  questionCount: number;
  startedAt: Date;
  endedAt: Date | null;
  players: {
    userId: string;
    name: string | null;
    email: string;
    correct: number;
    answered: number;
  }[];
};

/**
 * Every finished live round in the room, newest first, with each player's score
 * for that round — the round-by-round history behind the aggregate leaderboard.
 */
export async function getRoomLiveHistory(
  roomId: string,
  limit = 20
): Promise<RoomLiveRound[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(roomId, userId);
  if (!member) return [];

  const sessions = await db
    .select({
      id: roomQuizSessions.id,
      quizId: roomQuizSessions.quizId,
      title: quizzes.title,
      questionCount: roomQuizSessions.questionCount,
      startedAt: roomQuizSessions.startedAt,
      endedAt: roomQuizSessions.endedAt,
    })
    .from(roomQuizSessions)
    .innerJoin(quizzes, eq(quizzes.id, roomQuizSessions.quizId))
    .where(
      and(
        eq(roomQuizSessions.roomId, roomId),
        eq(roomQuizSessions.status, "ended")
      )
    )
    .orderBy(desc(roomQuizSessions.endedAt))
    .limit(limit);

  if (sessions.length === 0) return [];

  const players = await db
    .select({
      sessionId: roomQuizResponses.sessionId,
      userId: roomQuizResponses.userId,
      name: users.name,
      email: users.email,
      correct: sql<number>`coalesce(sum(case when ${roomQuizResponses.isCorrect} then 1 else 0 end), 0)::int`,
      answered: sql<number>`count(${roomQuizResponses.id})::int`,
    })
    .from(roomQuizResponses)
    .innerJoin(users, eq(users.id, roomQuizResponses.userId))
    .where(
      inArray(
        roomQuizResponses.sessionId,
        sessions.map((session) => session.id)
      )
    )
    .groupBy(
      roomQuizResponses.sessionId,
      roomQuizResponses.userId,
      users.name,
      users.email
    );

  return sessions.map((session) => ({
    sessionId: session.id,
    quizId: session.quizId,
    title: session.title,
    questionCount: session.questionCount,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    players: players
      .filter((row) => row.sessionId === session.id)
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        correct: row.correct,
        answered: row.answered,
      }))
      .sort((a, b) => b.correct - a.correct),
  }));
}
