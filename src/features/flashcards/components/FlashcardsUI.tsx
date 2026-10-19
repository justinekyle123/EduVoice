"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Eye,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechSynthesis } from "@/features/chat/hooks/useSpeechSynthesis";
import { detectLanguage, speechLangFor } from "@/features/chat/lib/detect";
import { getDocuments, type DocumentRow } from "@/features/documents/server/actions";
import { getRecentQuizzes } from "@/features/quiz/server/actions";
import { describeDue, type ReviewRating } from "../lib/srs";
import {
  createDeckFromDocument,
  createDeckFromQuiz,
  createDeckFromTopic,
  deleteDeck,
  getDecks,
  getReviewQueue,
  reviewCard,
  type DeckCard,
  type DeckSummary,
} from "../server/actions";

// Smart Flashcards with spaced repetition (feature 6.12).
//
// Make a deck (from a topic, a document, or a quiz already taken), then review
// it: the front is shown, the answer is revealed, and the rating decides when the
// card comes back. The scheduling and the append-only review log live on the
// server (server/actions.ts + lib/srs.ts); this file is the workflow around them.

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

type QuizOption = Awaited<ReturnType<typeof getRecentQuizzes>>[number];
type Source = "topic" | "document" | "quiz";

const RATING_BUTTONS: {
  rating: ReviewRating;
  label: string;
  hint: string;
  className: string;
}[] = [
  {
    rating: "again",
    label: "Again",
    hint: "1",
    className:
      "bg-red-50 text-red-700 ring-red-100 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30 dark:hover:bg-red-500/20",
  },
  {
    rating: "hard",
    label: "Hard",
    hint: "2",
    className:
      "bg-amber-50 text-amber-700 ring-amber-100 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30 dark:hover:bg-amber-500/20",
  },
  {
    rating: "good",
    label: "Good",
    hint: "3",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30 dark:hover:bg-emerald-500/20",
  },
  {
    rating: "easy",
    label: "Easy",
    hint: "4",
    className:
      "bg-sky-50 text-sky-700 ring-sky-100 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30 dark:hover:bg-sky-500/20",
  },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type Session = {
  deckId: string | null;
  deckTitle: string | null;
  cards: DeckCard[];
  index: number;
  revealed: boolean;
  /** Cards left behind as "again", to be called out in the summary. */
  again: number;
  /** When the soonest card comes back. */
  nextDue: Date | null;
  done: boolean;
};

export function FlashcardsUI({
  initialDocumentId,
  initialQuizId,
  initialTopic,
  initialDeckId,
}: {
  initialDocumentId?: string | null;
  initialQuizId?: string | null;
  initialTopic?: string | null;
  initialDeckId?: string | null;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [quizzes, setQuizzes] = useState<QuizOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [source, setSource] = useState<Source>(
    initialDocumentId ? "document" : initialQuizId ? "quiz" : "topic"
  );
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [documentId, setDocumentId] = useState(initialDocumentId ?? "");
  const [quizId, setQuizId] = useState(initialQuizId ?? "");
  const [count, setCount] = useState(10);
  const [creating, setCreating] = useState(false);
  const [busyDeckId, setBusyDeckId] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [rating, setRating] = useState(false);

  const { supported: speechSupported, speakingId, speak, stop: stopSpeaking } =
    useSpeechSynthesis();

  // Initial load: decks plus the sources a new deck can be built from. The two
  // option lists are best-effort — a failure leaves the Topic source usable.
  useEffect(() => {
    let cancelled = false;

    getDecks()
      .then((rows) => {
        if (!cancelled) setDecks(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load your decks"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    getDocuments()
      .then((rows) => {
        if (cancelled) return;
        const ready = rows.filter((row) => row.status === "ready");
        setDocuments(ready);
        setDocumentId((current) => current || ready[0]?.id || "");
      })
      .catch(() => {
        // The Topic source still works without any documents.
      });

    getRecentQuizzes()
      .then((rows) => {
        if (cancelled) return;
        setQuizzes(rows);
        setQuizId((current) => current || rows[0]?.id || "");
      })
      .catch(() => {
        // Likewise — a quiz deck is a convenience, not a requirement.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totalDue = useMemo(
    () => decks.reduce((sum, deck) => sum + deck.dueCount, 0),
    [decks]
  );

  const reloadDecks = useCallback(async () => {
    const rows = await getDecks();
    setDecks(rows);
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        source === "document"
          ? await createDeckFromDocument({ documentId, count })
          : source === "quiz"
            ? await createDeckFromQuiz({ quizId })
            : await createDeckFromTopic({ topic, count });

      await reloadDecks();
      setNotice(
        `“${result.deck.title}” is ready — ${result.cardCount} cards. Hit Review to start.`
      );
      if (source === "topic") setTopic("");
    } catch (err) {
      setError(errorMessage(err, "That deck could not be created"));
    } finally {
      setCreating(false);
    }
  }

  const startReview = useCallback(
    async (deckId?: string | null, includeNotDue = false) => {
      setError(null);
      setNotice(null);
      try {
        const queue = await getReviewQueue({ deckId: deckId ?? null, includeNotDue });
        if (queue.cards.length === 0) {
          setNotice("Nothing is due right now — every card is scheduled ahead.");
          return;
        }
        setSession({
          deckId: queue.deckId,
          deckTitle: queue.deckTitle,
          cards: queue.cards,
          index: 0,
          revealed: false,
          again: 0,
          nextDue: null,
          done: false,
        });
      } catch (err) {
        setError(errorMessage(err, "That review could not be started"));
      }
    },
    []
  );

  // Open a deck straight away when the page was reached with ?deck=<id>.
  const openedDeckRef = useRef(false);
  useEffect(() => {
    if (openedDeckRef.current || !initialDeckId) return;
    openedDeckRef.current = true;
    void startReview(initialDeckId);
  }, [initialDeckId, startReview]);

  const rate = useCallback(
    async (value: ReviewRating) => {
      const current = session;
      if (!current || rating) return;
      const card = current.cards[current.index];
      if (!card) return;

      setRating(true);
      setError(null);
      try {
        const scheduled = await reviewCard({ flashcardId: card.id, rating: value });

        const nextIndex = current.index + 1;
        const finished = nextIndex >= current.cards.length;
        const soonest = current.nextDue
          ? new Date(Math.min(current.nextDue.getTime(), scheduled.dueAt.getTime()))
          : scheduled.dueAt;

        setSession({
          ...current,
          index: nextIndex,
          revealed: false,
          again: current.again + (value === "again" ? 1 : 0),
          nextDue: soonest,
          done: finished,
        });

        if (finished) void reloadDecks();
      } catch (err) {
        setError(errorMessage(err, "That review could not be saved"));
      } finally {
        setRating(false);
      }
    },
    [session, rating, reloadDecks]
  );

  // Number keys 1-4 rate the card, matching the button hints.
  useEffect(() => {
    if (!session || session.done || !session.revealed) return;
    function onKey(event: KeyboardEvent) {
      const match = RATING_BUTTONS.find((button) => button.hint === event.key);
      if (!match) return;
      event.preventDefault();
      void rate(match.rating);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, rate]);

  async function handleDeleteDeck(deck: DeckSummary) {
    if (busyDeckId) return;
    if (!window.confirm(`Delete “${deck.title}” and its cards?`)) return;

    setBusyDeckId(deck.id);
    setError(null);
    try {
      await deleteDeck(deck.id);
      setDecks((prev) => prev.filter((row) => row.id !== deck.id));
    } catch (err) {
      setError(errorMessage(err, "That deck could not be deleted"));
    } finally {
      setBusyDeckId(null);
    }
  }

  const card = session && !session.done ? session.cards[session.index] : null;
  const cardSpeakingId = card ? `flashcard-${card.id}` : "flashcard";
  const cardSpeech = card
    ? session?.revealed
      ? `${card.front}. ${card.back}`
      : card.front
    : "";

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Smart flashcards
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Decks built from your documents, quizzes, or any topic — then reviewed
            on a spaced-repetition schedule, so the cards you find hard come back
            sooner and the ones you know fade into the distance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {totalDue > 0 ? (
            <button
              type="button"
              onClick={() => void startReview(null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-800 transition-colors hover:bg-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25"
            >
              <Sparkles className="h-3 w-3" />
              Review {totalDue} due
            </button>
          ) : (
            <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {decks.length} {decks.length === 1 ? "deck" : "decks"}
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {(error || notice) && !session && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            role="status"
            aria-live="polite"
            className="space-y-2"
          >
            {error && (
              <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
            {notice && !error && (
              <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                {notice}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Review session */}
      <AnimatePresence>
        {session && card && (
          <motion.section
            key="review"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn(panel, "space-y-4")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {session.deckTitle ? `Reviewing ${session.deckTitle}` : "Reviewing your due cards"}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Card {session.index + 1} of {session.cards.length}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {speechSupported && (
                  <button
                    type="button"
                    onClick={() =>
                      speakingId === cardSpeakingId
                        ? stopSpeaking()
                        : speak(
                            cardSpeakingId,
                            cardSpeech,
                            speechLangFor(detectLanguage(cardSpeech))
                          )
                    }
                    className={ghostButton}
                  >
                    {speakingId === cardSpeakingId ? (
                      <Square className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                    {speakingId === cardSpeakingId ? "Stop" : "Listen"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    stopSpeaking();
                    setSession(null);
                  }}
                  className={ghostButton}
                >
                  <X className="h-3.5 w-3.5" />
                  Exit
                </button>
              </div>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-500 transition-all duration-300"
                style={{
                  width: `${Math.round((session.index / session.cards.length) * 100)}%`,
                }}
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 px-5 py-8 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Front
              </p>
              <p className="mt-3 whitespace-pre-wrap text-lg font-medium leading-7 text-zinc-900 dark:text-zinc-100">
                {card.front}
              </p>

              {session.revealed ? (
                <>
                  <div className="mx-auto mt-6 h-px w-24 bg-zinc-200 dark:bg-zinc-800" />
                  <p className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                    Answer
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                    {card.back}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setSession({ ...session, revealed: true })}
                  className={cn(primaryButton, "mt-6")}
                >
                  <Eye className="h-4 w-4" />
                  Show answer
                </button>
              )}
            </div>

            {session.revealed && (
              <div>
                <p className="mb-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  How well did you know it?
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATING_BUTTONS.map((button) => (
                    <button
                      key={button.rating}
                      type="button"
                      onClick={() => void rate(button.rating)}
                      disabled={rating}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl px-3 py-3 text-sm font-semibold ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        button.className
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {button.label}
                        <kbd className="rounded bg-white/60 px-1 text-[10px] font-medium opacity-70 dark:bg-black/20">
                          {button.hint}
                        </kbd>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.section>
        )}

        {session && session.done && (
          <motion.section
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={cn(panel, "text-center")}
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
              <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Review complete
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              You went through {session.cards.length}{" "}
              {session.cards.length === 1 ? "card" : "cards"}
              {session.again > 0
                ? `, and ${session.again} ${session.again === 1 ? "card" : "cards"} will come back shortly to be learned again.`
                : " — every one scheduled ahead."}
            </p>

            {session.nextDue && (
              <p className="mt-2 text-xs text-brand-700 dark:text-brand-400">
                Soonest card returns {describeDue(session.nextDue)}.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setSession(null)}
                className={primaryButton}
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => void startReview(session.deckId)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Review what is due
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {!session && (
        <>
          {/* Create */}
          <section className={panel}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
                <Layers className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Make a new deck
                </h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  From a topic, one of your documents, or a quiz you have already
                  taken.
                </p>
              </div>
            </div>

            <div className="mt-4 inline-flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {(
                [
                  { id: "topic", label: "Topic" },
                  { id: "document", label: "Document" },
                  { id: "quiz", label: "Quiz" },
                ] as { id: Source; label: string }[]
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSource(option.id)}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    source === option.id
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              {source === "topic" && (
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="e.g. Cell division in mitosis"
                  aria-label="Deck topic"
                  maxLength={200}
                  className={field}
                />
              )}

              {source === "document" && (
                documents.length === 0 ? (
                  <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    You have no ready documents yet.{" "}
                    <Link
                      href="/dashboard/documents"
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
                    >
                      Upload one first
                    </Link>
                    .
                  </p>
                ) : (
                  <select
                    value={documentId}
                    onChange={(event) => setDocumentId(event.target.value)}
                    aria-label="Document to build the deck from"
                    className={field}
                  >
                    {documents.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.fileName} · {document.chunkCount} sections
                      </option>
                    ))}
                  </select>
                )
              )}

              {source === "quiz" && (
                quizzes.length === 0 ? (
                  <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    You have no quizzes yet.{" "}
                    <Link
                      href="/dashboard/quiz"
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
                    >
                      Take one first
                    </Link>{" "}
                    and its questions become cards.
                  </p>
                ) : (
                  <select
                    value={quizId}
                    onChange={(event) => setQuizId(event.target.value)}
                    aria-label="Quiz to build the deck from"
                    className={field}
                  >
                    {quizzes.map((quiz) => (
                      <option key={quiz.id} value={quiz.id}>
                        {quiz.title} · {quiz.questionCount} questions
                      </option>
                    ))}
                  </select>
                )
              )}

              <div className="flex flex-wrap items-center gap-3">
                {source !== "quiz" && (
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Cards
                    <input
                      type="number"
                      min={4}
                      max={30}
                      value={count}
                      onChange={(event) => setCount(Number(event.target.value))}
                      aria-label="Number of cards"
                      className={cn(field, "w-20 px-2.5 text-center")}
                    />
                  </label>
                )}

                <button
                  type="submit"
                  disabled={
                    creating ||
                    (source === "topic" && topic.trim().length < 3) ||
                    (source === "document" && !documentId) ||
                    (source === "quiz" && !quizId)
                  }
                  className={primaryButton}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {creating ? "Writing your cards…" : "Create deck"}
                </button>
              </div>
            </form>
          </section>

          {/* Decks */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Your decks
            </h2>

            {loading ? (
              <div className={cn(panel, "flex items-center justify-center py-14")}>
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : decks.length === 0 ? (
              <div
                className={cn(
                  panel,
                  "flex flex-col items-center justify-center border-dashed px-6 py-14 text-center"
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
                  <Layers className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                </span>
                <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  No decks yet
                </p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Make your first deck above — the easiest start is turning a
                  document you uploaded into cards.
                </p>
              </div>
            ) : (
              <div className={cn(panel, "divide-y divide-zinc-100 p-1.5 dark:divide-zinc-800")}>
                {decks.map((deck) => (
                  <div
                    key={deck.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/30">
                      <Layers className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {deck.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                        <span>
                          {deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
                        </span>
                        {deck.dueCount > 0 ? (
                          <span className="font-semibold text-brand-700 dark:text-brand-400">
                            · {deck.dueCount} due now
                          </span>
                        ) : (
                          <span>· nothing due</span>
                        )}
                        {deck.documentId && <span>· from a document</span>}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void startReview(deck.id)}
                        disabled={deck.dueCount === 0}
                        title={
                          deck.dueCount === 0
                            ? "Nothing due — try Review all"
                            : "Review the due cards"
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                          deck.dueCount > 0
                            ? "bg-brand-100 text-brand-800 hover:bg-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25"
                            : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                        )}
                      >
                        <Sparkles className="h-3 w-3" />
                        Review
                      </button>

                      <button
                        type="button"
                        onClick={() => void startReview(deck.id, true)}
                        disabled={deck.cardCount === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        <BookOpen className="h-3 w-3" />
                        All
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteDeck(deck)}
                        disabled={busyDeckId === deck.id}
                        aria-label={`Delete ${deck.title}`}
                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      >
                        {busyDeckId === deck.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
            <ClipboardList className="h-3.5 w-3.5" />
            Reviews are scheduled with SM-2 — again comes back in 10 minutes, good
            after 1 day, then 6, then longer each time.
          </p>
        </>
      )}
    </div>
  );
}
