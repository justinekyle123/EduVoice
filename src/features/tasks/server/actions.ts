"use server";

import { and, eq, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import { parseTaskInput, type TaskSource } from "../lib/parse";

// Same Clerk → Postgres user resolution the chat, quiz, and rooms features use:
// the task tables key rows by `users.id` (uuid), but `auth()` hands back the
// Clerk id, so resolve it and create the row on demand if the webhook hasn't
// synced the account yet.
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

const MAX_TITLE = 200;
const MAX_CAPTURE = 300;
const MAX_DESCRIPTION = 500;

/** Open tasks first, then by due date (undated last), then newest. */
const LIST_ORDER = sql`
  ${tasks.completed} asc,
  ${tasks.dueDate} asc nulls last,
  ${tasks.createdAt} desc
`;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Everything the signed-in student has captured, ready to split open/done. */
export async function getTasks() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  return db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(LIST_ORDER)
    .limit(200);
}

// ---------------------------------------------------------------------------
// Capture (feature 6.9)
// ---------------------------------------------------------------------------

/**
 * Capture one dictated or typed line: the SYSTEM lane extracts the title and
 * due date, then the row is saved with where it came from (`voice` | `text`).
 *
 * The caller's timezone offset travels with the request so "tomorrow at 5pm"
 * resolves against the student's clock rather than the server's.
 */
export async function createTask(input: {
  text: string;
  source: TaskSource;
  tzOffsetMinutes?: number;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Say or type the task you want to remember");
  if (text.length > MAX_CAPTURE) throw new Error("That task is too long");

  const parsed = parseTaskInput(text, {
    tzOffsetMinutes: input.tzOffsetMinutes,
  });

  const [task] = await db
    .insert(tasks)
    .values({
      userId,
      title: parsed.title.slice(0, MAX_TITLE),
      dueDate: parsed.dueDate,
      source: input.source === "voice" ? "voice" : "text",
    })
    .returning();

  return { task, parsed };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Tick a task off, or put it back on the list. */
export async function setTaskCompleted(input: {
  id: string;
  completed: boolean;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [updated] = await db
    .update(tasks)
    .set({ completed: input.completed, updatedAt: new Date() })
    .where(and(eq(tasks.id, input.id), eq(tasks.userId, userId)))
    .returning();

  return updated ?? null;
}

/**
 * Fix a capture — speech recognition mishears things, so an edited title or a
 * corrected due date has to be possible. `dueDate` is an ISO string, or null to
 * clear it.
 */
export async function updateTask(input: {
  id: string;
  title?: string;
  dueDate?: string | null;
  description?: string | null;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const patch: {
    updatedAt: Date;
    title?: string;
    dueDate?: Date | null;
    description?: string | null;
  } = { updatedAt: new Date() };

  if (input.title !== undefined) {
    const title = input.title.replace(/\s+/g, " ").trim();
    if (!title) throw new Error("A task needs a title");
    patch.title = title.slice(0, MAX_TITLE);
  }

  if (input.dueDate !== undefined) {
    if (input.dueDate === null) {
      patch.dueDate = null;
    } else {
      const due = new Date(input.dueDate);
      if (Number.isNaN(due.getTime())) throw new Error("That due date is invalid");
      patch.dueDate = due;
    }
  }

  if (input.description !== undefined) {
    const description = input.description?.trim() ?? null;
    if (description && description.length > MAX_DESCRIPTION) {
      throw new Error("That note is too long");
    }
    patch.description = description || null;
  }

  const [updated] = await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.id, input.id), eq(tasks.userId, userId)))
    .returning();

  return updated ?? null;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteTask(id: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  await db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
}

/** Clear the done column in one go, so the list stays a working surface. */
export async function clearCompletedTasks() {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const cleared = await db
    .delete(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.completed, true)))
    .returning({ id: tasks.id });

  return cleared.length;
}
