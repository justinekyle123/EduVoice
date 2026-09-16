import { and, asc, eq } from "drizzle-orm";
import type { Content } from "@google/genai";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import {
  detectLanguage,
  detectTone,
  type DetectedLanguage,
} from "../lib/detect";
import type { ChatMode } from "../lib/modes";
import type { Provider } from "@/lib/ai";

// Shared turn plumbing for chat. Two entry points write messages — the
// sendChatMessage server action (typing) and the streaming voice route
// (app/api/chat/voice) — and both must persist a turn the same way, or a voice
// session would drift out of sync with the same thread read as text.

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;

/**
 * The chat tables key rows by the Postgres `users.id` (uuid), but Clerk's
 * `auth()` returns the Clerk user id (e.g. "user_…"). Resolve the Clerk id to
 * the app's user row, creating it on demand if the Clerk webhook hasn't synced
 * the user yet (same pattern as the dashboard).
 */
export async function requireUserId(clerkId: string): Promise<string> {
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

/** Signed-in user's app id, or null when the request isn't authenticated. */
export async function currentAppUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  return requireUserId(clerkId);
}

export type BeginTurnInput = {
  sessionId: string | null;
  mode: ChatMode;
  content: string;
  /**
   * How many previous messages to send to the model. Voice mode keeps this
   * short so the prompt (and therefore the first spoken word) stays fast.
   */
  historyLimit?: number;
};

export type BeginTurnResult = {
  sessionId: string;
  /** Non-null when this message created the session. */
  createdSession: ChatSessionRow | null;
  userMessage: ChatMessageRow;
  language: DetectedLanguage;
  /** Conversation so far (oldest first), ready for the Gemini SDK. */
  history: Content[];
};

/**
 * Persist the student's message and assemble the context for the reply:
 * validates session ownership, creates the session on the first message,
 * records the detected language and tone, and titles a new session.
 */
export async function beginTurn(
  userId: string,
  input: BeginTurnInput
): Promise<BeginTurnResult> {
  const content = input.content.trim();
  if (!content) throw new Error("Message cannot be empty");

  const language = detectLanguage(content);
  const tone = detectTone(content);

  let sessionId = input.sessionId;
  let createdSession: ChatSessionRow | null = null;

  if (sessionId) {
    // Ownership check: the session must belong to the signed-in user.
    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId))
      );
    if (!session) throw new Error("Session not found");
  } else {
    const [created] = await db
      .insert(chatSessions)
      .values({ userId, mode: input.mode, language })
      .returning();
    sessionId = created.id;
    createdSession = created;
  }

  // Conversation history for the AI (previous messages, oldest first).
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const limited = input.historyLimit
    ? historyRows.slice(-input.historyLimit)
    : historyRows;
  // Trim to start at a user message: a history that begins with a model reply
  // confuses the model about who is speaking.
  const firstUserIndex = limited.findIndex((m) => m.role === "user");
  const history = (firstUserIndex > 0
    ? limited.slice(firstUserIndex)
    : limited
  ).map((m) => ({
    role: (m.role === "user" ? "user" : "model") as "user" | "model",
    parts: [{ text: m.content }],
  }));

  const [userMessage] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "user", content, language, tone })
    .returning();

  // First message becomes the session title.
  const title =
    historyRows.length === 0
      ? content.length > 60
        ? `${content.slice(0, 60).trimEnd()}…`
        : content
      : undefined;

  await db
    .update(chatSessions)
    .set({
      mode: input.mode,
      language,
      title: title ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(chatSessions.id, sessionId));

  return { sessionId, createdSession, userMessage, language, history };
}

/** Save the tutor's reply. Returns null when there was nothing to save. */
export async function saveAssistantReply(
  sessionId: string,
  text: string,
  provider: Provider
): Promise<ChatMessageRow | null> {
  const content = text.trim();
  if (!content) return null;

  const [saved] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "assistant", content, provider })
    .returning();
  return saved;
}
