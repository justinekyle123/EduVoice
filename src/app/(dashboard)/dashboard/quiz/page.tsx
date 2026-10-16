import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { QuizUI } from "@/features/quiz/components/QuizUI";

export const dynamic = "force-dynamic";

/**
 * `/dashboard/quiz`                       → a standalone quiz
 * `/dashboard/quiz?room=<id>`             → a quiz whose score joins that room's leaderboard
 * `/dashboard/quiz?room=<id>&retake=<id>` → straight into a retake of a finished quiz
 * `/dashboard/quiz?topic=<topic>`         → a quiz on that topic, named up front (the
 *                                           progress page sends students here for a
 *                                           topic that needs review)
 */
export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string | string[];
    retake?: string | string[];
    topic?: string | string[];
  }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { room, retake, topic } = await searchParams;
  const roomId = typeof room === "string" && room.length > 0 ? room : null;
  const retakeQuizId =
    typeof retake === "string" && retake.length > 0 ? retake : null;
  const initialTopic =
    typeof topic === "string" && topic.trim().length > 0 ? topic.trim().slice(0, 200) : null;

  return (
    <QuizUI roomId={roomId} retakeQuizId={retakeQuizId} initialTopic={initialTopic} />
  );
}