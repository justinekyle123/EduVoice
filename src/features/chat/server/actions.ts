"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/schema";
import { generateText } from "@/lib/ai/gemini";
import { instructionFor, type ChatMode } from "../lib/modes";
import { detectLanguage, detectTone } from "../lib/detect";

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

export async function getChatSessions() {
  const { userId } = await auth();
  if (!userId) return [];

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
  const { userId } = await auth();
  if (!userId) return null;

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
}) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const content = input.content.trim();
  if (!content) throw new Error("Message cannot be empty");

  const language = detectLanguage(content);
  const tone = detectTone(content);

  let sessionId = input.sessionId;
  let createdSession = null;

  if (sessionId) {
    // Ownership check: the session must belong to the signed-in user.
    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
    if (!session) throw new Error("Session not found");
  } else {
    const [created] = await db
      .insert(chatSessions)
      .values({ userId, mode: input.mode, language })
      .returning();
    sessionId = created.id;
    createdSession = created;
  }

  // Conversation history for Gemini (previous messages, oldest first).
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  const history = historyRows.map((m) => ({
    role: (m.role === "user" ? "user" : "model") as "user" | "model",
    parts: [{ text: m.content }],
  }));

  // Save the user message (with detected language + tone).
  const [userMessage] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "user", content, language, tone })
    .returning();

  // First message becomes the session title.
  const isFirstMessage = historyRows.length === 0;
  const title = isFirstMessage
    ? content.length > 60
      ? `${content.slice(0, 60).trimEnd()}…`
      : content
    : undefined;

  await db
    .update(chatSessions)
    .set({ mode: input.mode, language, title: title ?? undefined, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  // Call Gemini and persist the reply.
  let assistantMessage = null;
  let error: string | null = null;

  try {
    const reply = await generateText({
      prompt: content,
      systemInstruction: instructionFor(input.mode),
      history,
    });
    const [saved] = await db
      .insert(chatMessages)
      .values({ sessionId, role: "assistant", content: reply })
      .returning();
    assistantMessage = saved;
  } catch (err) {
    error = err instanceof Error ? err.message : "Gemini request failed";
    console.error("[chat] Gemini request failed:", error);
  }

  return { sessionId, createdSession, userMessage, assistantMessage, error, language };
}

// ---------------------------------------------------------------------------
// Mode + delete
// ---------------------------------------------------------------------------

/** Re-run the AI for the last user message (used when the first call failed). */
export async function retryAssistantMessage(sessionId: string, mode: ChatMode) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

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

  const reply = await generateText({
    prompt: lastUserMsg.content,
    systemInstruction: instructionFor(mode),
    history,
  });

  const [saved] = await db
    .insert(chatMessages)
    .values({ sessionId, role: "assistant", content: reply })
    .returning();

  return saved;
}

export async function updateChatSessionMode(sessionId: string, mode: ChatMode) {
  const { userId } = await auth();
  if (!userId) return;

  await db
    .update(chatSessions)
    .set({ mode, updatedAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}

export async function deleteChatSession(sessionId: string) {
  const { userId } = await auth();
  if (!userId) return;

  await db
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}