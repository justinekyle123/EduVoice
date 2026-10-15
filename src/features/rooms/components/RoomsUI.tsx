"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Copy,
  Crown,
  Download,
  FileText,
  History,
  Loader2,
  LogOut,
  Mic,
  Paperclip,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Trophy,
  UserMinus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createStudyRoom,
  deleteSharedRoomFile,
  deleteStudyRoom,
  getMyRooms,
  getRoomFiles,
  getRoomMessages,
  getRoomState,
  joinStudyRoom,
  leaveStudyRoom,
  removeRoomMember,
  sendRoomMessage,
} from "../server/actions";
import {
  getRoomLiveLeaderboard,
  getRoomLiveState,
  markRoomReady,
  replayRoomLiveQuiz,
  startManualRoomLiveQuiz,
  startRoomLiveQuiz,
} from "../server/live";
import type { ManualQuestionDraft } from "../lib/manualQuiz";
import { LiveRoomQuiz } from "./LiveRoomQuiz";
import { ManualQuizBuilder } from "./ManualQuizBuilder";

type RoomListRow = Awaited<ReturnType<typeof getMyRooms>>[number];
type RoomState = NonNullable<Awaited<ReturnType<typeof getRoomState>>>;
type RoomMessageRow = Awaited<ReturnType<typeof getRoomMessages>>[number];
type RoomLive = NonNullable<Awaited<ReturnType<typeof getRoomLiveState>>>;
type LiveStandingRow = Awaited<
  ReturnType<typeof getRoomLiveLeaderboard>
>[number];
type RoomFileRow = Awaited<ReturnType<typeof getRoomFiles>>[number];

/** How often the room notices that a live quiz was started or ended. Kept short
 * so members see a new round (and can ready up) within a couple of seconds. */
const LIVE_POLL_MS = 2_000;
const LIVE_COUNTS = [3, 5, 8, 10, 15];
const LIVE_DURATIONS = [15, 20, 30, 45, 60];
/** Matches MIN_LIVE_PLAYERS in server/live.ts: a round needs a competition. */
const MIN_LIVE_PLAYERS = 2;

// Chat is polled often because people expect it to feel live; the member list
// and leaderboard move slowly, so they refresh less often. Both pause while the
// tab is hidden — polling against a scale-to-zero Postgres from a tab nobody is
// looking at is the one easy way to burn through free compute.
const MESSAGES_INTERVAL_MS = 3_000;
const STATE_INTERVAL_MS = 10_000;

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";

