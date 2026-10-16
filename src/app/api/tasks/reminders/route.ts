import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, users } from "@/lib/db/schema";
import { taskReminderBody } from "@/features/tasks/lib/reminderMessage";

// Queue endpoint for the task reminder texts.
//
// The sending lives in PHP (sms/notify.php) because the student's SMS gateway —
// the SMS Gateway for Android app on their phone — only has a PHP client, and
// that cron has no database access of its own. This route is the hand-off:
//
//   GET  → the tasks that have just come due and still need a text, with the
//          message body already composed.
//   POST → "these were handed to the gateway", so they are never texted twice.
//
// The two calls are deliberately separate: a send that fails (phone offline,
// gateway out of credits) leaves the task unacknowledged, so the next run picks
// it up again instead of losing the reminder.
//
// It is called by a cron job, not by a signed-in student, so it authenticates
// with a shared secret (TASK_REMINDER_TOKEN) instead of a Clerk session.

export const dynamic = "force-dynamic";

/**
 * How long after its due moment a task is still worth a text. A notifier that
 * was off for a day should not text a backlog of stale deadlines, so anything
 * older than this is left alone.
 */
const REMINDER_GRACE_MS = 24 * 60 * 60 * 1_000;

/** One run's worth, so a long outage can't produce a burst of hundreds of SMS. */
const BATCH_LIMIT = 50;

const MAX_ACK_IDS = 200;

/** Constant-time comparison, so the token can't be guessed a character at a time. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const expected = process.env.TASK_REMINDER_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  if (!provided) return false;

  return tokenMatches(provided, expected);
}

/** Minutes behind UTC, exactly as `new Date().getTimezoneOffset()` reports it. */
function tzOffsetFrom(request: Request): number {
  const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= 14 * 60
    ? Math.trunc(value)
    : 0;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tzOffsetMinutes = tzOffsetFrom(request);
  const now = new Date();

  const rows = await db
    .select({
      taskId: tasks.id,
      userId: tasks.userId,
      title: tasks.title,
      dueDate: tasks.dueDate,
      name: users.name,
      phoneNumber: users.phoneNumber,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.userId))
    .where(
      and(
        eq(tasks.completed, false),
        isNull(tasks.remindedAt),
        isNotNull(tasks.dueDate),
        isNotNull(users.phoneNumber),
        lte(tasks.dueDate, now),
        gt(tasks.dueDate, new Date(now.getTime() - REMINDER_GRACE_MS))
      )
    )
    .orderBy(asc(tasks.dueDate))
    .limit(BATCH_LIMIT);

  return NextResponse.json({
    now: now.toISOString(),
    // The gateway texts one number per message, so every row carries its own
    // recipient and a finished body.
    reminders: rows.map((row) => ({
      taskId: row.taskId,
      userId: row.userId,
      name: row.name,
      phone: row.phoneNumber,
      title: row.title,
      dueDate: row.dueDate?.toISOString() ?? null,
      message: taskReminderBody(
        { title: row.title, dueDate: row.dueDate as Date },
        tzOffsetMinutes
      ),
    })),
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { taskIds?: unknown };
  try {
    body = (await request.json()) as { taskIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, MAX_ACK_IDS)
    : [];
  if (taskIds.length === 0) {
    return NextResponse.json({ acknowledged: 0 });
  }

  const acknowledged = await db
    .update(tasks)
    .set({ remindedAt: new Date() })
    .where(and(inArray(tasks.id, taskIds), isNull(tasks.remindedAt)))
    .returning({ id: tasks.id });

  return NextResponse.json({ acknowledged: acknowledged.length });
}
