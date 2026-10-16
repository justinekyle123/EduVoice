import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidSpeechKey, readSpeechAudio } from "@/features/chat/server/speechStore";

// Play a saved clip by key: the pre-generated phrase bank (data/phrases) or the
// runtime speech cache (data/speech). This is the "play it from the folder"
// half of the feature — a key that has already been rendered costs nothing.
//
// Signed-in students only, like the POST that creates the files.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { key } = await params;
  if (!isValidSpeechKey(key)) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  const bytes = await readSpeechAudio(key);
  if (!bytes) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
