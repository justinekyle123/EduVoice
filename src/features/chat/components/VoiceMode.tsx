"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  AudioLines,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectLanguage, speechLangFor } from "../lib/detect";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

/** The slice of a saved assistant message voice mode needs to read the reply. */
type AssistantTurn = { id: string; content: string };

type VoiceModeProps = {
  title: string;
  modeLabel: string;
  /** BCP-47 tag the recognizer listens for. */
  lang: string;
  ttsVoice: string;
  speakingId: string | null;
  speak: (id: string, text: string, lang: string, voice?: string) => void;
  stopSpeaking: () => void;
  /** Sends one turn through the normal chat pipeline; null means it failed. */
  onSubmit: (text: string) => Promise<AssistantTurn | null>;
  onClose: () => void;
};

type Phase = "listening" | "thinking" | "speaking" | "paused";
type LogEntry = { id: string; role: "user" | "assistant"; text: string };

/**
 * Hands-free voice mode. One utterance per turn: the mic captures a question,
 * the reply is sent through the usual chat action, the tutor's answer is spoken
 * aloud, and then the mic re-opens on its own — until the student hangs up.
 * Browsers without the Web Speech API fall back to a text box that still speaks
 * the replies.
 */
export function VoiceMode({
  title,
  modeLabel,
  lang,
  ttsVoice,
  speakingId,
  speak,
  stopSpeaking,
  onSubmit,
  onClose,
}: VoiceModeProps) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [typed, setTyped] = useState("");
  // Read inside the recognition callback, which is created once and would
  // otherwise close over a stale phase.
  const phaseRef = useRef<Phase>("listening");
  const stopRef = useRef<() => void>(() => {});
  const submitRef = useRef<(text: string) => void>(() => {});
  // True once TTS has actually started, so we don't treat the gap while Gemini
  // is generating audio as "finished speaking".
  const spokeRef = useRef(false);
  const seqRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /** Send one turn, show it in the transcript, then speak the reply. */
  const submitTurn = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (phaseRef.current === "thinking" || phaseRef.current === "speaking") {
        return;
      }

      const turn = ++seqRef.current;
      setPhase("thinking");
      setLog((prev) => [...prev, { id: `u${turn}`, role: "user", text }]);

      const reply = await onSubmit(text);

      if (!reply) {
        setLog((prev) => [
          ...prev,
          {
            id: `e${turn}`,
            role: "assistant",
            text: "I couldn't reach the tutor. Let's try that again.",
          },
        ]);
        setPhase("listening");
        return;
      }

      setLog((prev) => [
        ...prev,
        { id: reply.id, role: "assistant", text: reply.content },
      ]);
      setPhase("speaking");
      speak(
        reply.id,
        reply.content,
        speechLangFor(detectLanguage(text)),
        ttsVoice
      );
    },
    [onSubmit, speak, ttsVoice]
  );

  useEffect(() => {
    submitRef.current = (text: string) => void submitTurn(text);
  }, [submitTurn]);

  // One final result = one finished question, which is our turn boundary.
  const onTranscript = useCallback((finalText: string) => {
    if (phaseRef.current !== "listening") return;
    stopRef.current();
    submitRef.current(finalText);
  }, []);

  const { supported, listening, interim, start, stop } =
    useSpeechRecognition(onTranscript);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // Keep the mic open in the listening phase — across turns and across the
  // browser's own silence timeouts.
  useEffect(() => {
    if (!supported || muted || phase !== "listening" || listening) return;
    const timer = window.setTimeout(() => start(lang), 300);
    return () => window.clearTimeout(timer);
  }, [supported, muted, phase, listening, start, lang]);

  // Spoken reply finished → listen again.
  useEffect(() => {
    if (phase !== "speaking") {
      spokeRef.current = false;
      return;
    }
    if (speakingId !== null) {
      spokeRef.current = true;
      return;
    }
    if (spokeRef.current) setPhase("listening");
  }, [phase, speakingId]);

  // Safety net: if TTS never reports speaking, don't leave the student waiting.
  useEffect(() => {
    if (phase !== "speaking") return;
    const timer = window.setTimeout(() => setPhase("listening"), 60000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const endSession = useCallback(() => {
    // Pause first: it keeps the restart effect from re-opening the mic during
    // the exit animation.
    setPhase("paused");
    stopRef.current();
    stopSpeaking();
    onClose();
  }, [stopSpeaking, onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") endSession();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, interim]);

  function toggleMute() {
    if (muted) {
      setMuted(false);
      setPhase("listening");
    } else {
      setMuted(true);
      setPhase("paused");
      stopRef.current();
    }
  }

  const active =
    supported && (phase === "listening" || phase === "speaking");

  const status = !supported
    ? "Voice input isn't supported in this browser — type your question below."
    : muted
      ? "Muted — tap the mic to keep talking"
      : phase === "listening"
        ? interim
          ? "Listening…"
          : "Listening… just start talking"
        : phase === "thinking"
          ? "Thinking…"
          : phase === "speaking"
            ? "Speaking…"
            : "Paused";

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
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-semibold text-white">
          EV
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {modeLabel} mode · hands-free
          </p>
        </div>
        <button
          type="button"
          onClick={endSession}
          aria-label="Close voice mode"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Orb, status and live transcript */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6">
        <div className="relative flex h-32 w-32 items-center justify-center">
          {active && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/20" />
              <span className="absolute inset-3 animate-ping rounded-full bg-fuchsia-400/20 [animation-delay:250ms]" />
            </>
          )}
          <span
            className={cn(
              "relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-xl shadow-indigo-500/25",
              phase === "thinking" && "animate-pulse",
              muted && "opacity-50"
            )}
          >
            {active ? (
              <span className="flex h-8 items-end gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="animate-equalizer w-1 origin-bottom rounded-full bg-white/90"
                    style={{ height: 24, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            ) : (
              <AudioLines className="h-8 w-8" />
            )}
          </span>
        </div>

        <p className="max-w-sm text-center text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {status}
        </p>

        {(log.length > 0 || interim) && (
          <div className="max-h-36 w-full max-w-md space-y-3 overflow-y-auto px-1">
            {log.map((entry) => (
              <p
                key={entry.id}
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-6",
                  entry.role === "user"
                    ? "text-right font-medium text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-700 dark:text-zinc-300"
                )}
              >
                {entry.text}
              </p>
            ))}
            {interim && (
              <p className="whitespace-pre-wrap break-words text-right text-sm italic leading-6 text-zinc-400 dark:text-zinc-600">
                {interim}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-5 pb-10">
        {!supported && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = typed.trim();
              if (!text) return;
              setTyped("");
              void submitTurn(text);
            }}
            className="flex w-full max-w-md items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type your question…"
              aria-label="Type your question"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={!typed.trim()}
              aria-label="Send question"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}

        <div className="flex items-center justify-center gap-4">
          {supported &&
            (phase === "speaking" ? (
              <button
                type="button"
                onClick={() => stopSpeaking()}
                title="Interrupt the answer"
                aria-label="Interrupt the answer"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleMute}
                title={muted ? "Unmute the mic" : "Mute the mic"}
                aria-label={muted ? "Unmute the mic" : "Mute the mic"}
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                  muted
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                )}
              >
                {muted ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
            ))}

          <button
            type="button"
            onClick={endSession}
            title="End voice mode"
            aria-label="End voice mode"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/25 transition-colors hover:bg-red-600"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
