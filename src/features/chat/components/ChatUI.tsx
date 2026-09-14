"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  AudioLines,
  Mic,
  Send,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VoiceMode } from "./VoiceMode";
import { chatModes, type ChatMode } from "../lib/modes";
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
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
    <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm shadow-zinc-900/5 transition-colors focus-within:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-indigo-500/70">
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

      <div className="flex items-end justify-between gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {chatModes.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleModeChange(m.id)}
                title={m.description}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              // Hand the mic over to voice mode's own recognizer.
              stop();
              setVoiceOpen(true);
            }}
            title="Start hands-free voice mode"
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm shadow-indigo-500/25 transition-opacity disabled:opacity-30"
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
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/25">
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
                        className="animate-equalizer w-1 origin-bottom rounded-full bg-indigo-400"
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
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30">
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
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[10px] font-semibold text-white">
                            EV
                          </span>
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            EduVoice
                          </span>
                          {m.provider && (
                            <span className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                              <span
                                className={cn(
                                  "h-1 w-1 rounded-full",
                                  m.provider === "groq"
                                    ? "bg-emerald-500"
                                    : "bg-indigo-500"
                                )}
                              />
                              {m.provider.charAt(0).toUpperCase() +
                                m.provider.slice(1)}
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
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[10px] font-semibold text-white">
                          EV
                        </span>
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          EduVoice
                        </span>
                      </div>
                      <div className="mt-3 flex h-5 items-end gap-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className="animate-equalizer w-1 origin-bottom rounded-full bg-indigo-400"
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
