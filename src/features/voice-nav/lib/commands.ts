// Voice Navigation Mode (feature 6.14) — the command grammar.
//
// Everything the student can say is described here as plain data so the parser,
// the spoken help and the on-screen cheat-sheet all read from one source. The
// vocabulary deliberately spans English, Filipino and Cebuano, matching the rest
// of EduVoice (feature 6.5): a student who speaks Bisaya can drive the whole
// interface without switching to English.
//
// This module is dependency-free and client-safe (no DOM, no React) so it can be
// unit-tested and reused by the overlay.

import { dashboardNav } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Normalisation + matching
// ---------------------------------------------------------------------------

/**
 * Lowercase, strip punctuation and collapse whitespace so a spoken phrase
 * compares cleanly against the tables below. Accents are kept (Filipino rarely
 * needs them in commands) but the surrounding noise like "please" punctuation is
 * removed.
 */
export function normalizeCommand(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9\u00f1\u00e9\u00e8\u00e1\u00e0\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** True when `phrase` appears in `text` on word boundaries (both pre-normalised). */
export function phraseMatches(text: string, phrase: string): boolean {
  const needle = phrase.toLowerCase().trim();
  if (!needle) return false;
  // Word boundaries on both sides so "room" doesn't fire inside "classroom".
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/** First phrase from `phrases` found in `text`, or null. */
export function firstMatch(text: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (phraseMatches(text, phrase)) return phrase;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Navigation ("go to the quiz", "pumunta sa dokumento", "adto sa istorya")
// ---------------------------------------------------------------------------

export type NavCommand = {
  /** Dashboard route this phrase opens, e.g. "/dashboard/quiz". */
  href: string;
  /** Human label used in spoken/visual feedback. */
  label: string;
  /** Spoken and typed phrases that mean "open this page". */
  phrases: string[];
};

/**
 * One entry per dashboard destination. `dashboardNav` is the source of truth for
 * the href/label pair so a new section added to the sidebar is picked up here
 * automatically; this table only adds the spoken synonyms. Any href missing from
 * the table still works via its plain label (see `navCommands`).
 */
const NAV_SYNONYMS: Record<string, string[]> = {
  "/dashboard": [
    "dashboard",
    "home",
    "overview",
    "main menu",
    "main page",
    "start",
    "go home",
    "pumunta sa dashboard",
    "bahay",
    "simula",
    "adto sa dashboard",
    "sugod",
  ],
  "/dashboard/chat": [
    "chat",
    "chats",
    "talk to the tutor",
    "ask a question",
    "conversation",
    "message the tutor",
    "usap",
    "kausapin ang tutor",
    "magtanong",
    "istorya",
    "pangutana",
  ],
  "/dashboard/quiz": [
    "quiz",
    "quizzes",
    "take a quiz",
    "start a quiz",
    "practice test",
    "test me",
    "exam",
    "pagsusulit",
    "pagsulay",
  ],
  "/dashboard/documents": [
    "document",
    "documents",
    "upload",
    "upload a document",
    "upload file",
    "upload notes",
    "my files",
    "pdf",
    "notes",
    "dokumento",
    "i-upload ang dokumento",
    "mag-upload",
    "mga file",
  ],
  "/dashboard/flashcards": [
    "flashcard",
    "flashcards",
    "cards",
    "review cards",
    "kard",
    "mga kard",
  ],
  "/dashboard/tasks": [
    "task",
    "tasks",
    "to do",
    "todo",
    "to-do",
    "reminder",
    "reminders",
    "checklist",
    "gawain",
    "takdang aralin",
    "mga gawain",
    "buluhaton",
    "lista sa buhaton",
  ],
  "/dashboard/rooms": [
    "room",
    "rooms",
    "study room",
    "study rooms",
    "group study",
    "leaderboard",
    "silid",
    "grupo",
    "lawak",
    "estudyante",
  ],
  "/dashboard/progress": [
    "progress",
    "score",
    "scores",
    "stats",
    "statistics",
    "performance",
    "grades",
    "pag-unlad",
    "progreso",
    "puntos",
    "kalamboan",
    "grado",
  ],
};

/** The navigation destinations, ready to match against a spoken phrase. */
export const navCommands: NavCommand[] = dashboardNav.map((item) => ({
  href: item.href,
  label: item.label,
  // Synonyms first (longer, more specific phrases), then the plain label.
  phrases: [...(NAV_SYNONYMS[item.href] ?? []), item.label.toLowerCase()],
}));

// ---------------------------------------------------------------------------
// Built-in commands (help, stop, scroll, read the page, ...)
// ---------------------------------------------------------------------------

export type BuiltinId =
  | "help"
  | "stop"
  | "repeat"
  | "read-page"
  | "scroll-up"
  | "scroll-down"
  | "scroll-top"
  | "scroll-bottom"
  | "back"
  | "next"
  | "previous"
  | "activate"
  | "refresh-targets"
  | "turn-off"
  | "turn-on";

export type BuiltinCommand = {
  id: BuiltinId;
  /** Cheat-sheet group heading. */
  group: "Control" | "Listen" | "Move" | "Screen";
  /** One-line explanation shown in the help panel. */
  description: string;
  phrases: string[];
  /** Reading this phrase out loud is part of the tutorial. */
  examples: string[];
};

/**
 * Priority-ordered: the parser returns the first command whose key phrases
 * appear in the utterance. Longer, more specific phrases must come before their
 * shorter cousins ("scroll to top" before "top"), which is why `scroll-top` sits
 * before `scroll-down`'s plain "down" — see `parseVoiceCommand`.
 */
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    id: "turn-off",
    group: "Control",
    description: "Turn Voice Navigation off and stop listening.",
    phrases: [
      "turn off voice navigation",
      "stop voice navigation",
      "exit voice navigation",
      "close voice navigation",
      "disable voice navigation",
      "voice navigation off",
      "isara ang voice navigation",
      "sirad-i ang voice navigation",
    ],
    examples: ["turn off voice navigation"],
  },
  {
    id: "turn-on",
    group: "Control",
    description: "Turn Voice Navigation on.",
    phrases: [
      "turn on voice navigation",
      "start voice navigation",
      "enable voice navigation",
      "voice navigation on",
    ],
    examples: ["turn on voice navigation"],
  },
  {
    id: "help",
    group: "Control",
    description: "Read the list of commands and open the help panel.",
    phrases: [
      "help",
      "what can i say",
      "what can i do",
      "voice commands",
      "show commands",
      "list commands",
      "tulong",
      "tabang",
      "unsa ang masulti nako",
    ],
    examples: ["help", "what can I say"],
  },
  {
    id: "stop",
    group: "Control",
    description: "Stop the tutor talking and cancel the current answer.",
    phrases: [
      "stop",
      "be quiet",
      "quiet",
      "silence",
      "shut up",
      "cancel",
      "never mind",
      "tigil",
      "tumahimik",
      "itinigil",
      "hunong",
      "hilom",
    ],
    examples: ["stop"],
  },
  {
    id: "repeat",
    group: "Listen",
    description: "Say the last feedback message again.",
    phrases: [
      "repeat",
      "say that again",
      "say it again",
      "again",
      "what did you say",
      "ulitin",
      "muli",
      "usba",
      "balika",
    ],
    examples: ["repeat that"],
  },
  {
    id: "read-page",
    group: "Listen",
    description: "Read the current page's heading and text aloud.",
    phrases: [
      "read the page",
      "read this page",
      "read the screen",
      "read it to me",
      "read aloud",
      "basahin",
      "basahin mo",
      "basaha",
    ],
    examples: ["read the page"],
  },
  {
    id: "scroll-top",
    group: "Move",
    description: "Jump to the top of the page.",
    phrases: [
      "scroll to top",
      "go to top",
      "back to top",
      "top of page",
      "pataas sa itaas",
      "taas sa page",
    ],
    examples: ["scroll to top"],
  },
  {
    id: "scroll-bottom",
    group: "Move",
    description: "Jump to the bottom of the page.",
    phrases: [
      "scroll to bottom",
      "go to bottom",
      "bottom of page",
      "end of page",
      "ibaba sa ubos",
      "ubos sa page",
    ],
    examples: ["scroll to bottom"],
  },
  {
    id: "scroll-down",
    group: "Move",
    description: "Scroll down a screen.",
    phrases: ["scroll down", "page down", "go down", "move down", "ibaba", "pababa", "ubos"],
    examples: ["scroll down"],
  },
  {
    id: "scroll-up",
    group: "Move",
    description: "Scroll up a screen.",
    phrases: ["scroll up", "page up", "go up", "move up", "itaas", "pataas", "taas"],
    examples: ["scroll up"],
  },
  {
    id: "back",
    group: "Move",
    description: "Go back to the previous page.",
    phrases: [
      "go back",
      "back",
      "previous page",
      "return to the last page",
      "bumalik",
      "balik",
      "ibalik",
    ],
    examples: ["go back"],
  },
  {
    id: "next",
    group: "Move",
    description: "Highlight the next item on the screen.",
    phrases: [
      "next",
      "next item",
      "next option",
      "move down the list",
      "sunod",
      "susunod",
      "sunod nga",
    ],
    examples: ["next"],
  },
  {
    id: "previous",
    group: "Move",
    description: "Highlight the previous item on the screen.",
    phrases: [
      "previous",
      "previous item",
      "previous option",
      "move up the list",
      "nakaraan",
      "nauna",
      "miaging",
    ],
    examples: ["previous"],
  },
  {
    id: "activate",
    group: "Move",
    description:
      "Open the highlighted item (same as pressing Enter, or tapping it).",
    phrases: [
      "select",
      "select it",
      "activate",
      "press enter",
      "open it",
      "choose it",
      "piliin",
      "pilia",
      "pindutin",
    ],
    examples: ["select"],
  },
  {
    id: "refresh-targets",
    group: "Screen",
    description: "Re-scan the page for buttons and links that can be opened.",
    phrases: [
      "refresh the list",
      "rescan the page",
      "rescan",
      "update the list",
      "refresh screen",
    ],
    examples: ["rescan the page"],
  },
];

/** Nothing but a bare number: "three", "3". Used by `click <n>`. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  isa: 1,
  dalawa: 2,
  tatlo: 3,
  apat: 4,
  lima: 5,
  usa: 1,
  duha: 2,
  tulo: 3,
  upat: 4,
};

/** Turn "three" / "3" into 3; returns null when it isn't a number at all. */
export function toNumber(token: string): number | null {
  const trimmed = token.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return NUMBER_WORDS[trimmed] ?? null;
}

// ---------------------------------------------------------------------------
// The parsed command
// ---------------------------------------------------------------------------

export type VoiceCommand =
  | { kind: "navigate"; href: string; label: string }
  | { kind: "builtin"; id: BuiltinId }
  /** Open the nth on-screen item, or the one whose label matches `name`. */
  | { kind: "click"; index?: number; name?: string }
  | { kind: "unknown"; text: string };

/**
 * Understand one spoken utterance.
 *
 * Order matters and mirrors how a student thinks: control words ("stop",
 * "help") always win, then movement, then navigation, then clicking a numbered
 * item. Page-specific commands are matched separately (see `matchPageCommand`)
 * and consulted by the provider *before* this function, so a screen's own
 * "start the quiz" overrides the generic navigation vocabulary.
 */
export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = normalizeCommand(raw);
  if (text.trim().length === 0) return { kind: "unknown", text: raw };

  // 1. Control + built-ins, in the table's priority order.
  for (const command of BUILTIN_COMMANDS) {
    if (firstMatch(text, command.phrases)) {
      return { kind: "builtin", id: command.id };
    }
  }

  // 2. Navigation.
  for (const nav of navCommands) {
    if (firstMatch(text, nav.phrases)) {
      return { kind: "navigate", href: nav.href, label: nav.label };
    }
  }

  // 3. Clicking an on-screen item: "click 3", "number three", "open the quiz".
  const click = parseClick(text);
  if (click) return click;

  return { kind: "unknown", text: raw };
}

