"use server";

import { and, eq, sql } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { tasks, users } from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import { parseTaskInput, type TaskSource } from "../lib/parse";
import { normalizePhMobile } from "../lib/phone";

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
// Reminder number (SMS notifications)
//
// One number per student, kept on the `users` row. The reminder text itself is
// sent by the PHP cron in sms/, which reads the number through
// app/api/tasks/reminders — see sms/README.md.
// ---------------------------------------------------------------------------

/** The number reminders currently go to, or null when the student opted out. */
export async function getReminderPhone() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const userId = await requireUserId(clerkId);

  const [row] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.phoneNumber ?? null;
}

/**
 * Save the mobile number that due-date reminders are texted to. The number is
 * normalised to E.164 and rejected unless it is a Philippine mobile number, so
 * nothing that cannot receive a text is ever stored.
 */
export async function saveReminderPhone(input: { phoneNumber: string }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const phoneNumber = normalizePhMobile(input.phoneNumber ?? "");
  if (!phoneNumber) {
    throw new Error(
      "Use a Philippine mobile number — for example 0917 123 4567."
    );
  }

  const [updated] = await db
    .update(users)
    .set({ phoneNumber, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ phoneNumber: users.phoneNumber });

  return updated?.phoneNumber ?? null;
}

/**
 * The line the test button sends. It is deliberately fixed and short: the point
 * is to prove the gateway, the SIM, and the saved number work, not to deliver
 * homework. One GSM-7 segment, so a test never costs more than one text.
 */
const TEST_SMS_MESSAGE =
  "EduVoice test: your task reminders will arrive like this.";

/** The gateway's cloud API normally answers in under two seconds. */
const SMS_TIMEOUT_MS = 20_000;

/** Where the sms folder is served in a local checkout (see sms/README.md). */
const DEFAULT_SMS_SEND_URL = "http://127.0.0.1:8081/send.php";

/** How to start the PHP endpoint, shown whenever it is unreachable. */
const SMS_START_HINT =
  "Start it with:  php -S 127.0.0.1:8081 -t sms sms/serve.php   (from the project root)";

export type TestSmsResult =
  | {
      ok: true;
      /** E.164 number the text went to. */
      number: string;
      gatewayId: string | null;
      state: string | null;
      segments: number;
      /** Set when the phone still has to collect the message. */
      note: string | null;
    }
  | {
      ok: false;
      /** Machine-readable cause, when one is known. */
      code: string | null;
      error: string;
      /** One line telling the student what to do about it. */
      hint: string | null;
    };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Readable text from whatever a wrong URL answered. Pointing SMS_SEND_URL at
 * anything else — the app itself, Apache, another service — comes back as an
 * HTML error page, and pasting that into the UI would be noise, so tags and
 * scripts are stripped before it is shown.
 */
function plainSnippet(text: string, limit = 160): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * Send one test text to the student's saved number, through the same gateway the
 * reminders use.
 *
 * The app does not talk to the gateway at all: it posts to `sms/send.php` (see
 * sms/README.md), which owns the PHP client and the credentials. This action
 * exists to turn every way that can fail into a sentence the student can act on
 * — no number saved, endpoint not configured, endpoint not running, wrong token,
 * gateway refused, phone offline — and it never throws, so the button can always
 * show what happened.
 */
export async function sendTestSms(): Promise<TestSmsResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { ok: false, code: "not_authenticated", error: "Please sign in again.", hint: null };
  }
  const userId = await requireUserId(clerkId);

  const [row] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const number = row?.phoneNumber ?? null;
  if (!number) {
    return {
      ok: false,
      code: "no_number",
      error: "Save your mobile number first — the test text goes to it.",
      hint: "Type the number above and press Save number, then try again.",
    };
  }

  const token = process.env.TASK_REMINDER_TOKEN;
  if (!token) {
    return {
      ok: false,
      code: "token_not_configured",
      error: "TASK_REMINDER_TOKEN is not set in the app's .env.",
      hint: "Generate one and use the same value in .env and sms/.env (see .env.example).",
    };
  }

  const endpoint = (process.env.SMS_SEND_URL ?? DEFAULT_SMS_SEND_URL).trim();

  let response: Response;
  let body: string;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ number, message: TEST_SMS_MESSAGE }),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
      cache: "no-store",
    });
    body = await response.text();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      code: timedOut ? "timeout" : "unreachable",
      error: timedOut
        ? `The SMS service at ${endpoint} did not answer within ${SMS_TIMEOUT_MS / 1000} seconds.`
        : `Could not reach the SMS service at ${endpoint}.`,
      hint: SMS_START_HINT,
    };
  }

  // The endpoint always answers with JSON, but a wrong URL can land on any other
  // server, so the body is checked before it is trusted.
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(body);
    payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!payload) {
    return {
      ok: false,
      code: "bad_response",
      error: `${endpoint} answered ${response.status} with something that is not JSON.`,
      hint: plainSnippet(body) || SMS_START_HINT,
    };
  }

  if (!response.ok || payload.ok !== true) {
    return {
      ok: false,
      code: asString(payload.code),
      error: asString(payload.error) ?? `The SMS service answered ${response.status}.`,
      hint: asString(payload.hint),
    };
  }

  const state = asString(payload.state);

  // The gateway accepted the message, but its own report can still say the phone
  // failed to send it (no SIM, no signal, no load).
  if (state?.toLowerCase() === "failed") {
    return {
      ok: false,
      code: "gateway_failed",
      error: "Your phone could not send the text (the gateway reports it as failed).",
      hint: "Open the SMS Gateway app and check the SIM, signal, and load, then try again.",
    };
  }

  const settled = state !== null && ["sent", "delivered"].includes(state.toLowerCase());

  return {
    ok: true,
    number,
    gatewayId: asString(payload.id),
    state,
    segments: typeof payload.segments === "number" ? payload.segments : 1,
    note: settled
      ? null
      : `Queued on the gateway${state ? ` (state: ${state})` : ""} — the text leaves your phone once the SMS Gateway app is online.`,
  };
}

/** Stop texting: clear the number. Tasks already texted keep their history. */
export async function clearReminderPhone() {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  await db
    .update(users)
    .set({ phoneNumber: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
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
    remindedAt?: Date | null;
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
    // A moved deadline is a new one: re-arm the reminder text so the student is
    // told when it now comes due, instead of the old date's message standing in
    // as "already told them".
    patch.remindedAt = null;
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
