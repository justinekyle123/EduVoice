import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { RoomHistory } from "@/features/rooms/components/RoomHistory";

export const dynamic = "force-dynamic";

export default async function RoomHistoryPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { roomId } = await params;

  return <RoomHistory roomId={roomId} />;
}
