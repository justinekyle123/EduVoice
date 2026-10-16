import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ProgressUI } from "@/features/progress/components/ProgressUI";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <ProgressUI />;
}
