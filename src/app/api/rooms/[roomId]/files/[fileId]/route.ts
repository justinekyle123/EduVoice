import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { membershipFor } from "@/features/rooms/server/membership";
import { readRoomFile, resolveAppUserId } from "@/features/rooms/server/files";

// Download a shared room file. Membership is checked before the bytes are read,
// so the file has no public URL even though it lives in the database.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; fileId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { roomId, fileId } = await params;
  const userId = await resolveAppUserId(clerkId);
  const member = await membershipFor(roomId, userId);
  if (!member) {
    return NextResponse.json({ error: "You are not a member of this room" }, { status: 403 });
  }

  const file = await readRoomFile(roomId, fileId);
  if (!file) {
    return NextResponse.json({ error: "That file is no longer shared" }, { status: 404 });
  }

  // RFC 5987: give a plain-ASCII fallback name plus the UTF-8 original, so a
  // file named in Filipino or Cebuano still downloads with its real name.
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encodedName = encodeURIComponent(file.fileName);

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.fileType || "application/octet-stream",
      "Content-Length": String(file.data.length),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
    },
  });
}
