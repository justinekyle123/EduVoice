"use client";

// Live room quiz (feature 6.13) — the shared, voice-answered room quiz surface.
//
// The whole room answers the same question at the same time. The question is
// shown as text and read aloud by the narrator, and the student answers by
// voice; a typed box keeps it usable when the mic is unavailable (or the room is
// too loud). Everything is driven by the session clock from the server, so the
// countdown and the phase match on every screen.
//
// The per-question answering state lives in `AnswerPanel`, keyed by the session
// and question index: React remounts it for each new question, so the transcript,
// the lock-in, and the timer reset themselves without an effect to clear them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Clock,
  Crown,
  Eye,
  Loader2,
  Mic,
  Play,
  SkipForward,
  Square,
  Trophy,
  UserMinus,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/features/chat/hooks/useSpeechSynthesis";
import { getSpeechEngine } from "@/features/chat/lib/speechEngine";
import { DEFAULT_TTS_VOICE } from "@/features/chat/lib/voices";
import { detectLanguage, speechLangFor } from "@/features/chat/lib/detect";
import { MicOrb, type MicStage } from "@/features/quiz/components/MicOrb";
import { optionLetter } from "@/features/quiz/lib/narration";
import { resolveSpokenAnswer, spokenAnswerLabel } from "../lib/voiceAnswer";
import { liveProgress } from "../lib/live";
import { liveQuestionNarration } from "../lib/narration";
import {
  endRoomLiveSession,
  getRoomLiveState,
  markRoomReady,
  nextRoomLiveQuestion,
  replayRoomLiveQuiz,
  revealRoomLiveQuestion,
  startRoomLiveSession,
  submitRoomLiveAnswer,
  type RoomLiveState,
} from "../server/live";
import { removeRoomMember } from "../server/actions";

/** How often the shared state is re-read. Kept short so a question opens (and
 * is read aloud) close to the moment the server starts its clock. */
const POLL_MS = 1_000;
/**
 * Quiet time after the last recognised word before the answer is sent. Short on
 * purpose — the quiz page's voice player marks an answer this quickly, and a
 * room answer that takes longer to leave the mic reads as a frozen question.
 */
const AUTO_SUBMIT_MS = 900;
/**
 * How long after a question clip stops its last words are ignored. Chrome
 * finalizes an utterance on the silence just after audio ends, so without this
 * the clip would be heard as the student's answer.
 */
const CLIP_ECHO_GUARD_MS = 1_200;
/** The card the quiz page's voice player wears; the room quiz wears it too. */
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

/**
 * The line the narrator reads for a question. Only the question itself is
 * spoken — the choices stay on screen, where a student can read them at their
 * own pace, and leaving them out keeps the spoken lead-in short so answering
 * can start immediately.
 */
export function narrationFor(state: RoomLiveState): string | null {
  if (!state.question || state.session.status === "ended") return null;
  const { position, total } = liveProgress(state.session);
  // The very words the server rendered into the question's clip.
  return liveQuestionNarration(state.question, position, total);
}

