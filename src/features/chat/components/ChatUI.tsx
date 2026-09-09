"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Menu,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { chatModes, type ChatMode } from "../lib/modes";
import { speechLangFor, type DetectedLanguage } from "../lib/detect";
import { TTS_VOICES, DEFAULT_TTS_VOICE } from "../lib/voices";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import {
  deleteChatSession,
  getChatMessages,
  getChatSessions,
  retryAssistantMessage,
  sendChatMessage,
  updateChatSessionMode,
} from "../server/actions";

type SessionWithPreview = Awaited<ReturnType<typeof getChatSessions>>[number];
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

const SUGGESTIONS = [
  "Explain photosynthesis in Tagalog",
  "Give me a hint: how do I solve x² + 5x + 6 = 0?",
  "Quiz me on the parts of the nervous system",
  "Debate with me: should homework be banned?",
];

export function ChatUI() {
  const [sessions, setSessions] = useState<SessionWithPreview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<ChatSessionRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [inputLang, setInputLang] = useState<DetectedLanguage>("en");
  const [mode, setMode] = useState<ChatMode>("chat");
  // Selected Gemini TTS voice, persisted so the choice sticks across visits.
  const [ttsVoice, setTtsVoice] = useState<string>(DEFAULT_TTS_VOICE);
  const [showSessions, setShowSessions] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

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

  // Load sessions + open the most recent one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getChatSessions();
        if (cancelled) return;
        setSessions(list);
        if (list.length > 0) {
          const res = await getChatMessages(list[0].id);
          if (cancelled || !res) return;
          setActiveId(list[0].id);
          setSession(res.session);
          setMode(res.session.mode);
          setMessages(res.messages);
        }
      } catch (err) {
        // A failed server action (e.g. missing DATABASE_URL or Gemini key in
        // the deployment environment) should surface in the error banner,
        // not leave the chat stuck on the loading spinner forever.
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chats");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

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

  const refreshSessions = useCallback(async () => {
    try {
      const list = await getChatSessions();
      setSessions(list);
    } catch {
      // Best-effort refresh — keep the current list on failure.
    }
  }, []);

  async function openSession(id: string) {
    setActiveId(id);
    setShowSessions(false);
    setError(null);
    try {
      const res = await getChatMessages(id);
      if (!res) return;
      setSession(res.session);
      setMode(res.session.mode);
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    }
  }

  function startNewChat() {
    stopSpeaking();
    setActiveId(null);
    setSession(null);
    setMessages([]);
    setError(null);
    setShowSessions(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this chat?")) return;
    await deleteChatSession(id);
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (id === activeId) {
      if (remaining.length > 0) await openSession(remaining[0].id);
      else startNewChat();
    }
  }

  async function handleSend() {
    const text = composer.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setComposer("");
    stopSpeaking();

    try {
      const res = await sendChatMessage({ sessionId: activeId, mode, content: text });

      if (res.error) setError(res.error);
      setMessages((prev) => [
        ...prev,
        res.userMessage,
        ...(res.assistantMessage ? [res.assistantMessage] : []),
      ]);
      if (res.createdSession) {
        setSession({
          ...res.createdSession,
          mode,
          language: res.language,
          title: text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text,
        });
      }
      setActiveId(res.sessionId);
    } catch (err) {
      // A thrown server action (e.g. DB failure) must surface here instead of
      // leaving the composer stuck in the sending state.
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
    void refreshSessions();
  }

  async function handleRetry() {
    if (!activeId || retrying) return;
    setRetrying(true);
    setError(null);
    try {
      const saved = await retryAssistantMessage(activeId, mode);
      setMessages((prev) => [...prev, saved]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
    setRetrying(false);
  }

  function handleModeChange(next: ChatMode) {
    setMode(next);
    if (activeId && session) {
      setSession({ ...session, mode: next });
      void updateChatSessionMode(activeId, next);
    }
  }

  function toggleVoice() {
    if (listening) stop();
    else start(speechLangFor(inputLang));
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const sessionPanel = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={startNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:shadow-lg"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-indigo-50"
                  : "hover:bg-zinc-100"
              )}
            >
              <button
                type="button"
                onClick={() => openSession(s.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    active ? "text-indigo-700" : "text-zinc-800"
                  )}
                >
                  {s.title ?? "Untitled chat"}
                </p>
                {s.preview && (
                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                    {s.preview}
                  </p>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                aria-label={`Delete ${s.title ?? "chat"}`}
                className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-5 text-zinc-400">
            No chats yet. Start a new conversation!
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Desktop session list */}
      <aside className="hidden overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm lg:block">
        {sessionPanel}
      </aside>

      {/* Mobile session drawer */}
      <AnimatePresence>
        {showSessions && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowSessions(false)}
              className="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
                <span className="text-sm font-semibold text-zinc-900">
                  Conversations
                </span>
                <button
                  type="button"
                  onClick={() => setShowSessions(false)}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100"
                  aria-label="Close conversations"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sessionPanel}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <section className="flex h-[75vh] flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm lg:h-[calc(100vh-10rem)]">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <button
            type="button"
            onClick={() => setShowSessions(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 lg:hidden"
            aria-label="Open conversations"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-zinc-900">
              {session?.title ?? (activeId ? "Untitled chat" : "New chat")}
            </h2>
            <p className="truncate text-xs text-zinc-400">
              {session?.language
                ? `Responding in ${LANG_LABELS[session.language as DetectedLanguage] ?? session.language}`
                : "EduVoice AI tutor"}
            </p>
          </div>
          {activeId && (
            <button
              type="button"
              onClick={() => handleDelete(activeId)}
              className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500"
              aria-label="Delete chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6">
          {loading ? (
            <div className="flex h-full items-center justify-center">
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
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 ring-1 ring-indigo-100">
                <Sparkles className="h-6 w-6 text-indigo-600" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">
                Ask anything, by voice or text
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                EduVoice answers in English, Filipino, or Cebuano — whichever
                you speak. Try one of these:
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setComposer(s)}
                    className="rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-600 shadow-sm transition-all hover:border-indigo-200 hover:text-indigo-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              const lang = isUser
                ? (m.language as DetectedLanguage | null)
                : null;
              const tone = isUser ? m.tone : null;
              const isSpeaking = speakingId === m.id;

              if (isUser) {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] sm:max-w-[75%]">
                      <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm leading-6 text-white shadow-md shadow-indigo-500/15">
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                      {(lang && lang !== "en") || (tone && tone !== "neutral") ? (
                        <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                          {lang && lang !== "en" && (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 ring-1 ring-indigo-100">
                              {LANG_LABELS[lang]} detected
                            </span>
                          )}
                          {tone && TONE_LABELS[tone] && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-100">
                              {TONE_LABELS[tone]}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-semibold text-white shadow-sm">
                    EV
                  </span>
                  <div className="min-w-0 max-w-[85%] sm:max-w-[75%]">
                    <div className="rounded-2xl rounded-tl-md border border-zinc-100 bg-zinc-50 px-4 py-2.5 text-sm leading-6 text-zinc-700">
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                    {ttsSupported && (
                      <button
                        type="button"
                        onClick={() =>
                          isSpeaking
                            ? stopSpeaking()
                            : speak(m.id, m.content, speechLangFor(session?.language as DetectedLanguage | undefined ?? "en"), ttsVoice)
                        }
                        className={cn(
                          "mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                          isSpeaking
                            ? "bg-indigo-600 text-white"
                            : "bg-zinc-100 text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600"
                        )}
                      >
                        {isSpeaking ? (
                          <Square className="h-3 w-3" />
                        ) : (
                          <Volume2 className="h-3 w-3" />
                        )}
                        {isSpeaking ? "Stop" : "Listen"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-semibold text-white shadow-sm">
                EV
              </span>
              <div className="flex h-8 items-end gap-1 rounded-2xl rounded-tl-md border border-zinc-100 bg-zinc-50 px-4 py-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="animate-equalizer w-1 origin-bottom rounded-full bg-indigo-400"
                    style={{ height: 14, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Could not reach the AI tutor</p>
                <p className="mt-0.5 line-clamp-2 break-words text-amber-700">
                  {error}
                </p>
              </div>
              {activeId && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying}
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                >
                  {retrying ? "Retrying…" : "Retry"}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Composer */}
        <div className="border-t border-zinc-100 px-4 py-3">
          {/* Mode pills + voice picker */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {chatModes.map((m) => {
                const active = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModeChange(m.id)}
                    title={m.description}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    )}
                  >
                    <m.icon className="h-3.5 w-3.5" />
                    {m.label}
                  </button>
                );
              })}
            </div>
            <label className="inline-flex items-center gap-1.5">
              <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                aria-label="Tutor voice"
                className="max-w-[10rem] rounded-full border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 outline-none transition-colors focus:border-indigo-300"
              >
                {TTS_VOICES.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} — {v.description}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2 focus-within:border-indigo-300">
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder={
                  listening
                    ? "Listening…"
                    : "Ask EduVoice anything… (Enter to send)"
                }
                className="max-h-32 w-full resize-none bg-transparent text-sm leading-6 text-zinc-800 outline-none placeholder:text-zinc-400"
              />
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {/* Language pills */}
                <div className="flex gap-1">
                  {(["en", "fil", "ceb"] as DetectedLanguage[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setInputLang(l)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                        inputLang === l
                          ? "bg-indigo-100 text-indigo-700"
                          : "text-zinc-400 hover:text-zinc-600"
                      )}
                    >
                      {l === "en" ? "EN" : l === "fil" ? "FIL" : "CEB"}
                    </button>
                  ))}
                </div>
                {interim && listening && (
                  <p className="truncate text-xs italic text-zinc-400">
                    {interim}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={toggleVoice}
              disabled={!voiceSupported}
              title={
                voiceSupported
                  ? "Speak your question"
                  : "Voice input not supported in this browser"
              }
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                listening
                  ? "bg-red-500 text-white shadow-md shadow-red-500/30"
                  : "bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600",
                !voiceSupported && "cursor-not-allowed opacity-40"
              )}
            >
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!composer.trim() || sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25 transition-all hover:shadow-lg disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}