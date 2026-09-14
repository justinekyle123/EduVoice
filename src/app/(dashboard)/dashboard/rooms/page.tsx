import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { RoomsUI } from "@/features/rooms/components/RoomsUI";

export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <RoomsUI />;
}
