// Fixed lines the tutor says, pre-generated as WAV files (features: voice mode,
// voice navigation).
//
// Voice mode opens with a line that depends on the study mode the student is
// in, and voice navigation answers nearly every command with the same handful of
// sentences — "Opening the quiz.", "Scrolled up.", "Sorry, I did not catch
// that." None of those words ever change, so synthesizing them through Gemini
// TTS on every call would spend a request on a sentence we already know. Each
// one is rendered once into `data/phrases/<key>.wav` (see
// server/speechStore.ts and scripts/generate-phrases.ts), and that folder is
// committed, so a line costs a disk read instead of a TTS request for every
// student who ever hears it.
//
// What belongs here: a line that is the same words for everyone, every time.
// What does not: anything carrying a page label, an item number or the page's
// own text. Those are different every time they are spoken, so they stay with
// the ordinary synthesis path (see lib/speechEngine.ts).
//
// Client-safe: plain data, no Node APIs. The client only needs the key + text;
// the server needs the style used when the file was generated.

import type { VoiceStyle } from "./voices";

/** One line in the pre-generated bank: what to say, and how to say it. */
export type PhraseLine = {
  /** File key under data/phrases — also the id the app looks the line up by. */
  key: string;
  /** What the tutor says, and what the student reads in the transcript. */
  text: string;
  /** Voice style the file was generated with, so a regeneration sounds right. */
  style: VoiceStyle;
};

// ---------------------------------------------------------------------------
// Voice mode openers
// ---------------------------------------------------------------------------

export type VoiceOpener = {
  /** Chat mode id this line belongs to. */
  mode: "chat" | "hint" | "debate" | "interview";
  /** File key under data/phrases — also the cache key for the audio bytes. */
  key: string;
  /** What the tutor says, and what the student reads in the transcript. */
  text: string;
  /** Voice style the file was generated with, so a regeneration sounds right. */
  style: VoiceStyle;
};

// Each opener is deliberately self-contained: it invites the student to speak
// next, so nothing in it depends on a conversation the model has not seen yet.
export const VOICE_OPENERS: VoiceOpener[] = [
  {
    mode: "chat",
    key: "phrase-chat",
    text: "Hi, I'm EduVoice. What would you like to learn today?",
    style: "tutor",
  },
  {
    mode: "hint",
    key: "phrase-hint",
    text: "Hint mode is on. Tell me the problem you're working on, and I'll give you one clue to start.",
    style: "hint",
  },
  {
    mode: "debate",
    key: "phrase-debate",
    text: "I'm ready to debate. Tell me the topic and which side you're taking, and I'll argue the opposite.",
    style: "debate",
  },
  {
    mode: "interview",
    key: "phrase-interview",
    text: "Let's start your interview practice. Tell me the role you're applying for, and I'll ask the first question.",
    style: "interview",
  },
];

/** The opener for a chat mode, or null when the mode has none. */
export function openerFor(mode: string | undefined): VoiceOpener | null {
  return VOICE_OPENERS.find((opener) => opener.mode === mode) ?? null;
}

// ---------------------------------------------------------------------------
// Voice navigation
// ---------------------------------------------------------------------------

