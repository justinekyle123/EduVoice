import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { RoomsUI } from "@/features/rooms/components/RoomsUI";

export const dynamic = "force-dynamic";

/**
 * `/dashboard/rooms`          → the room list
 * `/dashboard/rooms?room=<id>` → that room opened straight away (used by the
 *                                history & scores page after a repeat)
 */
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string | string[] }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { room } = await searchParams;
  const initialRoomId =
    typeof room === "string" && room.length > 0 ? room : null;

  return <RoomsUI initialRoomId={initialRoomId} />;
}
