import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { membershipFor } from "@/features/rooms/server/membership";
import {
  isAllowedRoomFile,
  listRoomFiles,
  MAX_ROOM_FILE_BYTES,
  resolveAppUserId,
  saveRoomFile,
} from "@/features/rooms/server/files";

// Shared room files: the host uploads, every member can list and download.
//
// A route handler (rather than a server action) keeps the file bytes off the
// server-action request path, which caps bodies far below what a study file
// needs. The same membership check guards upload and listing.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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
    return NextResponse.json({ error: "You are not a member of this room" }, { status: 403 });
  }

  return NextResponse.json({ files: await listRoomFiles(roomId) });
}

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
    return NextResponse.json({ error: "You are not a member of this room" }, { status: 403 });
  }

  // Only the host shares material with the room, matching every other
  // room-scoped write.
  if (member.role !== "owner") {
    return NextResponse.json(
      { error: "Only the host can upload files to this room" },
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
    return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_ROOM_FILE_BYTES) {
    return NextResponse.json(
      {
        error: `Files must be ${Math.round(MAX_ROOM_FILE_BYTES / (1024 * 1024))} MB or smaller`,
      },
      { status: 400 }
    );
  }
  if (!isAllowedRoomFile(file.name, file.type)) {
    return NextResponse.json(
      { error: "Share a PDF, document, slide, sheet, or text file" },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const saved = await saveRoomFile({
    roomId,
    userId,
    fileName: file.name.slice(0, 200),
    fileType: file.type || "application/octet-stream",
    bytes,
  });

  return NextResponse.json({ file: saved }, { status: 201 });
}