// Voice navigation (feature 6.14) talks back on almost every command: the mode
// switched on, a scroll, a page it could not find an item on, the list of things
// it can be told. Every one of those confirmations is fixed text, which means
// every one of them would otherwise write a new file into `data/speech/` and
// spend a TTS request the first time any student hears it.
//
// These lines are voiced with the plain tutoring style, matching what the
// provider used to ask for (it sent no style at all). Anything with a label or a
// number in it — "Opening Tasks.", "3. Quiz options", "5 items on this page." —
// is deliberately absent and stays on the synthesizing path.
export const VOICE_NAV_LINES = [
  {
    key: "nav-on",
    text: "Voice navigation is on. Say help to hear the commands.",
    style: "tutor",
  },
  {
    key: "nav-help",
    text:
      "Voice navigation commands. Say a page name such as quiz, chat, tasks " +
      "or progress. Say click three to open an item, next and select to move " +
      "and choose, read the page to hear it, or stop to be quiet.",
    style: "tutor",
  },
  {
    key: "nav-no-catch",
    text: "Sorry, I did not catch that. Say help for the list of commands.",
    style: "tutor",
  },
  {
    key: "nav-nothing-to-move",
    text: "There is nothing to move through on this page.",
    style: "tutor",
  },
  {
    key: "nav-nothing-to-select",
    text: "There is nothing to select on this page.",
    style: "tutor",
  },
  {
    key: "nav-nothing-to-repeat",
    text: "There is nothing to repeat yet.",
    style: "tutor",
  },
  {
    key: "nav-nothing-to-read",
    text: "This page has nothing to read yet.",
    style: "tutor",
  },
  { key: "nav-scrolled-up", text: "Scrolled up.", style: "tutor" },
  { key: "nav-scrolled-down", text: "Scrolled down.", style: "tutor" },
  { key: "nav-top", text: "At the top of the page.", style: "tutor" },
  { key: "nav-bottom", text: "At the bottom of the page.", style: "tutor" },
  { key: "nav-back", text: "Going back.", style: "tutor" },

  // Confirmations for the actions a screen registers itself (see
  // PageCommand.spokenKey in features/voice-nav/context.tsx). The quiz page is
  // the only screen that registers voice commands today.
  { key: "nav-quiz-start", text: "Starting the quiz.", style: "tutor" },
  { key: "nav-quiz-submit", text: "Submitting your answers.", style: "tutor" },
  { key: "nav-quiz-leave", text: "Back to the quiz lobby.", style: "tutor" },
] as const satisfies readonly PhraseLine[];

/** Every fixed voice-navigation line, by key. */
export type VoiceNavKey = (typeof VOICE_NAV_LINES)[number]["key"];

const VOICE_NAV_LINE_BY_KEY = Object.fromEntries(
  VOICE_NAV_LINES.map((line) => [line.key, line])
) as Record<VoiceNavKey, PhraseLine>;

/** The fixed line for a voice-navigation announcement. */
export function voiceNavLine(key: VoiceNavKey): PhraseLine {
  return VOICE_NAV_LINE_BY_KEY[key];
}

/**
 * "Opening the quiz." — one line per dashboard destination.
 *
 * Navigating by voice is the command students use most ("go to the quiz"), and
 * its confirmation names a page from a fixed list, so it is worth a recording
 * like any other fixed line. A destination that is missing from this table still
 * works: the provider falls back to synthesizing the page's own label.
 */
const NAV_OPENERS = [
  { href: "/dashboard", key: "nav-open-overview", text: "Opening your overview.", style: "tutor" },
  { href: "/dashboard/chat", key: "nav-open-chat", text: "Opening the chat.", style: "tutor" },
  { href: "/dashboard/quiz", key: "nav-open-quiz", text: "Opening the quiz.", style: "tutor" },
  { href: "/dashboard/tasks", key: "nav-open-tasks", text: "Opening your tasks.", style: "tutor" },
  { href: "/dashboard/rooms", key: "nav-open-rooms", text: "Opening the study rooms.", style: "tutor" },
  { href: "/dashboard/progress", key: "nav-open-progress", text: "Opening your progress.", style: "tutor" },
] as const satisfies readonly (PhraseLine & { href: string })[];

/** The fixed "Opening …" line for a dashboard route, or null when it has none. */
export function navOpenerFor(href: string): PhraseLine | null {
  return NAV_OPENERS.find((entry) => entry.href === href) ?? null;
}

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

/** Every line in the committed bank — the list scripts/generate-phrases.ts walks. */
export const PHRASE_BANK: PhraseLine[] = [
  ...VOICE_OPENERS,
  ...VOICE_NAV_LINES,
  ...NAV_OPENERS,
];
