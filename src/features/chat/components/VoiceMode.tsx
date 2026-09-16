"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AudioLines,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/layout/Logo";
import {
  TTS_VOICES,
  VOICE_STYLES,
  hasVoiceChoice,
  voiceStyleForMode,
} from "../lib/voices";
import { VoiceOrb } from "./VoiceOrb";
import {
  useVoiceSession,
  type VoiceTransport,
  type VoiceTurnMeta,
} from "../hooks/useVoiceSession";

type VoiceModeProps = {
  title: string;
  /** Chat mode id — decides how the replies are read aloud. */
  mode: string;
  modeLabel: string;
  /** BCP-47 tag the recognizer starts from (the session's language). */
  lang: string;
  ttsVoice: string;
  onVoiceChange: (voice: string) => void;
  /** Sends one spoken turn to the server and streams text back. */
  transport: VoiceTransport;
  /** Fired once a turn is saved, so the chat thread follows along. */
  onTurn: (meta: VoiceTurnMeta) => void;
  onClose: () => void;
};

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Hands-free voice mode.
 *
 * The conversation is the main surface: everything said is shown in full, at
 * reading size, in a panel that fills the window and follows the live reply as
 * it is spoken. The orb sits beside it (above it on phones) so the student can
 * always look up and see whether the tutor is listening, thinking or talking.
 * Controls live in the top-left corner: mute, interrupt, hang up.
 */