/** "AB12CD" → "AB12 CD" so codes are easier to read back over a call. */
function prettyCode(code: string) {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function initialsFor(name: string | null, email: string) {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Which shared files can be a live-quiz source (PDF and plain text — the model
// reads those directly). Kept here (rather than imported from the quiz lib,
// which pulls in server-only AI code) so the source picker can filter client-side.
function isQuizSource(fileName: string, fileType: string) {
  const type = fileType.toLowerCase();
  if (type === "application/pdf" || type.startsWith("text/")) return true;
  const name = fileName.toLowerCase();
  return [".pdf", ".txt", ".md", ".csv"].some((ext) => name.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Room view
// ---------------------------------------------------------------------------

function RoomView({
  roomId,
  onLeave,
}: {
  roomId: string;
  onLeave: (deleted?: boolean) => void;
}) {
  const [state, setState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<RoomMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  // Live voice quiz: the room's shared session, and the host's start form.
  const [live, setLive] = useState<RoomLive | null>(null);
  // All-time live-quiz standings for the room, independent of any one session.
  const [liveStandings, setLiveStandings] = useState<LiveStandingRow[]>([]);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveTopic, setLiveTopic] = useState("");
  const [liveCount, setLiveCount] = useState(5);
  const [liveSeconds, setLiveSeconds] = useState(30);
  const [startingLive, setStartingLive] = useState(false);
  // Source for the next live quiz: null means "write it from the topic".
  const [liveFileId, setLiveFileId] = useState<string | null>(null);
  // The host can write the quiz by hand instead of auto-generating it.
  const [manualOpen, setManualOpen] = useState(false);
  // Files the host has shared, and the upload in flight.
  const [files, setFiles] = useState<RoomFileRow[]>([]);
  const [uploading, setUploading] = useState(false);

  // Cursor for the chat poll: the timestamp of the newest message we hold.
  const cursorRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const quizFileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const [next, standings] = await Promise.all([
        getRoomState(roomId),
        getRoomLiveLeaderboard(roomId),
      ]);
      if (!next) {
        setError("You are no longer a member of this room.");
        return;
      }
      setState(next);
      setLiveStandings(standings);
    } catch (err) {
      setError(errorMessage(err, "Could not load this room"));
    }
  }, [roomId]);

  const refreshFiles = useCallback(async () => {
    try {
      setFiles(await getRoomFiles(roomId));
    } catch {
      // Shared files are an extra panel — a failure here never breaks the room.
    }
  }, [roomId]);

  // Initial load: room state plus the full message history. The component is
  // keyed by room id, so switching rooms remounts with fresh state instead of
  // resetting it here.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [nextState, history, standings, roomFiles] = await Promise.all([
          getRoomState(roomId),
          getRoomMessages(roomId),
          getRoomLiveLeaderboard(roomId),
          getRoomFiles(roomId),
        ]);
        if (cancelled) return;
        if (!nextState) {
          setError("You are no longer a member of this room.");
          return;
        }
        setState(nextState);
        setMessages(history);
        setLiveStandings(standings);
        setFiles(roomFiles);
        cursorRef.current =
          history.length > 0
            ? new Date(history[history.length - 1].createdAt).toISOString()
            : null;
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not load this room"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Poll for new messages.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const rows = await getRoomMessages(roomId, cursorRef.current);
        if (rows.length === 0) return;
        cursorRef.current = new Date(
          rows[rows.length - 1].createdAt
        ).toISOString();
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...rows.filter((m) => !seen.has(m.id))];
        });
      } catch {
        // Transient failures stay silent; the next tick retries.
      }
    }, MESSAGES_INTERVAL_MS);

    return () => clearInterval(id);
  }, [roomId]);

  // Refresh members + leaderboard on a slower cadence.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void refreshState();
    }, STATE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [refreshState]);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await getRoomLiveState(roomId));
    } catch {
      // A live quiz is a bonus surface — never let it break the room.
    }
  }, [roomId]);

  // Watch for a live quiz starting (or ending) so members can join it. The state
  // lands in a promise callback, matching the other fetch-on-mount effects here.
  useEffect(() => {
    let cancelled = false;
    getRoomLiveState(roomId)
      .then((next) => {
        if (!cancelled) setLive(next);
      })
      .catch(() => {
        // A live quiz is a bonus surface — never let it break the room.
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    const id = setInterval(() => {
      // The open overlay polls this same state every second; polling here too
      // only doubles the work while nobody can see this panel. Closing the
      // overlay refreshes it instead.
      if (document.hidden || liveOpen) return;
      void refreshLive();
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [refreshLive, liveOpen]);

  async function handleStartLive(event: React.FormEvent) {
    event.preventDefault();
    // A file names the subject on its own; otherwise a topic is required.
    if ((!liveTopic.trim() && !liveFileId) || startingLive) return;
    setStartingLive(true);
    setError(null);
    try {
      await startRoomLiveQuiz({
        roomId,
        topic: liveTopic,
        count: liveCount,
        questionSeconds: liveSeconds,
        fileId: liveFileId,
      });
      setLiveTopic("");
      setLiveFileId(null);
      await refreshLive();
      setLiveOpen(true);
    } catch (err) {
      setError(errorMessage(err, "Could not start the live quiz"));
    } finally {
      setStartingLive(false);
    }
  }

  /** Shared upload used by both the chat paperclip and the live-quiz file picker. */
  async function uploadRoomFile(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`/api/rooms/${roomId}/files`, {
      method: "POST",
      body,
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      file?: { id: string };
    } | null;
    if (!response.ok) {
      throw new Error(data?.error ?? "The file could not be uploaded");
    }
    await refreshFiles();
    return data?.file ?? null;
  }

  /** Pull anything an upload posted into the chat, past our cursor. */
  async function pullNewMessages() {
    const rows = await getRoomMessages(roomId, cursorRef.current);
    if (rows.length === 0) return;
    cursorRef.current = new Date(rows[rows.length - 1].createdAt).toISOString();
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...rows.filter((m) => !seen.has(m.id))];
    });
  }

  /** Host-only: run the room's most recent quiz again as a fresh session. */
  async function handleReplay() {
    setStartingLive(true);
    setError(null);
    try {
      await replayRoomLiveQuiz({ roomId });
      await refreshLive();
      setLiveOpen(true);
    } catch (err) {
      setError(errorMessage(err, "Could not repeat the last quiz"));
    } finally {
      setStartingLive(false);
    }
  }

  /** Host-only: open a waiting room for a hand-written quiz. */
  async function handleStartManual(
    questions: ManualQuestionDraft[],
    title: string
  ) {
    setStartingLive(true);
    setError(null);
    try {
      await startManualRoomLiveQuiz({
        roomId,
        title,
        questionSeconds: liveSeconds,
        questions,
      });
      setManualOpen(false);
      await refreshLive();
      setLiveOpen(true);
    } catch (err) {
      setError(errorMessage(err, "Could not start the live quiz"));
    } finally {
      setStartingLive(false);
    }
  }

  /** Host-only: share a study file with the room (it lands in the chat too). */
  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;

    setUploading(true);
    setError(null);
    try {
      await uploadRoomFile(file);
      await pullNewMessages();
      setNotice(`${file.name} is now shared with the room.`);
    } catch (err) {
      setError(errorMessage(err, "The file could not be uploaded"));
    } finally {
      setUploading(false);
    }
  }

  /**
   * Host-only: upload a file straight from the live-quiz form and make it the
   * quiz's source. It is shared with the room like any other file, so members
   * can download the material the questions were written from.
   */
  async function handleQuizFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;

    setUploading(true);
    setError(null);
    try {
      const saved = await uploadRoomFile(file);
      await pullNewMessages();
      if (saved?.id) {
        setLiveFileId(saved.id);
        setNotice(`${file.name} uploaded — the live quiz will be written from it.`);
      }
    } catch (err) {
      setError(errorMessage(err, "The file could not be uploaded"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!window.confirm("Remove this shared file?")) return;
    try {
      await deleteSharedRoomFile({ roomId, fileId });
      await refreshFiles();
    } catch (err) {
      setError(errorMessage(err, "Could not remove the file"));
    }
  }

  async function handleRemoveMember(userId: string, label: string) {
    if (!window.confirm(`Remove ${label} from this room?`)) return;
    try {
      await removeRoomMember({ roomId, userId });
      await refreshState();
      await refreshLive();
    } catch (err) {
      setError(errorMessage(err, "Could not remove that member"));
    }
  }

  async function handleReady(ready: boolean) {
    try {
      await markRoomReady({ roomId, ready });
      await refreshLive();
    } catch (err) {
      setError(errorMessage(err, "Could not update your ready state"));
    }
  }

  // Keep the newest message in view.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const content = composer.trim();
    if (!content || sending) return;

    setSending(true);
    setError(null);
    try {
      const message = await sendRoomMessage({ roomId, content });
      setComposer("");
      if (message) {
        const [row] = await getRoomMessages(roomId, cursorRef.current);
        if (row) {
          cursorRef.current = new Date(row.createdAt).toISOString();
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row]
          );
        }
      }
    } catch (err) {
      setError(errorMessage(err, "Message could not be sent"));
    } finally {
      setSending(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setNotice("Join code copied — share it with your classmates.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the code — copy it manually.");
    }
  }

  async function handleLeave() {
    if (!window.confirm("Leave this study room?")) return;
    await leaveStudyRoom(roomId);
    onLeave();
  }

  async function handleDelete() {
    if (!window.confirm("Delete this room for everyone? This cannot be undone.")) {
      return;
    }
    await deleteStudyRoom(roomId);
    onLeave(true);
  }

  if (loading) {
    return (
      <div className={cn(panel, "flex min-h-[60vh] items-center justify-center")}>
        <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening room…
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
        <button type="button" onClick={() => onLeave()} className={primaryButton}>
          <ArrowLeft className="h-4 w-4" />
          Back to rooms
        </button>
      </div>
    );
  }

  const isOwner = state.myRole === "owner";
  const liveActive = live !== null && live.session.status !== "ended";
  const liveLobby = live?.session.status === "lobby";
  const livable = files.filter((file) => isQuizSource(file.fileName, file.fileType));
  const fileFor = (id: string) => files.find((file) => file.id === id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={cn(panel, "p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onLeave()}
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All rooms
            </button>
            <h2 className="truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {state.room.name}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {state.members.length}{" "}
              {state.members.length === 1 ? "member" : "members"} · you are{" "}
              {isOwner ? "the owner" : "a member"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy(state.room.joinCode)}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              title="Copy the join code"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span className="font-mono tracking-wider">
                {prettyCode(state.room.joinCode)}
              </span>
            </button>
            <Link
              href={`/dashboard/rooms/${roomId}/history`}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <History className="h-4 w-4" />
              History & scores
            </Link>
            {isOwner ? (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLeave}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <LogOut className="h-4 w-4" />
                Leave
              </button>
            )}
          </div>
        </div>

        {notice && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}
      </div>

      {/* Live voice quiz — everyone answers the same question at the same time */}
      <section className={cn(panel, "p-5")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Radio className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              Live voice quiz
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              The whole room gets the same question at the same moment. EduVoice
              reads it out loud — you answer with your voice.
            </p>
          </div>

          {liveActive && (
            <button
              type="button"
              onClick={() => setLiveOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg"
            >
              <Play className="h-4 w-4" />
              {liveLobby ? "Join waiting room" : "Join live quiz"}
            </button>
          )}
        </div>

        {liveActive && live && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs text-brand-900 dark:bg-brand-500/10 dark:text-brand-200">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {liveLobby ? "Waiting room" : "In progress"}
            </span>
            {liveLobby ? (
              <span>
                {live.readyUserIds.length} of{" "}
                {Math.max(live.memberCount - 1, 0)} ready ·{" "}
                {live.session.questionCount} questions
              </span>
            ) : (
              <>
                <span>
                  Question {live.session.currentIndex + 1} of {live.session.questionCount}
                </span>
                <span>
                  {live.answeredCount} of {live.memberCount} answered
                </span>
              </>
            )}
            {live.isHost && <span className="font-medium">· you are hosting</span>}
            {liveLobby && !live.isHost && (
              <button
                type="button"
                onClick={() => void handleReady(!live.myReady)}
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  live.myReady
                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950"
                )}
              >
                {live.myReady ? "Ready" : "I'm ready"}
              </button>
            )}
          </div>
        )}

        {!liveActive && isOwner && live && live.session.status === "ended" && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void handleReplay()}
              disabled={startingLive || state.members.length < MIN_LIVE_PLAYERS}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-500/20"
            >
              {startingLive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Repeat last quiz — {live.title}
            </button>
          </div>
        )}

        {!liveActive && isOwner && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setManualOpen((value) => !value)}
              className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
            >
              {manualOpen
                ? "← Back to auto-generate (topic or file)"
                : "or write the quiz manually →"}
            </button>
          </div>
        )}

        {!liveActive && isOwner && manualOpen && (
          <ManualQuizBuilder
            durations={LIVE_DURATIONS}
            seconds={liveSeconds}
            onSecondsChange={setLiveSeconds}
            busy={startingLive}
            onSubmit={handleStartManual}
            roomId={roomId}
          />
        )}

        {!liveActive && isOwner && !manualOpen && (
          <form
            onSubmit={handleStartLive}
            className="mt-4 flex flex-wrap items-center gap-2"
          >
            <input
              value={liveTopic}
              onChange={(event) => setLiveTopic(event.target.value)}
              placeholder={
                liveFileId ? "Optional focus — e.g. Chapter 3" : "Topic — e.g. Cell division"
              }
              maxLength={200}
              aria-label="Live quiz topic"
              className={cn(field, "min-w-[12rem] flex-1")}
            />
            {livable.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Source
                <select
                  value={liveFileId ?? ""}
                  onChange={(event) => setLiveFileId(event.target.value || null)}
                  aria-label="Live quiz source"
                  className="max-w-[11rem] rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="">Topic</option>
                  {livable.map((file) => (
                    <option key={file.id} value={file.id}>
                      File — {file.fileName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <input
              ref={quizFileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv"
              onChange={handleQuizFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => quizFileInputRef.current?.click()}
              disabled={uploading || startingLive}
              title="Upload a file to write the quiz from"
              aria-label="Upload a file for quiz generation"
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              Upload file
            </button>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Questions
              <select
                value={liveCount}
                onChange={(event) => setLiveCount(Number(event.target.value))}
                aria-label="Number of questions"
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {LIVE_COUNTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Seconds each
              <select
                value={liveSeconds}
                onChange={(event) => setLiveSeconds(Number(event.target.value))}
                aria-label="Seconds per question"
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {LIVE_DURATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={
                startingLive ||
                (!liveFileId && liveTopic.trim().length < 3) ||
                state.members.length < MIN_LIVE_PLAYERS
              }
              className={primaryButton}
            >
              {startingLive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              Start live quiz
            </button>
          </form>
        )}

        {!liveActive && isOwner && state.members.length < MIN_LIVE_PLAYERS && (
          <p className="mt-3 text-xs leading-5 text-amber-600 dark:text-amber-400">
            A live quiz needs at least {MIN_LIVE_PLAYERS} members — share your
            join code and wait for a classmate to join.
          </p>
        )}

        {!liveActive && isOwner && !manualOpen && liveFileId && (
          <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            The live quiz will be written from{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {fileFor(liveFileId)?.fileName ?? "the selected file"}
            </span>
            .
          </p>
        )}

        {!liveActive && !isOwner && (
          <p className="mt-3 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
            Waiting for the host to start a round.
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Chat */}
        <section className={cn(panel, "flex flex-col lg:col-span-3")}>
          <header className="flex items-center justify-between border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Users className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              Room chat
            </h3>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <RefreshCw className="h-3 w-3" />
              Live
            </span>
          </header>

          <div
            ref={scrollRef}
            className="min-h-[320px] flex-1 space-y-3 overflow-y-auto px-5 py-4 lg:max-h-[46vh]"
          >
            {messages.length === 0 ? (
              <p className="py-10 text-center text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                No messages yet. Say hello and start quizzing each other.
              </p>
            ) : (
              messages.map((message) => {
                const mine = message.userId === state.viewerId;
                return (
                  <div
                    key={message.id}
                    className={cn("flex gap-2.5", mine && "flex-row-reverse")}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        mine
                          ? "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950"
                          : "bg-zinc-400 text-white dark:bg-zinc-600"
                      )}
                      title={message.name ?? message.email}
                    >
                      {initialsFor(message.name, message.email)}
                    </span>
                    <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {mine ? "You" : message.name ?? message.email} ·{" "}
                        {new Date(message.createdAt).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      {message.fileId ? (
                        <div
                          className={cn(
                            "mt-1 inline-flex max-w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left ring-1",
                            mine
                              ? "bg-brand-50 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30"
                              : "bg-zinc-100 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
                          )}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">
                            <FileText className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {message.content}
                            </span>
                            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                              {fileFor(message.fileId)?.fileSize !== undefined
                                ? `${formatBytes(fileFor(message.fileId)!.fileSize)} · shared file`
                                : "Shared file"}
                            </span>
                          </span>
                          <a
                            href={`/api/rooms/${roomId}/files/${message.fileId}`}
                            download
                            title="Download"
                            aria-label={`Download ${message.content}`}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-zinc-600 transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteFile(message.fileId as string)}
                              title="Remove this file"
                              aria-label="Remove this file"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <p
                          className={cn(
                            "mt-1 inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                            mine
                              ? "bg-brand-400 text-brand-950"
                              : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                          )}
                        >
                          {message.content}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 border-t border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800"
          >
            {isOwner && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv"
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Share a file with the room"
                  aria-label="Share a file with the room"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </button>
              </>
            )}
            <input
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Message the room…"
              className={field}
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={sending || composer.trim().length === 0}
              className={primaryButton}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="sr-only">Send</span>
            </button>
          </form>
        </section>

        {/* Leaderboard + members */}
        <div className="space-y-4 lg:col-span-2">
          <section className={cn(panel, "p-5")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Trophy className="h-4 w-4 text-amber-500" />
              Room leaderboard
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              Ranked by accuracy across quizzes finished in this room.
            </p>

            {state.leaderboard.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-xs leading-5 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                Nobody has finished a quiz in this room yet.
              </p>
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
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        entry.rank === 1
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                      )}
                    >
                      {entry.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {entry.name ?? entry.email}
                        {entry.userId === state.viewerId && (
                          <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                            you
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {entry.attempts}{" "}
                        {entry.attempts === 1 ? "quiz" : "quizzes"} · best{" "}
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

            {state.idleMembers.length > 0 && (
              <p className="mt-3 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
                Waiting on{" "}
                {state.idleMembers
                  .map((member) => member.name ?? member.email)
                  .join(", ")}
              </p>
            )}

            <Link
              href={`/dashboard/quiz?room=${roomId}`}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg"
            >
              <ClipboardList className="h-4 w-4" />
              Take a room quiz
            </Link>
          </section>

          {/* Leaderboard built from the live voice quizzes */}
          <section className={cn(panel, "p-5")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Radio className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              Live voice quiz leaderboard
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              Ranked by accuracy across every live voice quiz in this room —
              ties go to the faster voice.
            </p>

            {liveStandings.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-xs leading-5 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                Nobody has played a live voice quiz yet. Start one above to
                open the board.
              </p>
            ) : (
              <ol className="mt-4 space-y-2">
                {liveStandings.map((row) => (
                  <li
                    key={row.userId}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5",
                      row.userId === state.viewerId
                        ? "bg-brand-50 dark:bg-brand-500/10"
                        : "bg-zinc-50 dark:bg-zinc-800/60"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        row.rank === 1
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                      )}
                    >
                      {row.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {row.name ?? row.email}
                        {row.userId === state.viewerId && (
                          <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                            you
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {row.rounds} {row.rounds === 1 ? "round" : "rounds"} ·{" "}
                        {row.correct}/{row.answered} correct
                        {row.avgMs !== null && (
                          <>
                            {" "}
                            · avg {(row.avgMs / 1000).toFixed(1)}s
                          </>
                        )}
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

          <section className={cn(panel, "p-5")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Users className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              Members
            </h3>
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
                    <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  {isOwner && member.role !== "owner" && (
                    <button
                      type="button"
                      onClick={() =>
                        void handleRemoveMember(
                          member.userId,
                          member.name ?? member.email
                        )
                      }
                      title="Remove from the room"
                      aria-label={`Remove ${member.name ?? member.email}`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {liveOpen && (
        <LiveRoomQuiz
          roomId={roomId}
          onClose={() => {
            setLiveOpen(false);
            // The final results land on the leaderboard as the session closes,
            // so refresh both the session and the standing behind it.
            void refreshLive();
            void refreshState();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export function RoomsUI({ initialRoomId }: { initialRoomId?: string | null }) {
  const [rooms, setRooms] = useState<RoomListRow[]>([]);
  // A `?room=<id>` deep link (the history page's repeat sends you back here)
  // opens that room instead of the list.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(
    initialRoomId ?? null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      setRooms(await getMyRooms());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Could not load your study rooms"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Mirrors the chat sidebar's fetch-on-mount: the state lands in a promise
  // callback, so nothing is set synchronously while the effect runs.
  useEffect(() => {
    let cancelled = false;
    getMyRooms()
      .then((list) => {
        if (cancelled) return;
        setRooms(list);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load your study rooms"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || busy) return;

    setBusy("create");
    setError(null);
    try {
      const room = await createStudyRoom({ name: newName });
      setNewName("");
      await loadRooms();
      if (room) setActiveRoomId(room.id);
    } catch (err) {
      setError(errorMessage(err, "Could not create the room"));
    } finally {
      setBusy(null);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (!joinCode.trim() || busy) return;

    setBusy("join");
    setError(null);
    try {
      const room = await joinStudyRoom(joinCode);
      setJoinCode("");
      await loadRooms();
      if (room) setActiveRoomId(room.id);
    } catch (err) {
      setError(errorMessage(err, "Could not join that room"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {activeRoomId ? (
        <motion.div
          key="room"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <RoomView
            key={activeRoomId}
            roomId={activeRoomId}
            onLeave={async () => {
              setActiveRoomId(null);
              await loadRooms();
            }}
          />
        </motion.div>
      ) : (
        <motion.div
          key="lobby"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Collaborative study rooms
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Study the same material as your classmates, run a live voice quiz
              where everyone answers the same question at once, and compete on a
              shared leaderboard built from everyone&apos;s results.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form onSubmit={handleCreate} className={cn(panel, "space-y-3 p-5")}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Plus className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                Create a room
              </h2>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. Finals review — Biology"
                className={field}
                maxLength={80}
              />
              <button
                type="submit"
                disabled={busy !== null || newName.trim().length === 0}
                className={cn(primaryButton, "w-full")}
              >
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create room
              </button>
            </form>

            <form onSubmit={handleJoin} className={cn(panel, "space-y-3 p-5")}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Users className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                Join with a code
              </h2>
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                className={cn(field, "font-mono tracking-widest")}
                maxLength={12}
              />
              <button
                type="submit"
                disabled={busy !== null || joinCode.trim().length === 0}
                className={cn(primaryButton, "w-full")}
              >
                {busy === "join" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Users className="h-4 w-4" />
                )}
                Join room
              </button>
            </form>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
              {error}
            </p>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Your rooms
            </h2>

            {loading ? (
              <div className={cn(panel, "flex items-center justify-center py-14")}>
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : rooms.length === 0 ? (
              <div
                className={cn(
                  panel,
                  "flex flex-col items-center justify-center border-dashed px-6 py-14 text-center"
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
                  <Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                </span>
                <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  No rooms yet
                </p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Create one and share its join code, or enter a code a
                  classmate sent you.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setActiveRoomId(room.id)}
                    className={cn(
                      panel,
                      "group p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-950/[0.08] dark:hover:border-brand-500/40"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {room.name}
                      </p>
                      {room.role === "owner" && (
                        <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {room.memberCount}{" "}
                      {room.memberCount === 1 ? "member" : "members"}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 font-mono text-[11px] tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {prettyCode(room.joinCode)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
