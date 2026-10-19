"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/features/chat/hooks/useSpeechSynthesis";
import { speechLangFor, type DetectedLanguage } from "@/features/chat/lib/detect";
import {
  askDocument,
  deleteDocument,
  getDocuments,
  uploadDocument,
  type DocumentAnswer,
  type DocumentRow,
} from "../server/actions";

// Document-Based Question and Answer (feature 6.3).
//
// Two jobs on one page: turn an upload into a searchable document, then ask that
// document questions and read the answer — by voice if the student wants. The
// chunks and the grounding live on the server (server/actions.ts); this file is
// presentation plus the upload and ask round-trips.

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const LANGUAGES: { id: DetectedLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fil", label: "Filipino" },
  { id: "ceb", label: "Cebuano" },
];

const EXAMPLES = [
  "What is the main argument?",
  "Ano ang ibig sabihin ng chapter 3?",
  "Unsa ang importante nga pormula?",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Status pill for a document's processing state. */
function StatusBadge({ status }: { status: DocumentRow["status"] }) {
  const map: Record<DocumentRow["status"], { label: string; className: string; icon: React.ReactNode }> = {
    ready: {
      label: "Ready",
      className:
        "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    processing: {
      label: "Reading…",
      className:
        "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    uploaded: {
      label: "Queued",
      className:
        "bg-zinc-100 text-zinc-600 ring-zinc-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
      icon: <Clock className="h-3 w-3" />,
    },
    failed: {
      label: "Could not read",
      className:
        "bg-red-50 text-red-600 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
  };

  const entry = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        entry.className
      )}
    >
      {entry.icon}
      {entry.label}
    </span>
  );
}

