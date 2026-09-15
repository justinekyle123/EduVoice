"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  AudioLines,
  Check,
  Mic,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/layout/Logo";
import { VoiceMode } from "./VoiceMode";
import { chatModes, type ChatMode } from "../lib/modes";
import { providerDotClass, providerLabel } from "../lib/providers";
import { speechLangFor, type DetectedLanguage } from "../lib/detect";
import { TTS_VOICES, DEFAULT_TTS_VOICE } from "../lib/voices";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import {
  getChatMessages,
  retryAssistantMessage,
  sendChatMessage,
  updateChatSessionMode,
} from "../server/actions";

type ChatSessionRow = NonNullable<
  Awaited<ReturnType<typeof getChatMessages>>
>["session"];
type ChatMessageRow = NonNullable<
  Awaited<ReturnType<typeof getChatMessages>>
>["messages"][number];

const LANG_LABELS: Record<DetectedLanguage, string> = {
  en: "English",
  fil: "Filipino",
  ceb: "Cebuano",
};

const TONE_LABELS: Record<string, string> = {
  frustrated: "😤 Frustrated",
  confused: "🤔 Confused",
};

/** Short human-readable size for the composer's attachment chips. */
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shared width for the conversation and the composer, like Claude's thread column. */
const THREAD_WIDTH = "mx-auto w-full max-w-3xl px-4 sm:px-6";

/**
 * Chat UI. The active session comes from the URL:
 *   /dashboard/chat        → new chat
 *   /dashboard/chat/<id>   → existing session (see chat/[sessionId]/page.tsx)
 * The dashboard sidebar owns navigation (new chat, chat history, delete).
 */
