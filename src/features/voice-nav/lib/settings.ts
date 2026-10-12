// Voice Navigation Mode (feature 6.14) — persisted preferences.
//
// Which language to listen in and whether the mode was left on live in
// localStorage, but reading them back inside an effect that calls setState would
// cascade renders (and the server has no localStorage at all). Following the
// pattern already used by hands-free task capture, they are exposed as a tiny
// external store read through useSyncExternalStore.

import type { DetectedLanguage } from "@/features/chat/lib/detect";

const ENABLED_KEY = "voiceNavEnabled";
const LANG_KEY = "voiceNavLang";

let cachedEnabled: boolean | null = null;
let cachedLang: DetectedLanguage | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Client snapshot: was voice navigation left on? */
export function readEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    cachedEnabled = window.localStorage.getItem(ENABLED_KEY) === "on";
  } catch {
    // Private mode / blocked storage — start off.
    cachedEnabled = false;
  }
  return cachedEnabled;
}

export function writeEnabled(on: boolean): void {
  cachedEnabled = on;
  try {
    window.localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Choice just won't persist.
  }
  emit();
}

/** Client snapshot: which language to listen in. */
export function readLang(): DetectedLanguage {
  if (cachedLang) return cachedLang;
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    cachedLang = saved === "fil" || saved === "ceb" ? saved : "en";
  } catch {
    cachedLang = "en";
  }
  return cachedLang;
}

export function writeLang(lang: DetectedLanguage): void {
  cachedLang = lang;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Choice just won't persist.
  }
  emit();
}

/** Stable server snapshots (a fresh value here would loop the store). */
export function serverEnabled(): boolean {
  return false;
}

export function serverLang(): DetectedLanguage {
  return "en";
}
