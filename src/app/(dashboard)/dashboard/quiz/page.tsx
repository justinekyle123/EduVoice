import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { QuizUI } from "@/features/quiz/components/QuizUI";

export const dynamic = "force-dynamic";

/**
 * `/dashboard/quiz`           → a standalone quiz
 * `/dashboard/quiz?room=<id>` → a quiz whose score joins that room's leaderboard
 */
export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string | string[] }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { room } = await searchParams;
  const roomId = typeof room === "string" && room.length > 0 ? room : null;

  return <QuizUI roomId={roomId} />;
}