import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { membershipFor } from "@/features/rooms/server/membership";
import { resolveAppUserId } from "@/features/rooms/server/files";
import {
  deleteQuestionAudio,
  readQuestionAudio,
} from "@/features/rooms/server/quizAudio";

// Streaming and cleanup for a question's narration clip.
//
// GET is the only way a clip is ever read: room membership is the access check,
// so a key on its own (they are minted server-side and unguessable) still can't
// be fetched from outside the room. DELETE is host-only and best-effort — it
// exists so replacing or clearing a question doesn't leave bytes in the folder.

export const dynamic = "force-dynamic";

async function requireMember(roomId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const userId = await resolveAppUserId(clerkId);
  const member = await membershipFor(roomId, userId);
  if (!member) {
    return {
      error: NextResponse.json(
        { error: "You are not a member of this room" },
        { status: 403 }
      ),
    };
  }
  return { member };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; key: string }> }
) {
  const { roomId, key } = await params;
  const gate = await requireMember(roomId);
  if ("error" in gate) return gate.error;

  const clip = await readQuestionAudio(roomId, key);
  if (!clip) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(clip.bytes), {
    headers: {
      "Content-Type": clip.contentType,
      "Content-Length": String(clip.bytes.length),
      // Private: the clip must never be cached by a shared proxy.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; key: string }> }
) {
  const { roomId, key } = await params;
  const gate = await requireMember(roomId);
  if ("error" in gate) return gate.error;
  if (gate.member.role !== "owner") {
    return NextResponse.json(
      { error: "Only the host can remove this room's audio" },
      { status: 403 }
    );
  }

  await deleteQuestionAudio(roomId, key);
  return NextResponse.json({ ok: true });
}
