"use client";

// Voice Navigation Mode (feature 6.14) — the on-screen console.
//
// The floating button is always available; the panel opens above it and doubles
// as the spoken help: what EduVoice is listening for, what is on the current
// page, and the running transcript. It is built to be readable at large sizes
// and announced to screen readers (aria-live), so it works for a student who
// cannot see it as well as one who can.

import { AnimatePresence, motion } from "motion/react";
import {
  Accessibility,
  CornerDownLeft,
  Languages,
  ListOrdered,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceNav } from "../context";
import { BUILTIN_COMMANDS, navCommands } from "../lib/commands";
import type { DetectedLanguage } from "@/features/chat/lib/detect";

const LANGUAGES: { id: DetectedLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fil", label: "Filipino" },
  { id: "ceb", label: "Cebuano" },
];

const GROUP_ORDER = ["Control", "Listen", "Move", "Screen"] as const;

function StatusDot({ phase }: { phase: string }) {
  if (phase === "speaking") return <Volume2 className="h-3.5 w-3.5 text-brand-500" />;
  if (phase === "thinking")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />;
  if (phase === "listening")
    return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />;
  return <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />;
}

export function VoiceNavOverlay() {
  const nav = useVoiceNav();

  const { enabled, phase, status, heard, feedback, notice } = nav;

  return (
    <div data-voice-nav className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-end gap-3 p-4 sm:p-6">
      <AnimatePresence>
        {enabled && nav.panelOpen && (
          <motion.section
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            role="region"
            aria-label="Voice navigation"
            className="pointer-events-auto flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {/* Header */}
            <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950">
                <Accessibility className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Voice navigation
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <StatusDot phase={phase} />
                  {status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => nav.setPanelOpen(false)}
                aria-label="Hide the voice navigation commands"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {/* Live status + transcript */}
              <div className="space-y-2">
                <div
                  aria-live="polite"
                  aria-atomic="true"
                  className="rounded-2xl border border-brand-200 bg-brand-50/70 px-3.5 py-2.5 text-sm leading-6 text-zinc-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-zinc-100"
                >
                  {feedback || "Say a command — try “go to the quiz” or “help”."}
                </div>
                {heard && (
                  <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Heard: <span className="italic">“{heard}”</span>
                  </p>
                )}
                {notice && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
                    {notice}
                  </p>
                )}
              </div>

              {/* Listening language */}
              <label className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                <span className="flex items-center gap-2">
                  <Languages className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                  Listening in
                </span>
                <select
                  value={nav.language}
                  onChange={(event) =>
                    nav.setLanguage(event.target.value as DetectedLanguage)
                  }
                  aria-label="Command language"
                  className="rounded-full bg-transparent py-1 font-medium text-zinc-800 outline-none dark:text-zinc-100"
                >
                  {LANGUAGES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="px-1 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
                EduVoice answers in the language it hears — Filipino, Cebuano or
                English — whichever is set here.
              </p>

              {/* This page's own commands */}
              {nav.pageCommands.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    On this page
                  </h3>
                  <ul className="space-y-1.5">
                    {nav.pageCommands.map((command) => (
                      <li
                        key={command.id}
                        className="rounded-xl border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                      >
                        <p className="text-sm text-zinc-700 dark:text-zinc-200">
                          {command.description}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                          Say “{command.phrases[0]}”
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Built-in commands */}
              {GROUP_ORDER.map((group) => {
                const items = BUILTIN_COMMANDS.filter((c) => c.group === group);
                if (items.length === 0) return null;
                return (
                  <section key={group}>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {group}
                    </h3>
                    <ul className="space-y-1.5">
                      {items.map((command) => (
                        <li
                          key={command.id}
                          className="flex flex-col rounded-xl border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                        >
                          <p className="text-sm text-zinc-700 dark:text-zinc-200">
                            {command.description}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                            {command.examples.map((e) => `“${e}”`).join(" · ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}

              {/* Navigation */}
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Go to
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {navCommands.map((target) => (
                    <span
                      key={target.href}
                      className="rounded-full bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600 ring-1 ring-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700"
                    >
                      “{target.label}”
                    </span>
                  ))}
                </div>
              </section>

              {/* On-screen items */}
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    <ListOrdered className="h-3.5 w-3.5" />
                    On screen ({nav.targets.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => nav.refreshTargets()}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Rescan
                  </button>
                </div>

                {nav.targets.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                    No buttons or links detected yet. Say “rescan the page”.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {nav.targets.slice(0, 40).map((target) => (
                      <li key={target.index}>
                        <button
                          type="button"
                          onClick={() => nav.activateIndex(target.index)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                            nav.cursor === target.index
                              ? "bg-brand-50 text-brand-900 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/40"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          )}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
                            {target.index}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{target.label}</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                            <CornerDownLeft className="h-3 w-3" />
                            {target.index}
                          </span>
                        </button>
                      </li>
                    ))}
                    {nav.targets.length > 40 && (
                      <li className="px-2.5 pt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                        Showing the first 40 of {nav.targets.length}.
                      </li>
                    )}
                  </ul>
                )}
              </section>

              <p className="text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
                Tip: press <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Alt</kbd>{" "}
                + <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">V</kbd> anywhere to
                turn voice navigation on or off. Say “stop” any time to silence EduVoice.
              </p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Floating control */}
      <div className="pointer-events-auto flex items-center gap-2">
        {enabled && !nav.panelOpen && (
          <button
            type="button"
            onClick={() => nav.setPanelOpen(true)}
            className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-3.5 py-2 text-xs font-medium text-zinc-600 shadow-lg backdrop-blur transition-colors hover:text-zinc-900 sm:flex dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            <StatusDot phase={phase} />
            {status}
          </button>
        )}

        <button
          type="button"
          onClick={nav.toggle}
          aria-pressed={enabled}
          aria-label={
            enabled ? "Turn off voice navigation" : "Turn on voice navigation"
          }
          title={enabled ? "Turn off voice navigation (Alt+V)" : "Voice navigation (Alt+V)"}
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-all duration-200",
            enabled
              ? "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-brand-500/40"
              : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:text-zinc-100"
          )}
        >
          {enabled ? (
            phase === "speaking" ? (
              <Square className="h-5 w-5" />
            ) : (
              <Mic className="h-6 w-6 animate-pulse" />
            )
          ) : (
            <Accessibility className="h-6 w-6" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Small badge used by the dashboard topbar to expose the mode outside the panel. */
export function VoiceNavToggle() {
  const nav = useVoiceNav();
  return (
    <button
      type="button"
      onClick={nav.toggle}
      aria-pressed={nav.enabled}
      aria-label={
        nav.enabled ? "Turn off voice navigation" : "Turn on voice navigation"
      }
      title={nav.enabled ? "Voice navigation is on (Alt+V)" : "Turn on voice navigation (Alt+V)"}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
        nav.enabled
          ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      )}
    >
      {nav.enabled ? (
        nav.phase === "speaking" ? (
          <Square className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )
      ) : (
        <MicOff className="h-4 w-4" />
      )}
    </button>
  );
}
