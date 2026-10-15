"use client";

// Room history (feature 6.13) — the read-only counterpart to the live room.
//
// Where the room view is about what's happening now, this page is the record:
// every quiz attempt that counted for the room, every finished live voice round
// with its per-player scores, and both leaderboards (the async quiz board and
// the live voice board). Members only; the server actions return nothing to a
// non-member.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Loader2,
  Radio,
  FileText,
  RotateCcw,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getRoomAttempts,
  getRoomFiles,
  getRoomState,
} from "../server/actions";
import {
  getRoomLiveHistory,
  getRoomLiveLeaderboard,
  replayRoomLiveQuiz,
} from "../server/live";

type RoomState = NonNullable<Awaited<ReturnType<typeof getRoomState>>>;
type AttemptRow = Awaited<ReturnType<typeof getRoomAttempts>>[number];
type FileRow = Awaited<ReturnType<typeof getRoomFiles>>[number];
type StandingRow = Awaited<ReturnType<typeof getRoomLiveLeaderboard>>[number];
type LiveRound = Awaited<ReturnType<typeof getRoomLiveHistory>>[number];

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function initialsFor(name: string | null, email: string) {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function formatWhen(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RoomHistory({ roomId }: { roomId: string }) {
  const [state, setState] = useState<RoomState | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Replay of a finished live round: which one is opening, and why it failed.
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const [nextState, nextAttempts, nextFiles, nextStandings, nextRounds] =
      await Promise.all([
        getRoomState(roomId),
        getRoomAttempts(roomId),
        getRoomFiles(roomId),
        getRoomLiveLeaderboard(roomId),
        getRoomLiveHistory(roomId),
      ]);
    return { nextState, nextAttempts, nextFiles, nextStandings, nextRounds };
  }, [roomId]);

  /** Host-only: reopen a finished round's waiting room for the whole room. */
  async function repeatRound(round: LiveRound) {
    if (replaySessionId) return;
    setReplaySessionId(round.sessionId);
    setReplayError(null);
    try {
      await replayRoomLiveQuiz({ roomId, quizId: round.quizId });
      // No route per room — the list takes a `?room=` deep link.
      router.push(`/dashboard/rooms?room=${roomId}`);
    } catch (err) {
      setReplayError(errorMessage(err, "Could not repeat that quiz"));
    } finally {
      setReplaySessionId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        if (!data.nextState) {
          setError("You are no longer a member of this room.");
          return;
        }
        setState(data.nextState);
        setAttempts(data.nextAttempts);
        setFiles(data.nextFiles);
        setStandings(data.nextStandings);
        setRounds(data.nextRounds);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load the room history"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) {
    return (
      <div className={cn(panel, "flex min-h-[50vh] items-center justify-center")}>
        <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading room history…
        </span>
      </div>
    );
  }

  if (!state) {
    return (
      <div className={cn(panel, "space-y-4 p-6")}>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {error ?? "This room is unavailable."}
        </p>
        <Link
          href="/dashboard/rooms"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to rooms
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
    >
      <div>
        <Link
          href={`/dashboard/rooms?room=${roomId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the room
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {state.room.name} — history &amp; scores
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {state.members.length} {state.members.length === 1 ? "member" : "members"} ·
          every quiz attempt, live round, and leaderboard for this room.
        </p>
      </div>

      {/* Leaderboards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn(panel, "p-5")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Trophy className="h-4 w-4 text-amber-500" />
            Quiz leaderboard
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            Ranked by accuracy across quizzes finished in this room.
          </p>
          {state.leaderboard.length === 0 ? (
            <EmptyLine text="No finished quizzes yet." />
          ) : (
            <ol className="mt-4 space-y-2">
              {state.leaderboard.map((entry) => (
                <li
                  key={entry.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5",
                    entry.userId === state.viewerId
                      ? "bg-brand-50 dark:bg-brand-500/10"
                      : "bg-zinc-50 dark:bg-zinc-800/60"
                  )}
                >
                  <RankBadge rank={entry.rank} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {entry.name ?? entry.email}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {entry.attempts} {entry.attempts === 1 ? "quiz" : "quizzes"} · best{" "}
                      {entry.best}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {Math.round(entry.accuracy * 100)}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={cn(panel, "p-5")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Radio className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            Live voice quiz leaderboard
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            Ranked by accuracy across every live voice quiz — ties go to the faster voice.
          </p>
          {standings.length === 0 ? (
            <EmptyLine text="No live voice rounds yet." />
          ) : (
            <ol className="mt-4 space-y-2">
              {standings.map((row) => (
                <li
                  key={row.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5",
                    row.userId === state.viewerId
                      ? "bg-brand-50 dark:bg-brand-500/10"
                      : "bg-zinc-50 dark:bg-zinc-800/60"
                  )}
                >
                  <RankBadge rank={row.rank} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {row.name ?? row.email}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {row.rounds} {row.rounds === 1 ? "round" : "rounds"} · {row.correct}/
                      {row.answered} correct
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {Math.round(row.accuracy * 100)}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Members + shared files */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn(panel, "p-5")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Users className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            Members
          </h2>
          <ul className="mt-3 space-y-2">
            {state.members.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-[10px] font-semibold text-white dark:bg-zinc-600">
                  {initialsFor(member.name, member.email)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {member.name ?? member.email}
                </span>
                {member.role === "owner" && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    host
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className={cn(panel, "p-5")}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <FileText className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            Shared files
          </h2>
          {files.length === 0 ? (
            <EmptyLine text="The host hasn't shared any files yet." />
          ) : (
            <ul className="mt-3 space-y-2">
              {files.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/rooms/${roomId}/files/${file.id}`}
                    className="flex items-center gap-2.5 rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                    <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                      {formatBytes(file.fileSize)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Live rounds */}
      <section className={cn(panel, "p-5")}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Radio className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          Live voice rounds
        </h2>
        {replayError && (
          <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {replayError}
          </p>
        )}
        {rounds.length === 0 ? (
          <EmptyLine text="No live voice rounds have finished yet." />
        ) : (
          <ul className="mt-4 space-y-3">
            {rounds.map((round) => (
              <li
                key={round.sessionId}
                className="rounded-2xl border border-zinc-200/70 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {round.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {round.questionCount} questions · {formatWhen(round.endedAt)}
                    </span>
                    {state.myRole === "owner" && (
                      <button
                        type="button"
                        onClick={() => void repeatRound(round)}
                        disabled={replaySessionId !== null}
                        aria-label={`Play again: ${round.title}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
                      >
                        {replaySessionId === round.sessionId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Play again
                      </button>
                    )}
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {round.players.map((player) => (
                    <li
                      key={player.userId}
                      className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-[10px] font-semibold text-white dark:bg-zinc-600">
                        {initialsFor(player.name, player.email)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {player.name ?? player.email}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {player.correct}/{player.answered}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quiz attempt history */}
      <section className={cn(panel, "p-5")}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <ClipboardList className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          Quiz history
        </h2>
        {attempts.length === 0 ? (
          <EmptyLine text="Nobody has finished a quiz in this room yet." />
        ) : (
          <ul className="mt-4 space-y-2">
            {attempts.map((attempt) => {
              const perfect =
                attempt.totalQuestions > 0 &&
                attempt.score === attempt.totalQuestions;
              return (
                <li
                  key={attempt.id}
                  className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/60"
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      perfect
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                    )}
                  >
                    {perfect ? <Check className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {attempt.name ?? attempt.email}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                      {attempt.title} · {formatWhen(attempt.completedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/dashboard/quiz?room=${roomId}&retake=${attempt.quizId}`
                      )
                    }
                    aria-label={`Repeat ${attempt.title}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Repeat
                  </button>
                  <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {attempt.score}/{attempt.totalQuestions}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </motion.div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        rank === 1
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
      )}
    >
      {rank}
    </span>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-xs leading-5 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
      {text}
    </p>
  );
}
