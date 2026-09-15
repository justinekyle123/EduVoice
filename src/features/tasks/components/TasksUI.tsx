"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Circle,
  Keyboard,
  ListTodo,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { speechLangFor, type DetectedLanguage } from "@/features/chat/lib/detect";
import type { TaskSource } from "../lib/parse";
import {
  clearCompletedTasks,
  createTask,
  deleteTask,
  getTasks,
  setTaskCompleted,
  updateTask,
} from "../server/actions";

type TaskRow = Awaited<ReturnType<typeof getTasks>>[number];

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";
const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const LANG_LABELS: Record<DetectedLanguage, string> = {
  en: "English",
  fil: "Filipino",
  ceb: "Cebuano",
};

const LANGUAGES: { id: DetectedLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fil", label: "Filipino" },
  { id: "ceb", label: "Cebuano" },
];

/**
 * Quiet time after the last recognised word before the task is logged. The
 * recognizer hands back a finished phrase at the speaker's first pause, and a
 * task is usually spoken in several breaths ("review chapter 4" … "tomorrow at
 * 7pm"), so committing immediately would file half a sentence. Any further
 * speech restarts this wait.
 */
const AUTO_SUBMIT_DELAY_MS = 1_800;

const EXAMPLES = [
  "Review chapter 4 tomorrow at 7pm",
  "Pass the physics lab report sa Lunes",
  "Submit the group project ugma 3pm",
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// The dictation language is remembered across visits. It lives in a tiny
// external store rather than an effect because restoring it with setState from
// inside an effect would cascade renders (and the server has no localStorage to
// read, so the server snapshot stays English).
const LANG_STORAGE_KEY = "taskCaptureLang";
let cachedLang: DetectedLanguage | null = null;
const langListeners = new Set<() => void>();

function readLang(): DetectedLanguage {
  if (cachedLang) return cachedLang;
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
  cachedLang = saved === "fil" || saved === "ceb" ? saved : "en";
  return cachedLang;
}

function subscribeLang(listener: () => void) {
  langListeners.add(listener);
  return () => {
    langListeners.delete(listener);
  };
}

function writeLang(next: DetectedLanguage) {
  cachedLang = next;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // Private mode or a blocked storage quota — the choice just won't persist.
  }
  for (const listener of langListeners) listener();
}

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

/** Mirrors the SQL ordering: open first, soonest due, undated last, newest. */
function sortTasks(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const aDue = a.dueDate ? asDate(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueDate ? asDate(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return asDate(b.createdAt).getTime() - asDate(a.createdAt).getTime();
  });
}