export function ChatUI({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<ChatSessionRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  // A new chat has nothing to fetch, so it can paint its empty state at once
  // instead of flashing the loading layout.
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState<ChatMode>("chat");
  // Selected Gemini TTS voice, persisted so the choice sticks across visits.
  const [ttsVoice, setTtsVoice] = useState<string>(DEFAULT_TTS_VOICE);
  const [retrying, setRetrying] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Composer "+" menu (attachments + mode switching) and its picked files.
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks which session the loaded messages belong to, so we skip the refetch
  // right after a new chat is created (see handleSend → router.replace).
  const loadedForRef = useRef<string | null>(null);

  const { supported: voiceSupported, listening, interim, start, stop } =
    useSpeechRecognition((finalText) => {
      setComposer((prev) => (prev ? `${prev} ${finalText}` : finalText));
    });
  const {
    supported: ttsSupported,
    speakingId,
    speak,
    stop: stopSpeaking,
  } = useSpeechSynthesis();

  // Load the requested session, or reset to a fresh chat.
  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      stopSpeaking();
      setSession(null);
      setMessages([]);
      setError(null);
      setMode("chat");
      setMenuOpen(false);
      setAttachments([]);
      loadedForRef.current = null;
      setLoading(false);
      return;
    }

    // Data for this session is already in memory (e.g. right after the first
    // message created it and we navigated to its URL).
    if (loadedForRef.current === sessionId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const res = await getChatMessages(sessionId);
        if (cancelled || !res) return;
        loadedForRef.current = sessionId;
        setSession(res.session);
        setMode(res.session.mode);
        setMessages(res.messages);
      } catch (err) {
        // A failed server action (e.g. missing DATABASE_URL or AI key in the
        // deployment environment) should surface in the error banner, not
        // leave the chat stuck on the loading spinner forever.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chat");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, stopSpeaking]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Grow the composer with its content, up to a ~8 line cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [composer]);

  // Restore the saved voice choice and keep it in sync with localStorage.
  useEffect(() => {
    const saved = window.localStorage.getItem("ttsVoice");
    if (saved && TTS_VOICES.some((v) => v.name === saved)) {
      setTtsVoice(saved);
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("ttsVoice", ttsVoice);
  }, [ttsVoice]);

  // Dismiss the composer menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  /**
   * Sends one turn and returns the saved assistant message, or null when the
   * request failed. Voice mode reuses this so both surfaces share one path.
   */
  async function sendText(
    raw: string
  ): Promise<{ id: string; content: string } | null> {
    const text = raw.trim();
    if (!text || sending) return null;
    setSending(true);
    setError(null);
    stopSpeaking();

    try {
      const res = await sendChatMessage({
        sessionId: sessionId ?? null,
        mode,
        content: text,
      });

      if (res.error) setError(res.error);
      setMessages((prev) => [
        ...prev,
        res.userMessage,
        ...(res.assistantMessage ? [res.assistantMessage] : []),
      ]);
      if (res.createdSession) {
        // Keep the loaded data in memory so the navigation below doesn't refetch.
        loadedForRef.current = res.sessionId;
        setSession({
          ...res.createdSession,
          mode,
          language: res.language,
          title: text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text,
        });
      }
      if (!sessionId && res.sessionId) {
        router.replace(`/dashboard/chat/${res.sessionId}`);
      }
      return res.assistantMessage ?? null;
    } catch (err) {
      // A thrown server action (e.g. DB failure) must surface here instead of
      // leaving the composer stuck in the sending state.
      setError(err instanceof Error ? err.message : "Failed to send message");
      return null;
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const text = composer.trim();
    if (!text) return;
    setComposer("");
    await sendText(text);
  }

  async function handleRetry() {
    if (!sessionId || retrying) return;
    setRetrying(true);
    setError(null);
    try {
      const saved = await retryAssistantMessage(sessionId, mode);
      setMessages((prev) => [...prev, saved]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
    setRetrying(false);
  }

  function handleModeChange(next: ChatMode) {
    setMode(next);
    if (sessionId && session) {
      setSession({ ...session, mode: next });
      void updateChatSessionMode(sessionId, next);
    }
  }

  function addAttachments(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachments((prev) => {
      const next = [...prev];
      for (const file of Array.from(files)) {
        // Ignore re-picking a file that's already attached.
        if (!next.some((f) => f.name === file.name && f.size === file.size)) {
          next.push(file);
        }
      }
      return next;
    });
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleVoice() {
    if (listening) stop();
    else start(speechLangFor("en"));
  }

  // Claude-style empty state: greeting with the composer floating mid-screen.
  const showEmptyState = !loading && messages.length === 0 && !sending;

  const errorBanner = (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Could not reach the AI tutor</p>
            <p className="mt-0.5 line-clamp-2 break-words text-amber-700 dark:text-amber-300">
              {error}
            </p>
          </div>
          {sessionId && (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // One rounded box that owns the input, the mode pills and the actions — the
  // Claude composer shape, with the controls on a single bottom row.
  const composerEl = (
    <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm shadow-zinc-900/5 transition-colors focus-within:border-brand-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-brand-500/70">
      <textarea
        ref={textareaRef}
        value={composer}
        onChange={(e) => setComposer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        rows={1}
        placeholder={listening ? "Listening…" : "Ask EduVoice anything…"}
        className="block max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-7 text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />

      {interim && listening && (
        <p className="truncate px-4 pb-1 text-xs italic text-zinc-400 dark:text-zinc-500">
          {interim}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
          {attachments.map((file, index) => (
            <span
              key={`${file.name}-${file.size}`}
              className="flex min-w-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 py-1 pl-2 pr-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className="max-w-[12rem] truncate">{file.name}</span>
              <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-md p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Preview only — not sent to the tutor yet
          </span>
        </div>
      )}

      <div className="flex items-end justify-between gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {/* "+" menu: attachments plus mode switching (replaces the Chat pill). */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Add an attachment or switch mode"
              title="Add an attachment or switch mode"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                menuOpen
                  ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              )}
            >
              <Plus
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  menuOpen && "rotate-45"
                )}
              />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  role="menu"
                  aria-label="Add an attachment or switch mode"
                  className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Upload className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    Upload file
                  </button>

                  <div className="mx-1 my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

                  <p className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Mode
                  </p>
                  {chatModes.map((m) => {
                    const active = m.id === mode;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        title={m.description}
                        onClick={() => {
                          handleModeChange(m.id);
                          setMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        )}
                      >
                        <m.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{m.label}</span>
                        {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addAttachments(e.target.files);
              // Reset so re-picking the same file still fires onChange.
              e.target.value = "";
            }}
          />

          {/* Modes live in the "+" menu — only voice mode keeps a pill here. */}
          <button
            type="button"
            onClick={() => {
              // Hand the mic over to voice mode's own recognizer.
              stop();
              setVoiceOpen(true);
            }}
            title="Start hands-free voice mode"
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:border-brand-500/30 dark:text-brand-300 dark:hover:bg-brand-500/10"
          >
            <AudioLines className="h-3.5 w-3.5" />
            Voice mode
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <label className="hidden items-center gap-1.5 sm:inline-flex">
            <Volume2 className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
            <select
              value={ttsVoice}
              onChange={(e) => setTtsVoice(e.target.value)}
              aria-label="Tutor voice"
              className="max-w-[8rem] rounded-full bg-transparent py-1.5 text-xs font-medium text-zinc-500 outline-none transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {TTS_VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} — {v.description}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            title={
              voiceSupported
                ? "Speak your question"
                : "Voice input not supported in this browser"
            }
            aria-label={listening ? "Stop listening" : "Speak your question"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              listening
                ? "bg-red-500 text-white"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              !voiceSupported && "cursor-not-allowed opacity-40"
            )}
          >
            {listening ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!composer.trim() || sending}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-sm shadow-brand-500/25 transition-opacity disabled:opacity-30"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  // Voice mode covers the page and outlives the switch between the empty and
  // the docked layout, so it renders once as the section's last child.
  const voiceModeOverlay = (
    <AnimatePresence>
      {voiceOpen && (
        <VoiceMode
          title={session?.title ?? "New chat"}
          modeLabel={chatModes.find((m) => m.id === mode)?.label ?? "Chat"}
          lang={speechLangFor(
            (session?.language as DetectedLanguage | undefined) ?? "en"
          )}
          ttsVoice={ttsVoice}
          speakingId={speakingId}
          speak={speak}
          stopSpeaking={stopSpeaking}
          onSubmit={sendText}
          onClose={() => setVoiceOpen(false)}
        />
      )}
    </AnimatePresence>
  );

  return (
    <section className="flex h-[calc(100dvh-5rem)] flex-col">
      {showEmptyState ? (
        // New chat: greeting with the composer floating in the middle.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-16 sm:px-6">
          <div className="w-full max-w-3xl">
            <div className="mb-7 flex flex-col items-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-lg shadow-brand-500/25">
                <Sparkles className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Ask anything, by voice or text
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                EduVoice answers in English, Filipino, or Cebuano — whichever
                you speak.
              </p>
            </div>
            <div className="space-y-2">
              {errorBanner}
              {composerEl}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Conversation */}
          <div className="flex-1 overflow-y-auto">
            <div className={cn(THREAD_WIDTH, "pb-10 pt-6")}>
              {loading ? (
                <div className="flex items-center justify-center py-32">
                  <div className="flex h-8 items-end gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="animate-equalizer w-1 origin-bottom rounded-full bg-brand-400"
                        style={{ height: 20, animationDelay: `${i * 0.12}s` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-8">
                  {messages.map((m) => {
                    const isUser = m.role === "user";
                    const lang = isUser
                      ? (m.language as DetectedLanguage | null)
                      : null;
                    const tone = isUser ? m.tone : null;
                    const isSpeaking = speakingId === m.id;

                    if (isUser) {
                      return (
                        <div
                          key={m.id}
                          className="flex flex-col items-end gap-1.5"
                        >
                          <div className="max-w-[85%] rounded-3xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                            <p className="whitespace-pre-wrap break-words">
                              {m.content}
                            </p>
                          </div>
                          {((lang && lang !== "en") ||
                            (tone && tone !== "neutral")) && (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {lang && lang !== "en" && (
                                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 ring-1 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30">
                                  {LANG_LABELS[lang]} detected
                                </span>
                              )}
                              {tone && TONE_LABELS[tone] && (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
                                  {TONE_LABELS[tone]}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={m.id} className="group">
                        <div className="flex items-center gap-2">
                          <LogoMark size={24} className="rounded-md" />
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            EduVoice
                          </span>
                          {m.provider && (
                            <span className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                              <span
                                className={cn(
                                  "h-1 w-1 rounded-full",
                                  providerDotClass(m.provider)
                                )}
                              />
                              {providerLabel(m.provider)}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 text-[15px] leading-7 text-zinc-800 dark:text-zinc-100">
                          <p className="whitespace-pre-wrap break-words">
                            {m.content}
                          </p>
                        </div>

                        {ttsSupported && (
                          <div className="mt-1.5 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() =>
                                isSpeaking
                                  ? stopSpeaking()
                                  : speak(
                                      m.id,
                                      m.content,
                                      speechLangFor(
                                        (session?.language as
                                          | DetectedLanguage
                                          | undefined) ?? "en"
                                      ),
                                      ttsVoice
                                    )
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              {isSpeaking ? (
                                <Square className="h-3.5 w-3.5" />
                              ) : (
                                <Volume2 className="h-3.5 w-3.5" />
                              )}
                              {isSpeaking ? "Stop" : "Listen"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {sending && (
                    <div>
                      <div className="flex items-center gap-2">
                        <LogoMark size={24} className="rounded-md" />
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          EduVoice
                        </span>
                      </div>
                      <div className="mt-3 flex h-5 items-end gap-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className="animate-equalizer w-1 origin-bottom rounded-full bg-brand-400"
                            style={{
                              height: 14,
                              animationDelay: `${i * 0.12}s`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* Composer, docked to the bottom of the thread column */}
          <div className="shrink-0 pb-3">
            <div className={cn(THREAD_WIDTH, "space-y-2")}>
              {errorBanner}
              {composerEl}
            </div>
          </div>
        </>
      )}

      {voiceModeOverlay}
    </section>
  );
}