export function LiveRoomQuiz({
  roomId,
  onClose,
}: {
  roomId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<RoomLiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  // Server-clock offset so the local countdown matches everyone else's.
  const [skewMs, setSkewMs] = useState(0);

  const inFlightRef = useRef(false);
  const narratedRef = useRef<string | null>(null);
  const { speak, speaking, stop: stopSpeaking } = useSpeechSynthesis();

  // A host-dropped clip (manual quiz) plays instead of the TTS read-aloud. One
  // element is reused for the whole session so a new question's audio can't
  // overlap the previous clip.
  const clipRef = useRef<HTMLAudioElement | null>(null);
  /** Recognition is ignored until this moment — the clip's own words, not an answer. */
  const clipQuietUntilRef = useRef(0);

  const stopClip = useCallback(() => {
    const clip = clipRef.current;
    if (!clip) return;
    clip.pause();
    clip.currentTime = 0;
  }, []);

  /**
   * Play the question's uploaded clip. Any load or playback failure — a missing
   * file, a codec the browser can't decode, an autoplay block — falls back to
   * the normal voice, so the question is never silent.
   */
  const playClip = useCallback((url: string, fallback: () => void) => {
    // Silence whatever is still running before the new clip takes over.
    const previous = clipRef.current;
    if (previous) {
      previous.pause();
      previous.currentTime = 0;
    }

    let fellBack = false;
    const toFallback = () => {
      if (fellBack) return;
      fellBack = true;
      fallback();
    };

    // Configure the fresh element first, then hand it to the ref: the ref
    // owns it from that point on and only ever pauses it.
    const clip = new Audio();
    clip.onerror = () => {
      clipQuietUntilRef.current = Date.now() + CLIP_ECHO_GUARD_MS;
      toFallback();
    };
    clip.onended = () => {
      // Chrome finalizes the clip's last words just after it stops; ignore that
      // tail so the question is never submitted as its own answer.
      clipQuietUntilRef.current = Date.now() + CLIP_ECHO_GUARD_MS;
    };
    clip.src = url;
    clipRef.current = clip;
    void clip.play().catch(toFallback);
  }, []);

  /**
   * True while the question's uploaded clip is audible, or was a moment ago. A
   * clip is plain audio, so the recognition hook's own echo guard cannot see it;
   * the answer panel drops what it hears meanwhile instead of submitting the
   * question as the answer.
   */
  const questionAudioAudible = useCallback(
    () =>
      (clipRef.current !== null && !clipRef.current.paused) ||
      Date.now() < clipQuietUntilRef.current,
    []
  );

  // The overlay closing must not leave a clip running behind it. The cleanup
  // goes through stopClip rather than the ref itself, so the element stays
  // owned by the callbacks above.
  useEffect(() => () => stopClip(), [stopClip]);

  const apply = useCallback((next: RoomLiveState | null) => {
    if (!next) {
      setError("This live quiz has ended.");
      return;
    }
    setSkewMs(next.session.serverNowMs - Date.now());
    setState(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      apply(await getRoomLiveState(roomId));
    } catch (err) {
      setError(errorMessage(err, "Could not read the live quiz"));
    } finally {
      inFlightRef.current = false;
    }
  }, [roomId, apply]);

  // Initial load. The state lands in a promise callback, matching the other
  // fetch-on-mount effects in the app.
  useEffect(() => {
    let cancelled = false;
    getRoomLiveState(roomId)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not read the live quiz"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, apply]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Local countdown; re-derived from the server clock on every poll.
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Browsers block audio until the page has had a user gesture, and the question
  // is read automatically. Unlock the shared speech engine on the student's first
  // interaction so the narration is audible instead of silently blocked.
  useEffect(() => {
    const unlock = () => getSpeechEngine().unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const session = state?.session ?? null;
  const status = session?.status ?? "question";
  const questionIndex = session?.currentIndex ?? 0;

  const remaining = useMemo(() => {
    if (!session || status !== "question") return 0;
    const elapsed = clock + skewMs - session.questionStartedAtMs;
    return Math.max(0, session.questionSeconds * 1000 - elapsed);
  }, [session, status, clock, skewMs]);

  // -------------------------------------------------------------------------
  // Narrator
  // -------------------------------------------------------------------------

  // The question's voice belongs to the question: once it closes — everyone has
  // answered, the clock ran out, or the host moved on — the narrator stops, so
  // the read-aloud never talks over the reveal or the next phase.
  useEffect(() => {
    if (status === "question") return;
    stopClip();
    stopSpeaking();
  }, [status, stopClip, stopSpeaking]);

  useEffect(() => {
    if (!state?.question || status === "ended") return;
    const key = `${state.session.id}:${questionIndex}`;
    if (narratedRef.current === key) return;
    narratedRef.current = key;
    const line = narrationFor(state);
    if (!line) return;
    const lang = speechLangFor(detectLanguage(state.question.question));
    const speakLine = () => {
      // Resume the audio context as close to playback as possible; the gesture
      // listener above is what actually clears the browser's autoplay gate.
      getSpeechEngine().unlock();
      speak("live-question", line, lang, DEFAULT_TTS_VOICE, { maxChars: 700 });
    };
    // A clip the host dropped onto this question replaces the read-aloud.
    const clipUrl = state.question.audioUrl;
    if (clipUrl) {
      stopSpeaking();
      playClip(clipUrl, speakLine);
      return;
    }
    stopClip();
    speakLine();
  }, [state, status, questionIndex, speak, playClip, stopClip, stopSpeaking]);

  const readAgain = useCallback(() => {
    if (!state) return;
    const line = narrationFor(state);
    if (!line) return;
    const speakLine = () =>
      speak("live-question", line, "en-PH", DEFAULT_TTS_VOICE, { maxChars: 700 });
    const clipUrl = state.question?.audioUrl ?? null;
    if (clipUrl) {
      stopSpeaking();
      playClip(clipUrl, speakLine);
      return;
    }
    stopClip();
    speakLine();
  }, [state, speak, playClip, stopClip, stopSpeaking]);

  const end = useCallback(() => {
    stopSpeaking();
    stopClip();
    onClose();
  }, [stopSpeaking, stopClip, onClose]);

  // Host-only: run the same quiz again. The server opens a fresh waiting room,
  // and the next poll lands everyone back in the lobby.
  const replay = useCallback(async () => {
    try {
      await replayRoomLiveQuiz({ roomId });
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Could not repeat the quiz"));
    }
  }, [roomId, refresh]);

  const { position, total } = liveProgress(
    session ?? { currentIndex: 0, questionCount: 1 }
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      role="dialog"
      aria-modal="true"
      aria-label="Live room quiz"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-zinc-950"
    >
      {/* Header — the same top panel the quiz page's voice player wears. */}
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-5xl space-y-3">
          <div className={cn(panel, "p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={end}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to room
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden max-w-[16rem] truncate text-xs text-zinc-400 sm:inline dark:text-zinc-500">
                  {state?.title}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                  <Mic className="h-3 w-3" />
                  Live voice quiz
                </span>
                {status !== "lobby" && (
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Question {position} of {total}
                  </span>
                )}
                {status === "question" && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                      remaining <= 5000
                        ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {Math.ceil(remaining / 1000)}s
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {status === "lobby"
                    ? `${state?.readyUserIds.length ?? 0} of ${Math.max((state?.memberCount ?? 1) - 1, 0)} ready`
                    : `${state?.answeredCount ?? 0} of ${state?.memberCount ?? 0} answered`}
                </span>
              </div>
            </div>

            {/* One segment per question — answered, current, or still to come. */}
            {status !== "lobby" && (
              <div
                className="mt-3 flex items-center gap-1.5"
                role="group"
                aria-label="Question progress"
              >
                {Array.from({ length: Math.max(total, 1) }, (_unused, step) => {
                  const done =
                    step < questionIndex || (step === questionIndex && state?.revealed);
                  return (
                    <span
                      key={step}
                      aria-label={`Question ${step + 1}${done ? " — answered" : ""}`}
                      aria-current={step === questionIndex ? "true" : undefined}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-200",
                        step === questionIndex
                          ? "bg-brand-500"
                          : done
                            ? "bg-brand-300 dark:bg-brand-500/50"
                            : "bg-zinc-200 dark:bg-zinc-700"
                      )}
                    />
                  );
                })}
              </div>
            )}

            {state?.isHost && status !== "lobby" && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200/70 pt-3 dark:border-zinc-800">
                {status === "question" && (
                  <button
                    type="button"
                    onClick={() => void revealRoomLiveQuestion(roomId).then(refresh)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Reveal
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void nextRoomLiveQuestion(roomId).then(refresh)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-3 py-1.5 text-xs font-semibold text-brand-950 transition-colors hover:brightness-105"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  {status === "question" ? "Skip" : "Next"}
                </button>
                <button
                  type="button"
                  onClick={() => void endRoomLiveSession(roomId).then(refresh)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <X className="h-3.5 w-3.5" />
                  End
                </button>
              </div>
            )}
          </div>

          {/* Countdown bar */}
          {status === "question" && session && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-brand-400 to-brand-500 transition-[width] duration-200 ease-linear"
                style={{
                  width: `${Math.min(100, (remaining / (session.questionSeconds * 1000)) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : !state ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {error ?? "This live quiz is not available."}
          </p>
          <button
            type="button"
            onClick={end}
            className="rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950"
          >
            Back to room
          </button>
        </div>
      ) : status === "lobby" ? (
        <LiveLobby
          roomId={roomId}
          state={state}
          onRefresh={() => void refresh()}
          onEnd={end}
        />
      ) : status === "ended" ? (
        <FinalBoard
          board={state.board}
          viewerId={state.viewerId}
          onClose={end}
          canReplay={state.isHost}
          onReplay={() => void replay()}
          error={error}
        />
      ) : !state.question ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This live quiz is not available.
          </p>
          <button
            type="button"
            onClick={end}
            className="rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950"
          >
            Back to room
          </button>
        </div>
      ) : (
        <div className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Question + answering */}
          <div className="space-y-4">
            <AnswerPanel
              key={`${state.session.id}:${state.session.currentIndex}`}
              roomId={roomId}
              state={state}
              skewMs={skewMs}
              narrationPlaying={speaking}
              questionAudioAudible={questionAudioAudible}
              onReplayQuestion={readAgain}
              onSubmitted={() => void refresh()}
            />

            {error && (
              <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
                {error}
              </p>
            )}
          </div>

          {/* Live board + this question's answers */}
          <aside className="space-y-4">
            <section className={cn(panel, "p-5")}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Trophy className="h-4 w-4 text-amber-500" />
                Live results
              </h3>
              {state.board.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                  Nobody has answered yet — be first.
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {state.board.map((row) => (
                    <li
                      key={row.userId}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2",
                        row.userId === state.viewerId
                          ? "bg-brand-50 dark:bg-brand-500/10"
                          : "bg-zinc-50 dark:bg-zinc-800/60"
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                        {row.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                        {row.name ?? row.email}
                        {row.userId === state.viewerId && (
                          <span className="ml-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            you
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {row.correct}
                        <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
                          /{state.session.questionCount}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={cn(panel, "p-5")}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Mic className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                This question
              </h3>
              {status === "question" ? (
                <p className="mt-3 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                  {state.answeredCount} of {state.memberCount} have answered. Answers
                  appear here when the question closes.
                </p>
              ) : state.responses.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                  Nobody answered this one.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {state.responses.map((row) => (
                    <li key={row.userId} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white",
                          row.isCorrect ? "bg-emerald-500" : "bg-red-400"
                        )}
                      >
                        {row.isCorrect ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          {initialsFor(row.name, row.email)} ·{" "}
                          {row.userId === state.viewerId ? "You" : row.name ?? row.email}
                        </p>
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          “{row.answer}”
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {/* Screen-reader narration of the live question */}
      <p className="sr-only" aria-live="polite">
        {state?.question ? narrationFor(state) : ""}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Waiting room
// ---------------------------------------------------------------------------

/**
 * The lobby shown before the first question. Every member readies up; the host
 * can only open the quiz once all of them have (and can remove someone who
 * never will). It polls through the same `state` the rest of the surface uses,
 * so a ready press on one screen shows up on everyone else's within a second.
 */
function LiveLobby({
  roomId,
  state,
  onRefresh,
  onEnd,
}: {
  roomId: string;
  state: RoomLiveState;
  onRefresh: () => void;
  onEnd: () => void;
}) {
  const [busy, setBusy] = useState<"ready" | "start" | "remove" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readySet = new Set(state.readyUserIds);
  const required = state.members.filter((member) => member.role !== "owner");
  const readyCount = required.filter((member) => readySet.has(member.userId)).length;

  async function run(
    kind: "ready" | "start" | "remove" | "end",
    action: () => Promise<unknown>
  ) {
    // These buttons are user gestures — the right moment to let the browser
    // start audio, so the first question is read the instant the quiz opens.
    getSpeechEngine().unlock();
    setBusy(kind);
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-5 sm:p-8">
      <div className="w-full max-w-xl space-y-4">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
            <Users className="h-3.5 w-3.5" />
            Waiting room
          </span>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {state.title}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {state.isHost
              ? "Everyone has to press ready before you can start."
              : "Press ready when you're set — the host starts once everyone is ready."}
          </p>
          <p className="mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {readyCount} of {required.length} ready · {state.session.questionCount}{" "}
            questions · {state.session.questionSeconds}s each
          </p>
          {state.voiceClips && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <Volume2 className="h-3 w-3" />
              {state.voiceClips.ready === state.voiceClips.total
                ? `Voice ready for all ${state.voiceClips.total} questions`
                : `${state.voiceClips.ready} of ${state.voiceClips.total} questions voiced — the rest are read live`}
            </p>
          )}
        </div>

        <section className={cn(panel, "p-5")}>
          <ul className="space-y-2">
            {state.members.map((member) => {
              const isHost = member.role === "owner";
              const isReady = readySet.has(member.userId);
              return (
                <li
                  key={member.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3.5 py-2.5",
                    member.userId === state.viewerId
                      ? "bg-brand-50 dark:bg-brand-500/10"
                      : "bg-zinc-50 dark:bg-zinc-800/60"
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-400 text-[11px] font-semibold text-white dark:bg-zinc-600">
                    {initialsFor(member.name, member.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {member.name ?? member.email}
                      {member.userId === state.viewerId && (
                        <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                          you
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {isHost ? "Host" : isReady ? "Ready" : "Waiting…"}
                    </p>
                  </div>

                  {isHost ? (
                    <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : isReady ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <Check className="h-3 w-3" />
                      Ready
                    </span>
                  ) : null}

                  {state.isHost && !isHost && (
                    <button
                      type="button"
                      onClick={() =>
                        run("remove", () =>
                          removeRoomMember({ roomId, userId: member.userId })
                        )
                      }
                      disabled={busy !== null}
                      title="Remove from the room"
                      aria-label={`Remove ${member.name ?? member.email}`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {state.isHost ? (
            <button
              type="button"
              onClick={() => run("start", () => startRoomLiveSession(roomId))}
              disabled={busy !== null || !state.allReady || required.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-5 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "start" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start the quiz
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run("ready", () => markRoomReady({ roomId, ready: !state.myReady }))}
              disabled={busy !== null}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50",
                state.myReady
                  ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-brand-500/25 hover:brightness-105"
              )}
            >
              {busy === "ready" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {state.myReady ? "You're ready — tap to cancel" : "I'm ready"}
            </button>
          )}

          <button
            type="button"
            onClick={onEnd}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to room
          </button>

          {state.isHost && (
            <button
              type="button"
              onClick={() =>
                run("end", async () => {
                  await endRoomLiveSession(roomId);
                  onEnd();
                })
              }
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              {busy === "end" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              Cancel quiz
            </button>
          )}
        </div>

        {state.isHost && !state.allReady && required.length > 0 && (
          <p className="text-center text-xs leading-5 text-amber-600 dark:text-amber-400">
            Waiting for{" "}
            {required
              .filter((member) => !readySet.has(member.userId))
              .map((member) => member.name ?? member.email)
              .join(", ")}{" "}
            to press ready.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answering (one question's worth of state, reset by the key on remount)
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True or false",
  short_answer: "Short answer",
};

/** What the orb is doing, in the words the quiz page's voice player uses. */
const STAGE_VIEW: Record<MicStage, { label: string; hint: string }> = {
  ready: {
    label: "Your turn",
    hint: "The microphone is off — tap it, tap an option, or type your answer.",
  },
  asking: {
    label: "Reading the question…",
    hint: "Listen — the microphone opens with the question.",
  },
  listening: {
    label: "Listening",
    hint: "Say the letter or the words, then pause — or tap an option.",
  },
  judging: {
    label: "Checking that answer…",
    hint: "One moment while the answer is marked.",
  },
  verdict: {
    label: "Here's how that went",
    hint: "The host moves the room on.",
  },
  finished: {
    label: "Answer locked in",
    hint: "Waiting for the room…",
  },
};

/** Recognition languages the browser almost never serves, and the closest it does. */
const LANG_FALLBACK: Record<string, string> = {
  "ceb-PH": "fil-PH",
  "fil-PH": "en-PH",
};

const optionButton =
  "flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left text-sm transition-all duration-200";
const quietButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800";
const sendButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";

function AnswerPanel({
  roomId,
  state,
  skewMs,
  narrationPlaying,
  questionAudioAudible,
  onReplayQuestion,
  onSubmitted,
}: {
  roomId: string;
  state: RoomLiveState;
  skewMs: number;
  /** True while the narrator is still reading the question aloud. */
  narrationPlaying: boolean;
  /** True while a host-uploaded question clip is playing (or just stopped). */
  questionAudioAudible: () => boolean;
  onReplayQuestion: () => void;
  onSubmitted: () => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [draft, setDraft] = useState("");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState<{ answer: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to reopen the mic after Chrome ends a recognition session by itself.
  const [micSession, setMicSession] = useState(0);

  const draftRef = useRef("");
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentRef = useRef(false);
  // The live interim buffer lives in the recognition hook, which is declared
  // below the handlers that need it; this ref is how they reach it.
  const getInterimRef = useRef<() => string>(() => "");
  // The recognition language last tried for this question, so a rejected
  // Cebuano/Filipino question settles on one the browser serves instead of
  // cycling back to the one it just refused.
  const langRef = useRef<{ question: string; lang: string } | null>(null);

  const question = state.question;
  const answered = Boolean(state.myAnswer);
  const open = state.session.status === "question" && !answered;
  const myAnswer = locked?.answer ?? state.myAnswer ?? "";

  const clearQuiet = useCallback(() => {
    if (quietRef.current) {
      clearTimeout(quietRef.current);
      quietRef.current = null;
    }
  }, []);

  const submit = useCallback(
    async (raw: string) => {
      if (!question || !raw.trim() || sentRef.current || !open) return;
      sentRef.current = true;
      clearQuiet();

      const resolved = resolveSpokenAnswer(
        { type: question.type, options: question.options },
        raw
      );

      setSubmitting(true);
      setError(null);
      try {
        const result = await submitRoomLiveAnswer({
          roomId,
          questionIndex: state.session.currentIndex,
          answer: resolved.answer,
          responseMs: Date.now() + skewMs - state.session.questionStartedAtMs,
        });
        if (!result.accepted) {
          sentRef.current = false;
          setError("That question had already closed — hang on for the next one.");
          return;
        }
        setLocked({ answer: resolved.answer, note: spokenAnswerLabel(resolved.source) });
        onSubmitted();
      } catch (err) {
        sentRef.current = false;
        setError(errorMessage(err, "Your answer could not be sent"));
      } finally {
        setSubmitting(false);
      }
    },
    [
      question,
      open,
      clearQuiet,
      roomId,
      skewMs,
      state.session.currentIndex,
      state.session.questionStartedAtMs,
      onSubmitted,
    ]
  );

  /**
   * Everything heard so far: the words the browser committed plus the ones it is
   * still holding as interim. Chrome often keeps a short answer interim and never
   * finalizes it, so waiting for a final result alone is what left a spoken
   * answer unheard on the first question.
   */
  function heardSoFar(liveInterim: string) {
    return `${draftRef.current} ${liveInterim}`.replace(/\s+/g, " ").trim();
  }

  function handleSpoken(finalText: string) {
    if (!open || sentRef.current || questionAudioAudible()) return;
    const trimmed = finalText.trim();
    if (!trimmed) return;
    draftRef.current = `${draftRef.current} ${trimmed}`.replace(/\s+/g, " ").trim();
    setDraft(draftRef.current);
    clearQuiet();
    quietRef.current = setTimeout(
      () => void submit(heardSoFar(getInterimRef.current())),
      AUTO_SUBMIT_MS
    );
  }

  function handleInterim(interimText: string) {
    if (!open || sentRef.current || questionAudioAudible()) return;
    const shown = heardSoFar(interimText);
    if (!shown) return;
    // Show the words at once; the answer itself is read from the live interim
    // buffer when the quiet window closes, so nothing is lost if the browser
    // never commits them.
    setDraft(shown);
    clearQuiet();
    quietRef.current = setTimeout(
      () => void submit(heardSoFar(getInterimRef.current())),
      AUTO_SUBMIT_MS
    );
  }

  const {
    supported,
    listening,
    interim,
    blocked,
    error: recognitionError,
    start,
    stop,
    abort,
    getInterim,
  } = useSpeechRecognition(handleSpoken, handleInterim);

  useEffect(() => {
    getInterimRef.current = getInterim;
  }, [getInterim]);

  const errorCode = recognitionError?.code ?? null;
  const canListen = supported && !blocked && errorCode === null;

  // The mic is open for the whole of an unanswered question, like the quiz
  // page's voice player: the question is read aloud first, and recognition
  // ignores what it hears while EduVoice itself is talking, so the student can
  // answer the moment the reading ends — nothing to tap.
  useEffect(() => {
    if (!micOn || !open || !supported || blocked) {
      abort();
      return;
    }

    // A connection or service error leaves the mic silent until it clears; only
    // a rejected language is worth retrying with a closer one.
    if (errorCode !== null && errorCode !== "language-not-supported") {
      abort();
      return;
    }

    const questionText = question?.question ?? "";
    const previous = langRef.current;
    let attempt =
      previous?.question === questionText
        ? previous.lang
        : speechLangFor(detectLanguage(questionText));

    if (
      errorCode === "language-not-supported" &&
      previous?.question === questionText &&
      previous.lang === attempt
    ) {
      const fallback = LANG_FALLBACK[attempt];
      if (!fallback) {
        abort();
        return;
      }
      attempt = fallback;
    }
    langRef.current = { question: questionText, lang: attempt };

    start(attempt, { continuous: true, keepInterim: true });
    return () => abort();
  }, [
    micOn,
    open,
    supported,
    blocked,
    errorCode,
    start,
    abort,
    question?.question,
    micSession,
  ]);

  // Chrome closes a recognition session after a few seconds of silence. Reopen
  // it while the question still waits, unless an answer is already on its way.
  useEffect(() => {
    if (!micOn || !open || !canListen || listening) return;
    if (quietRef.current || sentRef.current) return;
    const id = setTimeout(() => setMicSession((session) => session + 1), 500);
    return () => clearTimeout(id);
  }, [micOn, open, canListen, listening, micSession]);

  // Leaving the question must not fire a submit timer for it afterwards.
  useEffect(() => () => clearQuiet(), [clearQuiet]);

  const stage: MicStage = submitting
    ? "judging"
    : state.revealed && myAnswer
      ? "verdict"
      : !open
        ? "finished"
        : narrationPlaying
          ? "asking"
          : listening
            ? "listening"
            : "ready";

  const view = STAGE_VIEW[stage];
  // Between questions, a student who did not answer sees why the card is idle.
  const hint =
    !open && !answered && state.session.status !== "question"
      ? "Answers are in — the next question is coming up."
      : view.hint;
  const options = question?.options ?? [];
  const correctAnswer = question?.correctAnswer ?? "";

  return (
    <section className={cn(panel, "p-6 sm:p-8")}>
      {/* The orb states the stage without words, exactly as on the quiz page. */}
      <div className="flex flex-col items-center text-center">
        <MicOrb stage={stage} correct={state.myCorrect} />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
            {TYPE_LABELS[question?.type ?? "multiple_choice"] ?? "Question"}
          </span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{view.label}</span>
        </div>

        <p className="mt-2 max-w-md text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      </div>

      <p className="mt-6 text-lg font-medium leading-8 text-zinc-900 dark:text-zinc-100 sm:text-xl">
        {question?.question}
      </p>

      {/* The options in the same lettered cards the quiz page's voice player
          uses, so both ways of taking a quiz read alike. */}
      {options.length > 0 && (
        <div className="mt-5 space-y-2.5">
          {options.map((option, position) => {
            const isAnswer =
              state.revealed &&
              option.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
            const isMine =
              myAnswer.trim().length > 0 &&
              option.trim().toLowerCase() === myAnswer.trim().toLowerCase();
            return (
              <button
                key={option}
                type="button"
                onClick={() => void submit(option)}
                disabled={!open || submitting}
                className={cn(
                  optionButton,
                  "disabled:cursor-default",
                  isAnswer
                    ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:ring-emerald-500/25"
                    : isMine
                      ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200 dark:border-brand-500/50 dark:bg-brand-500/10 dark:ring-brand-500/25"
                      : "border-zinc-200 hover:border-brand-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold",
                    isAnswer
                      ? "border-emerald-400 bg-emerald-400 text-emerald-950"
                      : isMine
                        ? "border-brand-400 bg-brand-400 text-brand-950"
                        : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                  )}
                >
                  {optionLetter(position)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 leading-6",
                    isAnswer
                      ? "font-medium text-emerald-900 dark:text-emerald-200"
                      : "text-zinc-700 dark:text-zinc-300"
                  )}
                >
                  {option}
                </span>
                {isAnswer && (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {open && (draft || interim) && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-xs leading-5 text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
          <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
          <span className="min-w-0">“{draft || interim}”</span>
        </p>
      )}

      {(locked || state.myAnswer) && (
        <div
          className={cn(
            "mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm ring-1",
            !state.revealed
              ? "bg-brand-50 text-brand-900 ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/30"
              : state.myCorrect
                ? "bg-emerald-50 text-emerald-800 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                : "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              !state.revealed
                ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                : state.myCorrect
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
            )}
          >
            {!state.revealed ? (
              <Clock className="h-3.5 w-3.5" />
            ) : state.myCorrect ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {!state.revealed
                ? "Answer locked in"
                : state.myCorrect
                  ? "Correct"
                  : "Not this one"}
              {myAnswer.trim().length > 0 && (
                <span className="font-normal"> — you said “{myAnswer}”</span>
              )}
            </p>
            {!state.revealed && locked && (
              <p className="mt-1 text-xs leading-5 opacity-80">{locked.note}</p>
            )}
            {state.revealed && state.myCorrect === false && (
              <p className="mt-1">
                The answer is{" "}
                <span className="font-medium text-emerald-700 dark:text-emerald-300">
                  {correctAnswer}
                </span>
              </p>
            )}
            {state.revealed && question?.explanation && (
              <p className="mt-1 text-xs leading-5 opacity-90">{question.explanation}</p>
            )}
          </div>
        </div>
      )}

      {open && question?.type === "short_answer" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = typed.trim();
            if (!value) return;
            setTyped("");
            void submit(value);
          }}
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Type your answer"
            aria-label="Your answer"
            maxLength={200}
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20"
          />
          <button
            type="submit"
            disabled={submitting || typed.trim().length === 0}
            className={sendButton}
          >
            <Check className="h-4 w-4" />
            Answer
          </button>
        </form>
      )}

      {open && !canListen && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
          {blocked
            ? "The browser refused the microphone — allow it, or tap an option above."
            : "This browser can't listen for speech — tap the correct option above."}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
          {error}
        </p>
      )}

      {open && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-zinc-200/70 pt-4 dark:border-zinc-800">
          <button type="button" onClick={onReplayQuestion} className={quietButton}>
            <Volume2 className="h-4 w-4" />
            Repeat question
          </button>
          {supported && !blocked && (
            <button
              type="button"
              aria-pressed={micOn}
              onClick={() => {
                if (micOn) {
                  clearQuiet();
                  stop();
                  setMicOn(false);
                  return;
                }
                getSpeechEngine().unlock();
                setMicOn(true);
              }}
              className={quietButton}
            >
              {micOn ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {micOn ? "Stop listening" : "Answer by voice"}
            </button>
          )}
          {micOn && listening && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Say “letter B”, “the second one”, or the answer itself.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final board
// ---------------------------------------------------------------------------

function FinalBoard({
  board,
  viewerId,
  onClose,
  canReplay,
  onReplay,
  error,
}: {
  board: RoomLiveState["board"];
  viewerId: string;
  onClose: () => void;
  canReplay: boolean;
  onReplay: () => void;
  error: string | null;
}) {
  const mine = board.find((row) => row.userId === viewerId);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 dark:from-amber-500/20 dark:to-amber-400/20 dark:text-amber-300">
        <Trophy className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Live quiz finished
      </h2>
      {mine && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          You scored {mine.correct} and placed #{mine.rank}
        </p>
      )}

      <ul className="mt-6 w-full max-w-md space-y-2">
        {board.map((row) => (
          <li
            key={row.userId}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3",
              row.rank === 1
                ? "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30"
                : row.userId === viewerId
                  ? "bg-brand-50 dark:bg-brand-500/10"
                  : "bg-zinc-50 dark:bg-zinc-800/60"
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700">
              {row.rank}
            </span>
            {row.rank === 1 && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {row.name ?? row.email}
              {row.userId === viewerId && (
                <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                  you
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {row.correct}
              <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
                /{row.answered}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the room
        </button>
        {canReplay && (
          <button
            type="button"
            onClick={onReplay}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-5 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all hover:brightness-105"
          >
            <Play className="h-4 w-4" />
            Play again
          </button>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
          {error}
        </p>
      )}
    </div>
  );
}
