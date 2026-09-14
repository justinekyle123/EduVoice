import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ChatUI } from "@/features/chat/components/ChatUI";

export const dynamic = "force-dynamic";

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { sessionId } = await params;

  return <ChatUI sessionId={sessionId} />;
}