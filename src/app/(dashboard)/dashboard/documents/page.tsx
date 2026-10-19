import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DocumentsUI } from "@/features/documents/components/DocumentsUI";

export const dynamic = "force-dynamic";

/** Document-based Q&A (feature 6.3) — upload material and ask questions about it. */
export default async function DocumentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <DocumentsUI />;
}