/** "click 3", "number three", "option 2", "open tasks" → a click command. */
function parseClick(text: string): VoiceCommand | null {
  // Numeric forms first — they are unambiguous.
  const numeric = text.match(
    /\b(?:click|press|number|option|item|open|select|pumili|pilia)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|isa|dalawa|tatlo|apat|lima|usa|duha|tulo|upat)\b/
  );
  if (numeric) {
    const index = toNumber(numeric[1]);
    if (index !== null) return { kind: "click", index };
  }

  // Named form: the words after the click verb identify the item.
  const named = text.match(
    /\b(?:click|press|tap|open|select|choose|pumili|pilia|pindutin)\s+(?:the\s+)?(.+?)\s*$/
  );
  if (named) {
    const name = named[1].trim();
    if (name.length > 0) return { kind: "click", name };
  }

  return null;
}

/**
 * Match an utterance against the commands the current page registered.
 * Returns the winning index, or -1. Kept separate from `parseVoiceCommand` so
 * the provider can hand the actual handler (which can't live in plain data).
 */
export function matchPageCommand(
  raw: string,
  pageCommands: readonly { phrases: readonly string[] }[]
): number {
  const text = normalizeCommand(raw);
  for (let i = 0; i < pageCommands.length; i++) {
    if (firstMatch(text, pageCommands[i].phrases)) return i;
  }
  return -1;
}
