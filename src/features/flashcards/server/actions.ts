"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import {
  documentChunks,
  documents,
  flashcardDecks,
  flashcardReviews,
  flashcards,
  quizQuestions,
  quizzes,
} from "@/lib/db/schema";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";
import {
  cardsFromQuizQuestions,
  clampCardCount,
  generateCardsFromText,
  generateCardsFromTopic,
  shortTitle,
  type GeneratedCard,
} from "../lib/generate";
import {
  INITIAL_REVIEW_STATE,
  isDue,
  scheduleReview,
  type ReviewRating,
} from "../lib/srs";

// Smart Flashcards with spaced repetition (feature 6.12).
//
// A deck comes from a topic or a document (written by the model) or from a quiz
// the student already took (built straight from its questions and answers — no
// model call). Review progress is stored in `flashcard_reviews`, which is an
// append-only log: one row per rating, carrying the schedule it produced. A
// card's *current* state is therefore its most recent row, which is what
// `latestReviewStates` reads.

// Same Clerk → Postgres user resolution the chat, quiz, rooms, tasks, progress
// and documents features use.
async function requireUserId(clerkId: string): Promise<string> {
  let user = await getUserByClerkId(clerkId);
  if (!user) {
    const clerkUser = await currentUser();
    user = await upsertUser({
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: clerkUser?.fullName ?? clerkUser?.username ?? null,
    });
  }
  return user.id;
}

const RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];
/** A student's review log is bounded, so the latest-state scan can never balloon. */
const MAX_REVIEW_ROWS = 5_000;
const MAX_TOPIC_CHARS = 200;
const MAX_DECK_TITLE_CHARS = 120;

export type DeckCard = {
  id: string;
  front: string;
  back: string;
  /** null until the card has been reviewed — i.e. it is due now. */
  dueAt: Date | null;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  lastRating: ReviewRating | null;
};

export type DeckSummary = {
  id: string;
  title: string;
  cardCount: number;
  dueCount: number;
  createdAt: Date;
  documentId: string | null;
};

export type ReviewQueue = {
  deckId: string | null;
  deckTitle: string | null;
  cards: DeckCard[];
};

type CardRow = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  createdAt: Date;
};

type ReviewStateRow = {
  flashcardId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  dueAt: Date;
  rating: ReviewRating;
};

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

/** The latest review row for each of this student's cards. */
async function latestReviewStates(
  userId: string
): Promise<Map<string, ReviewStateRow>> {
  const rows = await db
    .select({
      flashcardId: flashcardReviews.flashcardId,
      easeFactor: flashcardReviews.easeFactor,
      intervalDays: flashcardReviews.intervalDays,
      repetitions: flashcardReviews.repetitions,
      dueAt: flashcardReviews.dueAt,
      rating: flashcardReviews.rating,
      reviewedAt: flashcardReviews.reviewedAt,
    })
    .from(flashcardReviews)
    .where(eq(flashcardReviews.userId, userId))
    .orderBy(desc(flashcardReviews.reviewedAt))
    .limit(MAX_REVIEW_ROWS);

  const latest = new Map<string, ReviewStateRow>();
  for (const row of rows) {
    // Rows arrive newest first, so the first sighting of a card is its state.
    if (latest.has(row.flashcardId)) continue;
    latest.set(row.flashcardId, row);
  }
  return latest;
}

/** Cards in the student's decks (optionally one deck), oldest first. */
async function ownedCards(userId: string, deckId?: string): Promise<CardRow[]> {
  return db
    .select({
      id: flashcards.id,
      deckId: flashcards.deckId,
      front: flashcards.front,
      back: flashcards.back,
      createdAt: flashcards.createdAt,
    })
    .from(flashcards)
    .innerJoin(flashcardDecks, eq(flashcardDecks.id, flashcards.deckId))
    .where(
      deckId
        ? and(eq(flashcardDecks.userId, userId), eq(flashcards.deckId, deckId))
        : eq(flashcardDecks.userId, userId)
    )
    .orderBy(asc(flashcards.createdAt));
}

function toDeckCard(card: CardRow, review: ReviewStateRow | undefined): DeckCard {
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    dueAt: review ? review.dueAt : null,
    intervalDays: review?.intervalDays ?? 0,
    repetitions: review?.repetitions ?? 0,
    easeFactor: review?.easeFactor ?? INITIAL_REVIEW_STATE.easeFactor,
    lastRating: review?.rating ?? null,
  };
}

