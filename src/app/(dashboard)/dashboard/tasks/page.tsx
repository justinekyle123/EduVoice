import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TasksUI } from "@/features/tasks/components/TasksUI";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <TasksUI />;
}