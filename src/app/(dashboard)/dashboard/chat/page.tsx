import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ChatUI } from "@/features/chat/components/ChatUI";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <ChatUI />;
}