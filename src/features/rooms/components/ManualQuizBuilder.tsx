"use client";

// Manual room quiz (feature 6.13) — the host writes the questions themselves.
//
// The same draft rules the server action re-checks live in `../lib/manualQuiz`,
// so the builder can show whether each question is complete and disable Start
// while one isn't. Starting submits the completed drafts, which open the usual
// waiting room (ready-up) before the first question.

import { useState } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blankQuestion,
  isManualQuestionComplete,
  MANUAL_LIMITS,
  type ManualQuestionDraft,
} from "../lib/manualQuiz";

const panel =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const field =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:brightness-105 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60";

const TYPE_OPTIONS = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "true_false", label: "True / False" },
  { value: "short_answer", label: "Short answer" },
] as const;

/** Mirrors MAX_QUESTION_AUDIO_BYTES in features/rooms/server/quizAudio.ts. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "opus", "webm", "m4a", "aac", "flac"];

/**
 * Is this drop an audio clip? There is deliberately no upload button anywhere
 * in this form, so a file that isn't audio is ignored silently rather than
 * producing a message about audio the form never mentions.
 */
function looksLikeAudio(file: File) {
  if (file.type.toLowerCase().startsWith("audio/")) return true;
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => name.endsWith(`.${extension}`));
}

export function ManualQuizBuilder({
  durations,
  seconds,
  onSecondsChange,
  busy,
  onSubmit,
  roomId,
}: {
  durations: readonly number[];
  seconds: number;
  onSecondsChange: (value: number) => void;
  busy: boolean;
  onSubmit: (questions: ManualQuestionDraft[], title: string) => void;
  /** Room the clip is saved into — the upload route is room-scoped. */
  roomId: string;
}) {
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<ManualQuestionDraft[]>(() => [
    blankQuestion(),
    blankQuestion(),
    blankQuestion(),
  ]);
  const [error, setError] = useState<string | null>(null);
  // Which question is being dropped on / has an upload in flight.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [audioBusy, setAudioBusy] = useState<number | null>(null);

  const ready = drafts.filter(isManualQuestionComplete);
  const canStart =
    !busy && ready.length >= MANUAL_LIMITS.min && ready.length <= MANUAL_LIMITS.max;

  function patch(index: number, changes: Partial<ManualQuestionDraft>) {
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, ...changes } : draft))
    );
  }

  function setType(index: number, type: ManualQuestionDraft["type"]) {
    setDrafts((prev) =>
      prev.map((draft, i) => {
        if (i !== index) return draft;
        if (type === "true_false") {
          return {
            ...draft,
            type,
            correctAnswer:
              draft.correctAnswer === "True" || draft.correctAnswer === "False"
                ? draft.correctAnswer
                : "True",
          };
        }
        if (type === "short_answer") return { ...draft, type, correctAnswer: "" };
        const options =
          draft.options.length >= 2 ? draft.options : ["", "", "", ""];
        return {
          ...draft,
          type,
          options,
          correctAnswer: options.includes(draft.correctAnswer)
            ? draft.correctAnswer
            : "",
        };
      })
    );
  }

  function setOption(questionIndex: number, optionIndex: number, value: string) {
    setDrafts((prev) =>
      prev.map((draft, i) => {
        if (i !== questionIndex) return draft;
        const previous = draft.options[optionIndex] ?? "";
        const options = [...draft.options];
        options[optionIndex] = value;
        return {
          ...draft,
          options,
          // Keep the marked answer in step when its option text is edited.
          correctAnswer:
            draft.correctAnswer === previous.trim()
              ? value.trim()
              : draft.correctAnswer,
        };
      })
    );
  }

  function addQuestion() {
    setDrafts((prev) =>
      prev.length >= MANUAL_LIMITS.max ? prev : [...prev, blankQuestion()]
    );
  }

  /**
   * Save a dropped clip into the room's folder and hang it on the question.
   * The draft keeps only the minted key plus the name shown on screen; the
   * bytes are never held in component state.
   */
  async function attachAudio(index: number, file: File) {
    if (audioBusy !== null) return;
    // Not audio: ignore it. Nothing in this form advertises the drop target,
    // so a stray PDF should not produce a message that does.
    if (!looksLikeAudio(file)) return;
    if (file.size > MAX_AUDIO_BYTES) {
      setError("That audio file is too large (8 MB max).");
      return;
    }

    const previous = drafts[index]?.audio?.key ?? null;
    setAudioBusy(index);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/rooms/${roomId}/quiz-audio`, {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        key?: string;
        name?: string;
      } | null;
      if (!response.ok || !data?.key) {
        throw new Error(data?.error ?? "Could not save that audio");
      }
      // Replacing (or re-dropping) shouldn't leave the old bytes behind.
      if (previous) {
        void fetch(`/api/rooms/${roomId}/quiz-audio/${previous}`, {
          method: "DELETE",
        });
      }
      patch(index, { audio: { key: data.key, name: data.name ?? file.name } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that audio");
    } finally {
      setAudioBusy(null);
    }
  }

  function handleDrop(index: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragIndex(null);
    const file = event.dataTransfer?.files?.[0];
    if (file) void attachAudio(index, file);
  }

  function removeAudio(index: number) {
    const key = drafts[index]?.audio?.key;
    if (key) {
      void fetch(`/api/rooms/${roomId}/quiz-audio/${key}`, { method: "DELETE" });
    }
    patch(index, { audio: null });
  }

  function removeQuestion(index: number) {
    setDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)
    );
  }

  function handleStart() {
    if (ready.length < MANUAL_LIMITS.min) {
      setError(
        `Write at least ${MANUAL_LIMITS.min} complete questions — each needs a question and a correct answer.`
      );
      return;
    }
    setError(null);
    onSubmit(ready.slice(0, MANUAL_LIMITS.max), title.trim());
  }

  return (
    <div className="mt-4 space-y-3">
      <div className={cn(panel, "space-y-3 p-4")}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Quiz title (optional) — e.g. Cell division review"
          maxLength={200}
          aria-label="Quiz title"
          className={field}
        />
        <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
          Write {MANUAL_LIMITS.min}–{MANUAL_LIMITS.max} questions. The room plays
          them like any other live quiz: everyone readies up, then each question
          is read aloud and answered by voice.
        </p>
      </div>

      {drafts.map((draft, index) => {
        const complete = isManualQuestionComplete(draft);
        return (
          <div key={index} className={cn(panel, "space-y-3 p-4")}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {index + 1}
              </span>
              <select
                value={draft.type}
                onChange={(event) =>
                  setType(index, event.target.value as ManualQuestionDraft["type"])
                }
                aria-label={`Question ${index + 1} type`}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span
                className={cn(
                  "ml-auto text-[11px] font-medium",
                  complete
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                {complete ? "Ready" : "Incomplete"}
              </span>
              {drafts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeQuestion(index)}
                  aria-label={`Remove question ${index + 1}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                // Without preventDefault the browser refuses the drop (or
                // inserts the dragged text into the textarea instead).
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragIndex(index);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) {
                  return;
                }
                setDragIndex((current) => (current === index ? null : current));
              }}
              onDrop={(event) => handleDrop(index, event)}
              className={cn(
                "rounded-xl transition-colors",
                dragIndex === index &&
                  "bg-brand-50 ring-2 ring-brand-400/70 dark:bg-brand-500/10 dark:ring-brand-500/40"
              )}
            >
              <textarea
                value={draft.question}
                onChange={(event) => patch(index, { question: event.target.value })}
                placeholder="Type the question…"
                rows={2}
                maxLength={500}
                aria-label={`Question ${index + 1} text`}
                className={cn(field, "resize-y")}
              />

              {draft.audio && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  <span className="truncate">
                    {audioBusy === index ? "Saving audio…" : draft.audio.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAudio(index)}
                    aria-label="Remove the audio attached to this question"
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {draft.type === "multiple_choice" && (
              <div className="space-y-2">
                {draft.options.map((option, optionIndex) => {
                  const canMark = option.trim().length > 0;
                  const marked = canMark && draft.correctAnswer === option.trim();
                  const mark = () => {
                    if (canMark) patch(index, { correctAnswer: option.trim() });
                  };
                  return (
                    // The whole row marks the option, not just the small circle,
                    // so the target is easy to hit (especially on a phone).
                    <div
                      key={optionIndex}
                      onClick={mark}
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-1 py-0.5 transition-colors",
                        canMark &&
                          "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      )}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          mark();
                        }}
                        aria-pressed={marked}
                        title={
                          marked ? "Correct answer" : "Mark as the correct answer"
                        }
                        aria-label={`Mark option ${optionIndex + 1} correct`}
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          canMark && "cursor-pointer",
                          marked
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-zinc-300 text-transparent hover:border-emerald-400 dark:border-zinc-600"
                        )}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <input
                        value={option}
                        onChange={(event) =>
                          setOption(index, optionIndex, event.target.value)
                        }
                        onClick={(event) => event.stopPropagation()}
                        placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                        maxLength={200}
                        aria-label={`Question ${index + 1} option ${optionIndex + 1}`}
                        className={field}
                      />
                    </div>
                  );
                })}
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Leave blanks unused. Click an option (or its circle) to mark the
                  correct answer.
                </p>
              </div>
            )}

            {draft.type === "true_false" && (
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                Correct answer
                <select
                  value={draft.correctAnswer || "True"}
                  onChange={(event) =>
                    patch(index, { correctAnswer: event.target.value })
                  }
                  aria-label={`Question ${index + 1} correct answer`}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="True">True</option>
                  <option value="False">False</option>
                </select>
              </label>
            )}

            {draft.type === "short_answer" && (
              <input
                value={draft.correctAnswer}
                onChange={(event) =>
                  patch(index, { correctAnswer: event.target.value })
                }
                placeholder="Correct answer (a short phrase)"
                maxLength={120}
                aria-label={`Question ${index + 1} correct answer`}
                className={field}
              />
            )}

            <input
              value={draft.explanation}
              onChange={(event) => patch(index, { explanation: event.target.value })}
              placeholder="Explanation (optional)"
              maxLength={200}
              aria-label={`Question ${index + 1} explanation`}
              className={field}
            />
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addQuestion}
          disabled={drafts.length >= MANUAL_LIMITS.max}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          Add question
        </button>

        <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Seconds each
          <select
            value={seconds}
            onChange={(event) => onSecondsChange(Number(event.target.value))}
            aria-label="Seconds per question"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {durations.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className={primaryButton}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Start live quiz
        </button>

        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {ready.length} of {MANUAL_LIMITS.min} ready
        </span>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/30">
          {error}
        </p>
      )}
    </div>
  );
}
