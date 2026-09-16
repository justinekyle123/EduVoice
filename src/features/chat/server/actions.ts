"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/schema";
import { generateText } from "@/lib/ai";
import { instructionFor, type ChatMode } from "../lib/modes";
import {
  beginTurn,
  requireUserId,
  saveAssistantReply,
} from "./turn";

// Session reads/writes for typed chat. The turn itself (persisting the student
// message and the reply) is shared with the streaming voice route — see
// ./turn.ts.

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

export async function getChatSessions() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const sessions = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt));

  // One extra query: latest message per session for the list preview.
  const previews = new Map<string, string>();
  if (sessions.length > 0) {
    const rows = await db
      .select({
        sessionId: chatMessages.sessionId,
        content: chatMessages.content,
      })
      .from(chatMessages)
      .where(
        inArray(
          chatMessages.sessionId,
          sessions.map((s) => s.id)
        )
      )
      .orderBy(desc(chatMessages.createdAt));

    for (const row of rows) {
      if (!previews.has(row.sessionId)) previews.set(row.sessionId, row.content);
    }
  }

  return sessions.map((session) => ({
    ...session,
    preview: previews.get(session.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Single session + messages
// ---------------------------------------------------------------------------

export async function getChatMessages(sessionId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const userId = await requireUserId(clerkId);

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));

  if (!session) return null;

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  return { session, messages };
}

// ---------------------------------------------------------------------------
// Send a message (creates the session on first message)
// ---------------------------------------------------------------------------

export async function sendChatMessage(input: {
  sessionId: string | null;
  mode: ChatMode;
  content: string;
  /** Voice turns prioritize latency over sending the entire long transcript. */
  voiceMode?: boolean;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const { sessionId, createdSession, userMessage, language, history } =
    await beginTurn(userId, {
      sessionId: input.sessionId,
      mode: input.mode,
      content: input.content,
      historyLimit: input.voiceMode ? 12 : undefined,
    });

  // Call the AI (Gemini, rotating across the configured AI Studio keys) and
  // persist the reply together with the key slot that answered.
  let assistantMessage = null;
  let error: string | null = null;

  try {
    const { text: reply, provider } = await generateText({
      prompt: userMessage.content,
      systemInstruction: instructionFor(input.mode),
      history,
    });
    assistantMessage = await saveAssistantReply(sessionId, reply, provider);
  } catch (err) {
    error = err instanceof Error ? err.message : "AI request failed";
    console.error("[chat] AI request failed:", error);
  }

  return { sessionId, createdSession, userMessage, assistantMessage, error, language };
}

// ---------------------------------------------------------------------------
// Mode + delete
// ---------------------------------------------------------------------------

/** Re-run the AI for the last user message (used when the first call failed). */
export async function retryAssistantMessage(sessionId: string, mode: ChatMode) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [existing] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  if (!existing) throw new Error("Session not found");

  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const lastUserMsg = [...historyRows].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) throw new Error("No user message to retry");

  // History excludes the last user message (it becomes the prompt).
  const history = historyRows
    .filter((m) => m.id !== lastUserMsg.id)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "model") as "user" | "model",
      parts: [{ text: m.content }],
    }));

  const { text: reply, provider } = await generateText({
    prompt: lastUserMsg.content,
    systemInstruction: instructionFor(mode),
    history,
  });

  const [saved] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "assistant", content: reply, provider })
    .returning();

  return saved;
}

export async function updateChatSessionMode(sessionId: string, mode: ChatMode) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return;
  const userId = await requireUserId(clerkId);

  await db
    .update(chatSessions)
    .set({ mode, updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}

export async function deleteChatSession(sessionId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return;
  const userId = await requireUserId(clerkId);

  await db
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}