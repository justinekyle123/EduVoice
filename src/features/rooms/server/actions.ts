"use server";

import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  quizAttempts,
  roomMessages,
  studyRoomMembers,
  studyRooms,
  users,
} from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import { membershipFor } from "./membership";

// Same pattern as the chat actions: the room tables key rows by the Postgres
// `users.id` (uuid), but Clerk's `auth()` returns the Clerk user id
// (e.g. "user_…"), so resolve it — creating the row on demand if the Clerk
// webhook hasn't synced the user yet.
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

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

// Ambiguous characters (O/0, I/1) are left out so codes survive being read
// aloud or copied off a whiteboard.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateJoinCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** A unique-enough code, retried a few times against the UNIQUE constraint. */
async function uniqueJoinCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const [existing] = await db
      .select({ id: studyRooms.id })
      .from(studyRooms)
      .where(eq(studyRooms.joinCode, code));
    if (!existing) return code;
  }
  throw new Error("Could not generate a join code — please try again");
}

// ---------------------------------------------------------------------------
// Room list / create / join
// ---------------------------------------------------------------------------

/** Rooms the signed-in user belongs to, newest activity first. */
export async function getMyRooms() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const rooms = await db
    .select({
      id: studyRooms.id,
      name: studyRooms.name,
      joinCode: studyRooms.joinCode,
      ownerId: studyRooms.ownerId,
      documentId: studyRooms.documentId,
      createdAt: studyRooms.createdAt,
      role: studyRoomMembers.role,
      memberCount: sql<number>`(
        select count(*)::int from ${studyRoomMembers} m
        where m.room_id = ${studyRooms.id}
      )`,
      lastMessageAt: sql<Date | null>`(
        select max(${roomMessages.createdAt}) from ${roomMessages}
        where ${roomMessages.roomId} = ${studyRooms.id}
      )`,
    })
    .from(studyRoomMembers)
    .innerJoin(studyRooms, eq(studyRooms.id, studyRoomMembers.roomId))
    .where(eq(studyRoomMembers.userId, userId))
    .orderBy(desc(studyRooms.createdAt));

  return rooms;
}

/** Create a room and enroll the creator as its owner. */
export async function createStudyRoom(input: { name: string }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const name = input.name.trim();
  if (!name) throw new Error("Room name cannot be empty");
  if (name.length > 80) throw new Error("Room name is too long");

  const [room] = await db
    .insert(studyRooms)
    .values({
      name,
      joinCode: await uniqueJoinCode(),
      ownerId: userId,
    })
    .returning();

  await db
    .insert(studyRoomMembers)
    .values({ roomId: room.id, userId, role: "owner" });

  return room;
}

/**
 * Join a room by its shareable code. Re-joining is harmless — the membership
 * table's UNIQUE (room_id, user_id) makes this idempotent.
 */
export async function joinStudyRoom(code: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) throw new Error("Enter a join code");

  const [room] = await db
    .select()
    .from(studyRooms)
    .where(eq(studyRooms.joinCode, normalized));

  if (!room) throw new Error("No study room matches that code");

  await db
    .insert(studyRoomMembers)
    .values({ roomId: room.id, userId, role: "member" })
    .onConflictDoNothing();

  return room;
}

export async function leaveStudyRoom(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(roomId, userId);
  if (!member) return;
  if (member.role === "owner") {
    throw new Error("Owners must delete the room instead of leaving it");
  }

  await db
    .delete(studyRoomMembers)
    .where(
      and(
        eq(studyRoomMembers.roomId, roomId),
        eq(studyRoomMembers.userId, userId)
      )
    );
}

/** Owner-only delete. Members, messages, and the room's attempts cascade or unlink. */
export async function deleteStudyRoom(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [room] = await db
    .select({ ownerId: studyRooms.ownerId })
    .from(studyRooms)
    .where(eq(studyRooms.id, roomId));

  if (!room) return;
  if (room.ownerId !== userId) throw new Error("Only the owner can delete this room");

  await db.delete(studyRooms).where(eq(studyRooms.id, roomId));
}

