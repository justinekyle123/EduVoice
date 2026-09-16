import { NextResponse } from "next/server";
import type { Provider } from "@/lib/ai";
import { generateTextStream } from "@/lib/ai";
import { voiceInstructionFor, type ChatMode } from "@/features/chat/lib/modes";
import {
  beginTurn,
  currentAppUserId,
  saveAssistantReply,
} from "@/features/chat/server/turn";

// Streaming turn endpoint for voice mode.
//
// A server action can only return a finished value, which forced voice mode to
// wait for the whole reply before speaking a word of it. This route streams the
// model's text as Server-Sent Events instead: the client speaks each sentence as
// soon as it lands, so the tutor starts answering in about a second and the
// remaining sentences are synthesized while the first one is playing.
//
// Text chat keeps using the sendChatMessage server action; both go through the
// same turn helpers so a thread reads the same either way.

export const dynamic = "force-dynamic";

const MODES = new Set<string>(["chat", "hint", "debate", "interview"]);

type VoiceTurnRequest = {
  sessionId?: string | null;
  mode?: string;
  content?: string;
};

/** One SSE frame. */
function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  const userId = await currentAppUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: VoiceTurnRequest;
  try {
    body = (await request.json()) as VoiceTurnRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }
  const mode: ChatMode = MODES.has(body.mode ?? "")
    ? (body.mode as ChatMode)
    : "chat";

  let turn;
  try {
    turn = await beginTurn(userId, {
      sessionId: body.sessionId ?? null,
      mode,
      content,
      // Voice turns keep the prompt short: less to read means a faster first
      // sentence, and the last dozen messages are plenty of context for a
      // spoken back-and-forth.
      historyLimit: 12,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start the turn" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame(event)));
        } catch {
          closed = true;
        }
      };

      // The client needs the saved rows (and a new session's id) before the
      // first token arrives, so it can show the student's own words right away.
      send({
        type: "turn",
        sessionId: turn.sessionId,
        createdSession: turn.createdSession,
        userMessage: turn.userMessage,
        language: turn.language,
      });

      let full = "";
      let provider: Provider = "gemini-1";

      try {
        for await (const chunk of generateTextStream({
          prompt: content,
          systemInstruction: voiceInstructionFor(mode),
          history: turn.history,
          signal: request.signal,
        })) {
          full += chunk.text;
          provider = chunk.provider;
          send({ type: "delta", text: chunk.text });
        }

        const saved = await saveAssistantReply(turn.sessionId, full, provider);
        send({ type: "done", assistantMessage: saved });
      } catch (err) {
        const aborted = request.signal.aborted;
        const message =
          err instanceof Error ? err.message : "The AI request failed";
        if (!aborted) console.error("[voice] stream failed:", message);

        // Keep whatever the student already heard — a half answer in the thread
        // is more useful than an empty one.
        const saved = full.trim()
          ? await saveAssistantReply(turn.sessionId, full, provider).catch(
              () => null
            )
          : null;
        if (saved) send({ type: "done", assistantMessage: saved, partial: true });
        if (!aborted) send({ type: "error", error: message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Ask reverse proxies not to buffer, so events arrive as they are written.
      "X-Accel-Buffering": "no",
    },
  });
}