export function VoiceMode({
  title,
  mode,
  modeLabel,
  lang,
  ttsVoice,
  onVoiceChange,
  transport,
  onTurn,
  onClose,
}: VoiceModeProps) {
  const session = useVoiceSession({
    lang,
    ttsVoice,
    mode,
    transport,
    onTurn,
    onEnd: onClose,
  });

  const [typed, setTyped] = useState("");
  const [showVoices, setShowVoices] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  /** Auto-follow the reply unless the student scrolls up to read. */
  const followRef = useRef(true);

  const style = VOICE_STYLES[voiceStyleForMode(mode)];
  const busy = session.phase === "thinking" || session.phase === "speaking";
  const lastEntry = session.log[session.log.length - 1];
  const liveId =
    lastEntry?.role === "assistant" && busy ? lastEntry.id : undefined;

  // Keep the newest words in view, but never fight the student's own scrolling.
  useEffect(() => {
    const node = threadRef.current;
    if (!node || !followRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [session.log, session.interim]);

  function onScroll() {
    const node = threadRef.current;
    if (!node) return;
    followRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  // Keyboard: space mutes, escape hangs up. Ignored while typing.
  const { toggleMute, end } = session;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typingFor =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typingFor) return;

      if (event.code === "Space") {
        event.preventDefault();
        toggleMute();
      } else if (event.key === "Escape") {
        event.preventDefault();
        end();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute, end]);

  // If the mic can't be used, the typed fallback keeps voice mode usable —
  // replies are still spoken aloud. (A missing Gemini voice is not a reason to
  // type: the reply is still spoken, just in the browser's voice.)
  const needsTyping = !session.recognitionReady || Boolean(session.notice);
  const banner = session.error ?? session.notice ?? session.voiceNotice;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-zinc-950"
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
    >
      {/* Controls (top-left) and session meta */}
      <header className="flex shrink-0 items-center gap-2 px-3 py-3 sm:px-5">
        <button
          type="button"
          onClick={session.toggleMute}
          title={session.muted ? "Unmute the mic" : "Mute the mic (space)"}
          aria-label={session.muted ? "Unmute the mic" : "Mute the mic"}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
            session.muted
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          {session.muted ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </button>

        <AnimatePresence>
          {busy && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.12 }}
              onClick={session.interrupt}
              title="Interrupt the answer"
              aria-label="Interrupt the answer"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <Square className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={session.end}
          title="End voice mode (esc)"
          aria-label="End voice mode"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/25 transition-colors hover:bg-red-600"
        >
          <PhoneOff className="h-5 w-5" />
        </button>

        <div className="ml-2 min-w-0 flex-1">
          <p
            title={title}
            className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {title}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {modeLabel} mode · {style.label} voice · {formatClock(session.elapsed)}
          </p>
        </div>

        {session.firstWordMs > 0 && (
          <span
            title="Time from your pause to the first spoken word"
            className="hidden items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800 sm:inline-flex dark:bg-brand-500/10 dark:text-brand-300"
          >
            <AudioLines className="h-3 w-3" />
            {(session.firstWordMs / 1000).toFixed(1)}s
          </span>
        )}
      </header>

      {/* Body: conversation (reading surface) + orb */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4 sm:px-5 lg:flex-row-reverse lg:gap-8 lg:px-8 lg:pb-8">
        {/* Orb / status column — first on phones, right-hand side on desktop */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-2.5 lg:w-[320px] xl:w-[360px]">
          <VoiceOrb
            phase={session.phase}
            micLevel={session.micLevel}
            playbackAnalyser={session.playbackAnalyser}
            className="h-[120px] w-[120px] shrink-0 sm:h-[150px] sm:w-[150px] lg:h-[260px] lg:w-[260px] xl:h-[300px] xl:w-[300px]"
          />

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                session.muted
                  ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  : "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
              )}
            >
              {session.muted
                ? "Muted"
                : session.phase === "listening"
                  ? "Your turn"
                  : session.phase === "thinking"
                    ? "Tutor is thinking"
                    : "Tutor is speaking"}
            </span>
            {session.turnCount > 0 && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
              </span>
            )}
          </div>

          <p
            aria-live="polite"
            className="max-w-xs text-center text-sm leading-6 text-zinc-500 dark:text-zinc-400 lg:max-w-[280px]"
          >
            {session.status}
          </p>

          {needsTyping && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = typed.trim();
                if (!text) return;
                setTyped("");
                session.submit(text);
              }}
              className="flex w-full max-w-md items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 lg:max-w-[280px] dark:border-zinc-700 dark:bg-zinc-900"
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type your question…"
                aria-label="Type your question"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <button
                type="submit"
                disabled={!typed.trim()}
                aria-label="Send question"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 disabled:opacity-30"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}

          {showVoices && hasVoiceChoice && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {TTS_VOICES.map((voice) => (
                <button
                  key={voice.name}
                  type="button"
                  onClick={() => onVoiceChange(voice.name)}
                  aria-pressed={voice.name === ttsVoice}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    voice.name === ttsVoice
                      ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100"
                  )}
                >
                  {voice.name} — {voice.description}
                </button>
              ))}
            </div>
          )}

          {hasVoiceChoice && !needsTyping && (
            <button
              type="button"
              onClick={() => setShowVoices((open) => !open)}
              aria-pressed={showVoices}
              className="text-[11px] font-medium text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-700 hover:underline dark:text-zinc-500 dark:hover:text-zinc-200"
            >
              Voice: {ttsVoice}
            </button>
          )}

          <p className="hidden max-w-[280px] text-center text-[11px] leading-5 text-zinc-400 lg:block dark:text-zinc-500">
            Just talk — pause and I&apos;ll answer. Say anything while I speak to
            cut in.
          </p>
        </div>

        {/* Conversation column */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {banner && (
            <div className="flex shrink-0 items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <div className="min-w-0 flex-1 break-words">{banner}</div>
              {session.error && (
                <button
                  type="button"
                  onClick={session.retry}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-amber-700"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              )}
            </div>
          )}

          <div
            ref={threadRef}
            onScroll={onScroll}
            aria-live="polite"
            aria-label="Voice conversation"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-3xl border border-zinc-200 bg-white px-4 py-4 sm:px-7 sm:py-6 dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            {session.log.length === 0 && !session.interim ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-[15px] text-zinc-400 dark:text-zinc-500">
                  {session.muted
                    ? "Muted — unmute the mic to start."
                    : "Nothing said yet."}
                </p>
                <p className="text-sm text-zinc-400 dark:text-zinc-600">
                  Ask a question out loud and the answer will appear here as it
                  is spoken.
                </p>
              </div>
            ) : (
              <div className="mx-auto flex max-w-2xl flex-col gap-6">
                {session.log.map((entry) =>
                  entry.role === "user" ? (
                    <div key={entry.id} className="flex flex-col items-end gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        You
                      </span>
                      <p className="max-w-[92%] rounded-3xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                        {entry.text}
                      </p>
                    </div>
                  ) : (
                    <div key={entry.id} className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        <LogoMark size={16} className="rounded" />
                        EduVoice
                      </span>
                      <p className="text-[16px] leading-8 break-words whitespace-pre-wrap text-zinc-800 sm:text-[17px] dark:text-zinc-100">
                        {entry.text}
                        {liveId === entry.id && (
                          <span className="ml-1 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-blink bg-brand-500 motion-reduce:animate-none" />
                        )}
                      </p>
                    </div>
                  )
                )}

                {session.interim && (
                  <div className="flex flex-col items-end gap-1">
                    <p className="max-w-[92%] rounded-3xl border border-dashed border-zinc-300 px-4 py-2.5 text-[15px] leading-7 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                      {session.interim}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
