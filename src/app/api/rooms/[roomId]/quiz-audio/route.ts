import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { membershipFor } from "@/features/rooms/server/membership";
import { resolveAppUserId } from "@/features/rooms/server/files";
import {
  isAudioClip,
  MAX_QUESTION_AUDIO_BYTES,
  saveQuestionAudio,
} from "@/features/rooms/server/quizAudio";

// Question narration for a hand-written room quiz: the host drops a clip onto a
// question and this route writes it into the room's folder on disk.
//
// A route handler (rather than a server action) is what the shared file upload
// already uses: the bytes stream as multipart form data, so nothing is base64'd
// into a server-action body. Only the host may write, matching every other
// room-scoped write, and the returned key — not the file name or path — is what
// the builder stores on the draft.

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { roomId } = await params;
  const userId = await resolveAppUserId(clerkId);
  const member = await membershipFor(roomId, userId);
  if (!member) {
    return NextResponse.json(
      { error: "You are not a member of this room" },
      { status: 403 }
    );
  }
  if (member.role !== "owner") {
    return NextResponse.json(
      { error: "Only the host can add audio to this room's quiz" },
      { status: 403 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio file received" }, { status: 400 });
  }
  if (!isAudioClip(file.name, file.type)) {
    return NextResponse.json(
      { error: "Drop an audio file (MP3, WAV, OGG, M4A, WebM)" },
      { status: 415 }
    );
  }
  if (file.size > MAX_QUESTION_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "That audio file is too large (8 MB max)" },
      { status: 413 }
    );
  }

  try {
    const saved = await saveQuestionAudio({
      roomId,
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      fileType: file.type,
    });
    return NextResponse.json({ key: saved.key, name: file.name.slice(0, 200) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save that audio" },
      { status: 400 }
    );
  }
}