/** Overdue first, then never-reviewed, then whatever is due soonest. */
function byUrgency(a: DeckCard, b: DeckCard): number {
  const av = a.dueAt ? a.dueAt.getTime() : Number.NEGATIVE_INFINITY;
  const bv = b.dueAt ? b.dueAt.getTime() : Number.NEGATIVE_INFINITY;
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Every deck the student owns, with how many cards are waiting right now. */
export async function getDecks(): Promise<DeckSummary[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return [];
  const userId = await requireUserId(clerkId);

  const decks = await db
    .select({
      id: flashcardDecks.id,
      title: flashcardDecks.title,
      createdAt: flashcardDecks.createdAt,
      documentId: flashcardDecks.documentId,
    })
    .from(flashcardDecks)
    .where(eq(flashcardDecks.userId, userId))
    .orderBy(desc(flashcardDecks.createdAt));
  if (decks.length === 0) return [];

  const cards = await ownedCards(userId);
  const reviews = await latestReviewStates(userId);
  const now = new Date();

  // Cards arrive across all decks, so bucket them by the deck they came from and
  // count the ones that are due — computed here rather than in SQL because a
  // card's state is its latest review row, which SQL cannot aggregate simply.
  return decks.map((deck) => {
    const deckCards = cards.filter((card) => card.deckId === deck.id);
    return {
      id: deck.id,
      title: deck.title,
      cardCount: deckCards.length,
      dueCount: deckCards.filter((card) => {
        const review = reviews.get(card.id);
        return isDue(review ? review.dueAt : null, now);
      }).length,
      createdAt: deck.createdAt,
      documentId: deck.documentId,
    };
  });
}

/** One deck's cards with their current review state, in creation order. */
export async function getDeck(deckId: string): Promise<{
  deck: { id: string; title: string };
  cards: DeckCard[];
}> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [deck] = await db
    .select({ id: flashcardDecks.id, title: flashcardDecks.title })
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)));
  if (!deck) throw new Error("That deck is not one of yours");

  const cards = await ownedCards(userId, deckId);
  const reviews = await latestReviewStates(userId);

  return {
    deck,
    cards: cards.map((card) => toDeckCard(card, reviews.get(card.id))),
  };
}

/**
 * The cards to review now — everything due, or every card in a deck when
 * `includeNotDue` asks for a full pass regardless of schedule.
 */
export async function getReviewQueue(input: {
  deckId?: string | null;
  includeNotDue?: boolean;
} = {}): Promise<ReviewQueue> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { deckId: null, deckTitle: null, cards: [] };
  const userId = await requireUserId(clerkId);

  const deckId = input.deckId ?? null;
  let deckTitle: string | null = null;

  if (deckId) {
    const [deck] = await db
      .select({ id: flashcardDecks.id, title: flashcardDecks.title })
      .from(flashcardDecks)
      .where(and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)));
    if (!deck) throw new Error("That deck is not one of yours");
    deckTitle = deck.title;
  }

  const cards = await ownedCards(userId, deckId ?? undefined);
  const reviews = await latestReviewStates(userId);
  const now = new Date();

  const queue = cards
    .map((card) => toDeckCard(card, reviews.get(card.id)))
    .filter((card) => input.includeNotDue || isDue(card.dueAt, now))
    .sort(byUrgency);

  return { deckId, deckTitle, cards: queue };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Write a deck and its cards in one go. */
async function saveDeck(input: {
  userId: string;
  title: string;
  documentId?: string | null;
  cards: GeneratedCard[];
}) {
  const [deck] = await db
    .insert(flashcardDecks)
    .values({
      userId: input.userId,
      title: input.title.slice(0, MAX_DECK_TITLE_CHARS) || "Flashcards",
      documentId: input.documentId ?? null,
    })
    .returning();

  const cards = await db
    .insert(flashcards)
    .values(
      input.cards.map((card) => ({
        deckId: deck.id,
        front: card.front,
        back: card.back,
      }))
    )
    .returning({ id: flashcards.id });

  return { deck, cardCount: cards.length };
}

