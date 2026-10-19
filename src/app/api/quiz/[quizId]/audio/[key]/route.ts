import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quizzes } from "@/lib/db/schema";
import { getUserByClerkId } from "@/features/auth/server/users";
import {
  isQuizAudioScope,
  readQuizQuestionAudio,
} from "@/features/quiz/server/quizAudio";

// A quiz's pre-rendered question clips (feature 6.4).
//
//   GET /api/quiz/<quizId>/audio/<questionId>.wav
//
// The voice quiz plays these straight from the browser's audio element, so this
// is the only way a clip is ever read. Ownership of the quiz is the access check,
// and it is the one that matters: a personal quiz is not shared, unlike a study
// room's narration, so a key that leaks must still not let anyone else hear it.
//
// Nothing here synthesizes: a question with no clip is spoken by the player
// through the ordinary speech route instead, so this handler only ever reads a
// file that already exists.

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Quiz audio not found" }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quizId: string; key: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { quizId, key } = await params;
  // Checked before the id reaches the database, so a malformed id is a 404 rather
  // than a query that fails on a uuid column.
  if (!isQuizAudioScope(quizId)) return notFound();

  const user = await getUserByClerkId(clerkId);
  if (!user) return notFound();

  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, user.id)));
  if (!quiz) return notFound();

  const bytes = await readQuizQuestionAudio(quizId, key);
  if (!bytes) return notFound();

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.length),
      // Private: it is one student's quiz, so no shared cache may keep a copy.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