/** "Today 5:00 PM", "Tomorrow 9:00 AM", "Mon, Sep 21 9:00 AM". */
function dueLabel(value: Date | string) {
  const due = asDate(value);
  const now = new Date();
  const dayOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);
  const time = due.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${due.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} ${time}`;
}

function isOverdue(task: TaskRow) {
  return !task.completed && task.dueDate !== null && asDate(task.dueDate) < new Date();
}

function isDueToday(task: TaskRow) {
  if (task.completed || !task.dueDate) return false;
  const due = asDate(task.dueDate);
  const now = new Date();
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

/** Value shape for <input type="datetime-local"> in the student's timezone. */
function toLocalInput(value: Date | string) {
  const date = asDate(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// A single row
// ---------------------------------------------------------------------------

function TaskItem({
  task,
  busy,
  onToggle,
  onDelete,
  onSave,
}: {
  task: TaskRow;
  busy: boolean;
  onToggle: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
  onSave: (task: TaskRow, title: string, dueDate: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.dueDate ? toLocalInput(task.dueDate) : "");
  const [saving, setSaving] = useState(false);

  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);

  function startEditing() {
    setTitle(task.title);
    setDue(task.dueDate ? toLocalInput(task.dueDate) : "");
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      if (await onSave(task, title, due)) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-500/30 dark:bg-brand-500/5"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          maxLength={200}
          aria-label="Task title"
          className={field}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            aria-label="Due date"
            className={cn(field, "w-auto")}
          />
          <button
            type="submit"
            disabled={saving || title.trim().length === 0}
            className={primaryButton}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className={ghostButton}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <button
        type="button"
        onClick={() => onToggle(task)}
        disabled={busy}
        aria-label={task.completed ? "Mark as not done" : "Mark as done"}
        className="mt-0.5 shrink-0 text-zinc-400 transition-colors hover:text-brand-700 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-brand-400"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : task.completed ? (
          <Check className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "break-words text-sm text-zinc-800 dark:text-zinc-100",
            task.completed && "text-zinc-400 line-through dark:text-zinc-500"
          )}
        >
          {task.title}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                task.completed
                  ? "bg-zinc-50 text-zinc-400 ring-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-500 dark:ring-zinc-700"
                  : overdue
                    ? "bg-red-50 text-red-600 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30"
                    : dueToday
                      ? "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"
                      : "bg-zinc-50 text-zinc-500 ring-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-700"
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {task.completed
                ? `Was due ${dueLabel(task.dueDate)}`
                : overdue
                  ? `Overdue · ${dueLabel(task.dueDate)}`
                  : `Due ${dueLabel(task.dueDate)}`}
            </span>
          )}

          <span
            className="inline-flex items-center gap-1 rounded-full bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-700"
            title={task.source === "voice" ? "Captured by voice" : "Typed in"}
          >
            {task.source === "voice" ? (
              <Mic className="h-3 w-3" />
            ) : (
              <Keyboard className="h-3 w-3" />
            )}
            {task.source === "voice" ? "Voice" : "Typed"}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Edit ${task.title}`}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(task)}
          aria-label={`Delete ${task.title}`}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TasksUI() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  // Spoken words waiting to be filed, plus whether the settle timer is running.
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const draftRef = useRef("");
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRecognitionRef = useRef<(() => void) | null>(null);
  const lang = useSyncExternalStore<DetectedLanguage>(
    subscribeLang,
    readLang,
    () => "en"
  );

  // Initial load — the promise callback pattern the chat sidebar and rooms use.
  useEffect(() => {
    let cancelled = false;
    getTasks()
      .then((rows) => {
        if (cancelled) return;
        setTasks(sortTasks(rows));
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Could not load your tasks"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const capture = useCallback(
    async (raw: string, source: TaskSource) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) return;

      setCapturing(true);
      setError(null);
      try {
        const { task, parsed } = await createTask({
          text,
          source,
          // Resolve "tomorrow at 5pm" against the student's own clock.
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        });
        setTasks((prev) => sortTasks([task, ...prev]));
        setNotice(
          [
            parsed.language === "en"
              ? "Captured"
              : `Captured in ${LANG_LABELS[parsed.language]}`,
            `“${task.title}”`,
            parsed.dueDate ? `due ${dueLabel(parsed.dueDate)}` : null,
          ]
            .filter(Boolean)
            .join(" — ")
            .concat(".")
        );
      } catch (err) {
        setError(errorMessage(err, "That task could not be captured"));
      } finally {
        setCapturing(false);
      }
    },
    []
  );

  /**
   * File whatever has been dictated so far, right now. Used by the settle timer
   * below and by the "Add now" button.
   */
  const sendDraft = useCallback(async () => {
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }

    const text = draftRef.current;
    draftRef.current = "";
    setDraft("");
    setPending(false);
    // The turn is over, so close the microphone — and abort rather than stop, so
    // a trailing result can't be filed as a second task. Words still only held
    // as interim at this instant are dropped; everything shown in the draft is
    // saved. Another tap on the mic starts a fresh task.
    endRecognitionRef.current?.();

    if (text) await capture(text, "voice");
  }, [capture]);

  // The recognizer is started in continuous mode (see toggleMic) so one session
  // stays open across pauses: a task spoken in several breaths accumulates into a
  // single draft instead of arriving as fragments. Declared before the recognizer
  // so the callback always closes over defined functions.
  const {
    supported: voiceSupported,
    listening,
    interim,
    start,
    stop,
    abort,
  } = useSpeechRecognition((finalText) => {
    const next = `${draftRef.current} ${finalText}`
      .replace(/\s+/g, " ")
      .trim();
    draftRef.current = next;
    setDraft(next);
    setPending(true);

    // More speech restarts the wait, so a longer task stays one task.
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(() => {
      void sendDraft();
    }, AUTO_SUBMIT_DELAY_MS);
  });

  // The recognizer's abort() is needed inside sendDraft, which is declared before
  // the hook runs — hand it across through a ref.
  useEffect(() => {
    endRecognitionRef.current = abort;
    return () => {
      endRecognitionRef.current = null;
    };
  }, [abort]);

  // Never leave a timer running after the page goes away.
  useEffect(
    () => () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    },
    []
  );

  async function handleTyped(event: React.FormEvent) {
    event.preventDefault();
    const text = composer.trim();
    if (!text || capturing) return;
    setComposer("");
    await capture(text, "text");
  }

  async function handleToggle(task: TaskRow) {
    setBusyId(task.id);
    setError(null);
    try {
      const updated = await setTaskCompleted({
        id: task.id,
        completed: !task.completed,
      });
      if (updated) {
        setTasks((prev) =>
          sortTasks(prev.map((row) => (row.id === updated.id ? updated : row)))
        );
      }
    } catch (err) {
      setError(errorMessage(err, "That task could not be updated"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(task: TaskRow) {
    setBusyId(task.id);
    setError(null);
    try {
      await deleteTask(task.id);
      setTasks((prev) => prev.filter((row) => row.id !== task.id));
    } catch (err) {
      setError(errorMessage(err, "That task could not be deleted"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSave(task: TaskRow, title: string, due: string) {
    setError(null);
    try {
      const updated = await updateTask({
        id: task.id,
        title,
        dueDate: due ? new Date(due).toISOString() : null,
      });
      if (updated) {
        setTasks((prev) =>
          sortTasks(prev.map((row) => (row.id === updated.id ? updated : row)))
        );
        setNotice("Task updated.");
      }
      return true;
    } catch (err) {
      setError(errorMessage(err, "That task could not be saved"));
      return false;
    }
  }

  async function handleClearCompleted() {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await clearCompletedTasks();
      setTasks((prev) => prev.filter((row) => !row.completed));
    } catch (err) {
      setError(errorMessage(err, "Could not clear the finished tasks"));
    } finally {
      setClearing(false);
    }
  }

  /** Throw the dictated words away and close the microphone. */
  function discardDraft() {
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
    draftRef.current = "";
    setDraft("");
    setPending(false);
    abort();
  }

  function toggleMic() {
    if (draft) {
      // Tapping again means "I'm done" — file it instead of discarding it.
      void sendDraft();
      return;
    }
    if (listening) {
      stop();
      return;
    }
    start(speechLangFor(lang), { continuous: true });
  }

  const { open, done, overdueCount, dueTodayCount } = useMemo(() => {
    const openTasks = tasks.filter((task) => !task.completed);
    return {
      open: openTasks,
      done: tasks.filter((task) => task.completed),
      overdueCount: openTasks.filter(isOverdue).length,
      dueTodayCount: openTasks.filter(isDueToday).length,
    };
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Hands-free task capture
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Dictate your study to-dos, deadlines, and reminders and EduVoice logs
            them for you — no typing, no hands needed. Say the day and it sorts
            itself: &ldquo;review chapter 4 tomorrow at 7pm&rdquo;.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {open.length} open
          </span>
          {dueTodayCount > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
              {dueTodayCount} due today
            </span>
          )}
          {overdueCount > 0 && (
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
              {overdueCount} overdue
            </span>
          )}
        </div>
      </div>

      {/* Capture */}
      <section className={cn(panel, "p-5")}>
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={toggleMic}
            disabled={!voiceSupported || capturing}
            aria-label={
              draft
                ? "Add this task now"
                : listening
                  ? "Stop listening"
                  : "Dictate a task"
            }
            title={
              voiceSupported
                ? draft
                  ? "Add this task now"
                  : "Dictate a task"
                : "Voice input is not supported in this browser"
            }
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-md transition-all duration-200",
              listening
                ? "animate-pulse bg-red-500 text-white shadow-red-500/30"
                : "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-brand-500/25 hover:shadow-lg",
              (!voiceSupported || capturing) && "cursor-not-allowed opacity-50"
            )}
          >
            {capturing ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : listening ? (
              <Square className="h-5 w-5" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {listening
                  ? "Listening…"
                  : draft
                    ? "Got it — adding your task…"
                    : "Tap the mic and say your task"}
              </h2>
              <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Speaking
                <select
                  value={lang}
                  onChange={(event) =>
                    writeLang(event.target.value as DetectedLanguage)
                  }
                  aria-label="Dictation language"
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

            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {draft
                ? "Keep talking if you are not done — anything you add is included. Pause and it is logged for you."
                : listening
                  ? "Say the task, the day, and the time — take your time, it sends after you stop."
                  : !voiceSupported
                    ? "This browser has no speech recognition — type the task below instead."
                    : "Include a day or time and it becomes the due date."}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Try:
              </span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setComposer(example)}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:border-brand-300 hover:text-brand-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                >
                  {example}
                </button>
              ))}
            </div>

            {(draft || interim) && (
              <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/5">
                <p className="text-sm leading-6 text-zinc-800 dark:text-zinc-100">
                  {draft}
                  {interim && (
                    <span className="text-zinc-400 dark:text-zinc-500">
                      {draft ? " " : ""}
                      {interim}
                    </span>
                  )}
                </p>

                {draft && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {pending && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-800 dark:text-brand-300">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Adding in a moment…
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void sendDraft()}
                      disabled={capturing}
                      className="rounded-full bg-brand-400 px-2.5 py-1 text-[11px] font-semibold text-brand-950 transition-colors hover:bg-brand-300 disabled:opacity-60"
                    >
                      Add now
                    </button>
                    <button
                      type="button"
                      onClick={discardDraft}
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleTyped} className="mt-4 flex items-center gap-2">
          <input
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder="Or type it — “pass the lab report tomorrow at 5pm”"
            aria-label="Task to capture"
            maxLength={300}
            className={field}
          />
          <button
            type="submit"
            disabled={capturing || composer.trim().length === 0}
            className={primaryButton}
          >
            {capturing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </button>
        </form>

        <p className="mt-3 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
          Understood: today · tomorrow · tonight · this Friday · next week · in 3
          days · Oct 5 · 10/5 — plus Filipino and Cebuano (bukas, ngayon, ugma,
          karon, sa Lunes, sa makalawa, sa sunod nga semana).
        </p>
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
              <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                {notice}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Open tasks */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          To do
        </h2>

        {loading ? (
          <div className={cn(panel, "flex items-center justify-center py-14")}>
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : open.length === 0 ? (
          <div
            className={cn(
              panel,
              "flex flex-col items-center justify-center border-dashed px-6 py-14 text-center"
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 ring-1 ring-brand-200/70 dark:from-brand-500/10 dark:to-brand-400/10 dark:ring-brand-500/30">
              <ListTodo className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </span>
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nothing on your list
            </p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Tap the mic while you are commuting, cooking, or reviewing and your
              task lands here.
            </p>
          </div>
        ) : (
          <div className={cn(panel, "divide-y divide-zinc-100 p-1.5 dark:divide-zinc-800")}>
            {open.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                busy={busyId === task.id}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onSave={handleSave}
              />
            ))}
          </div>
        )}
      </section>

      {/* Done */}
      {done.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Done ({done.length})
            </h2>
            <button
              type="button"
              onClick={handleClearCompleted}
              disabled={clearing}
              className={ghostButton}
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Clear finished
            </button>
          </div>

          <div className={cn(panel, "divide-y divide-zinc-100 p-1.5 dark:divide-zinc-800")}>
            {done.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                busy={busyId === task.id}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onSave={handleSave}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