/** A deck on a topic the student names. */
export async function createDeckFromTopic(input: {
  topic: string;
  count?: number;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const topic = input.topic.replace(/\s+/g, " ").trim();
  if (topic.length < 3) throw new Error("Give the deck a longer topic");
  if (topic.length > MAX_TOPIC_CHARS) throw new Error("That topic is too long");

  const generated = await generateCardsFromTopic({
    topic,
    count: clampCardCount(input.count),
  });
  const saved = await saveDeck({
    userId,
    title: generated.title,
    cards: generated.cards,
  });

  return {
    deck: saved.deck,
    cardCount: saved.cardCount,
    provider: generated.provider,
  };
}

/** A deck built from one of the student's ready documents. */
export async function createDeckFromDocument(input: {
  documentId: string;
  count?: number;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [document] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      summary: documents.summary,
      status: documents.status,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, userId)));
  if (!document) throw new Error("That document is not one of yours");
  if (document.status !== "ready") {
    throw new Error("That document has no readable text yet");
  }

  const chunks = await db
    .select({ content: documentChunks.content })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, document.id))
    .orderBy(asc(documentChunks.chunkIndex));

  const text = [document.summary ?? "", ...chunks.map((chunk) => chunk.content)]
    .filter(Boolean)
    .join("\n\n");

  const generated = await generateCardsFromText({
    title: document.fileName,
    text,
    count: clampCardCount(input.count),
  });
  const saved = await saveDeck({
    userId,
    title: generated.title,
    documentId: document.id,
    cards: generated.cards,
  });

  return {
    deck: saved.deck,
    cardCount: saved.cardCount,
    provider: generated.provider,
  };
}

/**
 * A deck made from a quiz the student already owns — the questions and their
 * correct answers are already cards, so this costs no AI request at all.
 */
export async function createDeckFromQuiz(input: { quizId: string }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  const [quiz] = await db
    .select({ id: quizzes.id, title: quizzes.title })
    .from(quizzes)
    .where(and(eq(quizzes.id, input.quizId), eq(quizzes.userId, userId)));
  if (!quiz) throw new Error("That quiz is not one of yours");

  const questions = await db
    .select({
      question: quizQuestions.question,
      correctAnswer: quizQuestions.correctAnswer,
      explanation: quizQuestions.explanation,
    })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.order));

  const cards = cardsFromQuizQuestions(questions);
  if (cards.length === 0) {
    throw new Error("That quiz has no questions to turn into cards");
  }

  const saved = await saveDeck({
    userId,
    title: shortTitle(quiz.title),
    cards,
  });

  return { deck: saved.deck, cardCount: saved.cardCount, provider: "quiz" };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * Record a rating and schedule the card's next review. `again` sends the card
 * back into the same session; the other ratings extend its interval. Returns the
 * stored schedule so the UI can say when the card will come round again.
 */
export async function reviewCard(input: {
  flashcardId: string;
  rating: ReviewRating;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  if (!RATINGS.includes(input.rating)) {
    throw new Error("That review rating is not recognised");
  }

  // Ownership: the card must sit in one of this student's decks.
  const [card] = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .innerJoin(flashcardDecks, eq(flashcardDecks.id, flashcards.deckId))
    .where(
      and(eq(flashcards.id, input.flashcardId), eq(flashcardDecks.userId, userId))
    );
  if (!card) throw new Error("That flashcard is not one of yours");

  const [latest] = await db
    .select({
      easeFactor: flashcardReviews.easeFactor,
      intervalDays: flashcardReviews.intervalDays,
      repetitions: flashcardReviews.repetitions,
    })
    .from(flashcardReviews)
    .where(
      and(
        eq(flashcardReviews.flashcardId, input.flashcardId),
        eq(flashcardReviews.userId, userId)
      )
    )
    .orderBy(desc(flashcardReviews.reviewedAt))
    .limit(1);

  const now = new Date();
  const scheduled = scheduleReview(
    latest ?? INITIAL_REVIEW_STATE,
    input.rating,
    now
  );

  await db.insert(flashcardReviews).values({
    flashcardId: input.flashcardId,
    userId,
    rating: input.rating,
    easeFactor: scheduled.easeFactor,
    intervalDays: scheduled.intervalDays,
    repetitions: scheduled.repetitions,
    dueAt: scheduled.dueAt,
    reviewedAt: now,
  });

  return {
    flashcardId: input.flashcardId,
    rating: input.rating,
    easeFactor: scheduled.easeFactor,
    intervalDays: scheduled.intervalDays,
    repetitions: scheduled.repetitions,
    dueAt: scheduled.dueAt,
  };
}

/** Delete a deck; its cards and their review history cascade away. */
export async function deleteDeck(deckId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Not authenticated");
  const userId = await requireUserId(clerkId);

  await db
    .delete(flashcardDecks)
    .where(and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)));
}
