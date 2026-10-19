import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { FlashcardsUI } from "@/features/flashcards/components/FlashcardsUI";

export const dynamic = "force-dynamic";

/**
 * `/dashboard/flashcards`                 → deck list + maker
 * `/dashboard/flashcards?deck=<id>`       → open that deck's review at once
 * `/dashboard/flashcards?document=<id>`   → pre-select that document as the source
 * `/dashboard/flashcards?quiz=<id>`       → pre-select that quiz as the source
 * `/dashboard/flashcards?topic=<topic>`   → pre-fill the topic
 */
export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    deck?: string | string[];
    document?: string | string[];
    quiz?: string | string[];
    topic?: string | string[];
  }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { deck, document: documentId, quiz, topic } = await searchParams;
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" && value.length > 0 ? value : null;

  return (
    <FlashcardsUI
      initialDeckId={first(deck)}
      initialDocumentId={first(documentId)}
      initialQuizId={first(quiz)}
      initialTopic={first(topic)?.slice(0, 200) ?? null}
    />
  );
}