export function DocumentsUI() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<DocumentAnswer | null>(null);
  const [lang, setLang] = useState<DetectedLanguage>("en");

  const { supported: voiceSupported, listening, interim, start, stop } =
    useSpeechRecognition((finalText) => {
      setQuestion((current) =>
        `${current} ${finalText}`.replace(/\s+/g, " ").trim()
      );
    });
  const { supported: speechSupported, speakingId, speak, stop: stopSpeaking } =
    useSpeechSynthesis();

  useEffect(() => {
    let cancelled = false;
    getDocuments()
      .then((rows) => {
        if (cancelled) return;
        setDocs(rows);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load your documents"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = docs.find((doc) => doc.id === selectedId) ?? null;

  const pick = useCallback((doc: DocumentRow) => {
    setSelectedId(doc.id);
    setAnswer(null);
    setQuestion("");
    setError(null);
    setNotice(null);
  }, []);

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || uploading) return;

    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", chosen);
      const { document, chunkCount } = await uploadDocument(formData);
      setDocs((prev) => [
        {
          id: document.id,
          fileName: document.fileName,
          fileType: document.fileType,
          status: document.status,
          summary: document.summary,
          createdAt: document.createdAt,
          chunkCount,
        },
        ...prev,
      ]);
      setChosen(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice(`Read “${document.fileName}” — ${chunkCount} sections indexed.`);
      setSelectedId(document.id);
    } catch (err) {
      setError(errorMessage(err, "That file could not be read"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: DocumentRow) {
    if (busyId) return;
    if (!window.confirm(`Delete “${doc.fileName}”?`)) return;

    setBusyId(doc.id);
    setError(null);
    try {
      await deleteDocument(doc.id);
      setDocs((prev) => prev.filter((row) => row.id !== doc.id));
      if (selectedId === doc.id) {
        setSelectedId(null);
        setAnswer(null);
      }
    } catch (err) {
      setError(errorMessage(err, "That document could not be deleted"));
    } finally {
      setBusyId(null);
    }
  }

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text || !selectedId || asking) return;

      setAsking(true);
      setError(null);
      setAnswer(null);
      try {
        setAnswer(await askDocument({ documentId: selectedId, question: text }));
      } catch (err) {
        setError(errorMessage(err, "That question could not be answered"));
      } finally {
        setAsking(false);
      }
    },
    [selectedId, asking]
  );

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    await ask(question);
  }

  function toggleMic() {
    if (listening) {
      stop();
      return;
    }
    // Letters are typed, words are spoken: the language only steers recognition
    // when the student speaks.
    start(speechLangFor(lang));
  }

  const answerLang = speechLangFor(lang);
  const answerSpeakingId = selectedId ? `doc-answer-${selectedId}` : "doc-answer";

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Document-based Q&amp;A
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Upload your PDF or lecture notes and ask anything about them. Answers
            stay grounded in your own material — if the document does not cover it,
            EduVoice says so instead of guessing.
          </p>
        </div>

        {docs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {docs.filter((doc) => doc.status === "ready").length} ready
            </span>
          </div>
        )}
      </div>

      {/* Upload */}
      <section className={cn(panel, "p-5")}>
        <form onSubmit={handleUpload} className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
              <BookOpen className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Add study material
              </h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                PDF, TXT, MD, or CSV — up to 12 MB. EduVoice reads it once, stores
                the text, and writes a summary you can quiz yourself on.
              </p>
            </div>
          </div>

          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors",
              chosen
                ? "border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5"
                : "border-zinc-300 hover:border-brand-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-brand-500/40 dark:hover:bg-zinc-800/60"
            )}
          >
            <Upload className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-300">
              {chosen ? chosen.name : "Choose a file to upload"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv"
              onChange={(event) => {
                setChosen(event.target.files?.[0] ?? null);
                setError(null);
                setNotice(null);
              }}
              className="sr-only"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!chosen || uploading}
              className={primaryButton}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Reading your document…" : "Upload & read"}
            </button>
            {chosen && !uploading && (
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className={ghostButton}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </section>

      <AnimatePresence>
        {(error || notice) && (
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
              <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                {notice}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Documents */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Your documents
        </h2>

        {loading ? (
          <div className={cn(panel, "flex items-center justify-center py-14")}>
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : docs.length === 0 ? (
          <div
            className={cn(
              panel,
              "flex flex-col items-center justify-center border-dashed px-6 py-14 text-center"
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </span>
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No documents yet
            </p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Upload a reading or your own notes above, then ask questions about
              them — one topic at a time.
            </p>
          </div>
        ) : (
          <div className={cn(panel, "divide-y divide-zinc-100 p-1.5 dark:divide-zinc-800")}>
            {docs.map((doc) => {
              const active = doc.id === selectedId;
              const ready = doc.status === "ready";
              return (
                <div
                  key={doc.id}
                  className={cn(
                    "flex flex-wrap items-start gap-3 rounded-xl px-3 py-3 transition-colors",
                    active ? "bg-brand-50/60 dark:bg-brand-500/5" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1",
                      ready
                        ? "bg-brand-50 text-brand-600 ring-brand-200/70 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/30"
                        : "bg-zinc-50 text-zinc-400 ring-zinc-200/70 dark:bg-zinc-800 dark:text-zinc-500 dark:ring-zinc-700"
                    )}
                  >
                    <FileText className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {doc.fileName}
                      </p>
                      <StatusBadge status={doc.status} />
                      {ready && (
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                          {doc.chunkCount} sections
                        </span>
                      )}
                    </div>

                    {doc.summary && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                        {doc.summary}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => pick(doc)}
                        disabled={!ready}
                        title={ready ? "Ask this document" : "Still being read"}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                          ready
                            ? active
                              ? "bg-brand-500 text-brand-950"
                              : "bg-brand-100 text-brand-800 hover:bg-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25"
                            : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                        )}
                      >
                        <Sparkles className="h-3 w-3" />
                        Ask
                      </button>

                      {ready && (
                        <Link
                          href={`/dashboard/flashcards?document=${doc.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          <Layers className="h-3 w-3" />
                          Flashcards
                        </Link>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={busyId === doc.id}
                    aria-label={`Delete ${doc.fileName}`}
                    className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    {busyId === doc.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Ask */}
      <AnimatePresence>
        {selected && selected.status === "ready" && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
            className={cn(panel, "p-5")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-md shadow-brand-500/25">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Ask about {selected.fileName}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    Answers come from this document only.
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Language
                <select
                  value={lang}
                  onChange={(event) => setLang(event.target.value as DetectedLanguage)}
                  aria-label="Answer language"
                  className="rounded-full bg-transparent py-1 font-medium text-zinc-600 outline-none hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  {LANGUAGES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <form onSubmit={handleAsk} className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  value={listening && interim ? `${question} ${interim}`.trim() : question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="e.g. What does the third section conclude?"
                  aria-label="Question about this document"
                  maxLength={500}
                  className={cn(field, "pr-10")}
                />
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={!voiceSupported}
                  aria-label={listening ? "Stop listening" : "Ask by voice"}
                  title={
                    voiceSupported
                      ? listening
                        ? "Stop listening"
                        : "Ask by voice"
                      : "Voice input is not supported in this browser"
                  }
                  className={cn(
                    "absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors",
                    listening
                      ? "animate-pulse bg-red-500 text-white"
                      : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
                    !voiceSupported && "cursor-not-allowed opacity-50"
                  )}
                >
                  {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={asking || question.trim().length === 0}
                className={primaryButton}
              >
                {asking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Ask
              </button>
            </form>

            {question.trim().length === 0 && !asking && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Try:</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuestion(example)}
                    className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:border-brand-300 hover:text-brand-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}

            {asking && (
              <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reading your document…
              </p>
            )}

            {answer && !asking && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                    <Sparkles className="h-3 w-3" />
                    From your document
                  </span>

                  {speechSupported && (
                    <button
                      type="button"
                      onClick={() =>
                        speakingId === answerSpeakingId
                          ? stopSpeaking()
                          : speak(answerSpeakingId, answer.answer, answerLang)
                      }
                      className={ghostButton}
                    >
                      {speakingId === answerSpeakingId ? (
                        <Square className="h-3.5 w-3.5" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                      {speakingId === answerSpeakingId ? "Stop" : "Listen"}
                    </button>
                  )}
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-100">
                  {answer.answer}
                </p>

                {answer.weakMatch && (
                  <p className="mt-2 text-[11px] leading-5 text-amber-700 dark:text-amber-400">
                    No section of the document matched your question closely, so
                    the answer may be limited. Try naming the exact topic.
                  </p>
                )}

                {answer.sources.length > 0 && (
                  <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      From sections
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {answer.sources.map((source) => (
                        <li
                          key={source.index}
                          className="flex items-start gap-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400"
                        >
                          <span className="mt-0.5 shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {source.index + 1}
                          </span>
                          <span className="min-w-0">{source.excerpt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-3 text-[10px] text-zinc-400 dark:text-zinc-600">
                  Answered by {answer.provider}
                </p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