// ---------------------------------------------------------------------------
// Room state (members + shared leaderboard)
// ---------------------------------------------------------------------------

/**
 * Members and the shared leaderboard — the slow-moving half of the room, so
 * the client can refresh it less often than the chat.
 *
 * The leaderboard ranks completed `quiz_attempts` that carry this room's
 * `room_id` (schema feature 6.13): accuracy first, then total points, so a
 * single 10/10 beats grinding out three 4/10s.
 */
export async function getRoomState(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(roomId, userId);
  if (!member) return null;

  const [room] = await db
    .select({
      id: studyRooms.id,
      name: studyRooms.name,
      joinCode: studyRooms.joinCode,
      ownerId: studyRooms.ownerId,
      documentId: studyRooms.documentId,
      createdAt: studyRooms.createdAt,
    })
    .from(studyRooms)
    .where(eq(studyRooms.id, roomId));

  if (!room) return null;

  const members = await db
    .select({
      id: studyRoomMembers.id,
      userId: studyRoomMembers.userId,
      role: studyRoomMembers.role,
      joinedAt: studyRoomMembers.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(studyRoomMembers)
    .innerJoin(users, eq(users.id, studyRoomMembers.userId))
    .where(eq(studyRoomMembers.roomId, roomId))
    .orderBy(asc(studyRoomMembers.joinedAt));

  const totals = await db
    .select({
      userId: quizAttempts.userId,
      name: users.name,
      email: users.email,
      attempts: sql<number>`count(*)::int`,
      points: sql<number>`coalesce(sum(${quizAttempts.score}), 0)::int`,
      answered: sql<number>`coalesce(sum(${quizAttempts.totalQuestions}), 0)::int`,
      best: sql<number>`coalesce(max(${quizAttempts.score}), 0)::int`,
    })
    .from(quizAttempts)
    .innerJoin(users, eq(users.id, quizAttempts.userId))
    .where(
      and(
        eq(quizAttempts.roomId, roomId),
        isNotNull(quizAttempts.completedAt)
      )
    )
    .groupBy(quizAttempts.userId, users.name, users.email);

  const leaderboard = totals
    .map((row) => ({
      ...row,
      accuracy: row.answered > 0 ? row.points / row.answered : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy || b.points - a.points)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    room,
    members,
    leaderboard,
    myRole: member.role,
    viewerId: userId,
    // Members who have not finished a quiz yet still belong on the board.
    idleMembers: members.filter(
      (m) => !leaderboard.some((entry) => entry.userId === m.userId)
    ),
  };
}

// ---------------------------------------------------------------------------
// Room chat
// ---------------------------------------------------------------------------

/** Messages in a room, optionally only those newer than `since` (ISO string). */
export async function getRoomMessages(roomId: string, since?: string | null) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const member = await membershipFor(roomId, userId);
  if (!member) return [];

  const sinceDate = since ? new Date(since) : null;
  const validSince = sinceDate && !Number.isNaN(sinceDate.getTime());

  return db
    .select({
      id: roomMessages.id,
      userId: roomMessages.userId,
      content: roomMessages.content,
      createdAt: roomMessages.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(roomMessages)
    .innerJoin(users, eq(users.id, roomMessages.userId))
    .where(
      validSince
        ? and(eq(roomMessages.roomId, roomId), gt(roomMessages.createdAt, sinceDate))
        : eq(roomMessages.roomId, roomId)
    )
    .orderBy(asc(roomMessages.createdAt))
    .limit(200);
}

/** Post a message as the signed-in member. */
export async function sendRoomMessage(input: { roomId: string; content: string }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const content = input.content.trim();
  if (!content) throw new Error("Message cannot be empty");
  if (content.length > 2000) throw new Error("Message is too long");

  const member = await membershipFor(input.roomId, userId);
  if (!member) throw new Error("You are not a member of this room");

  const [message] = await db
    .insert(roomMessages)
    .values({ roomId: input.roomId, userId, content })
    .returning();

  return message;
}
