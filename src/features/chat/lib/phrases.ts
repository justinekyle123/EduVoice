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
import type { DetectedLanguage } from "./detect";

/** The languages a line can be spoken in: English, Filipino, Cebuano. */
export type PhraseLanguage = DetectedLanguage;

/**
 * A line's words in another language, keyed by that language.
 *
 * English is always `text`; a translation is spoken instead when that is the
 * language the student is working in (see features/voice-nav/context.tsx).
 * Anything missing here simply falls back to `text`, so a half-translated line
 * is still usable.
 */
export type PhraseTranslations = Partial<Record<"fil" | "ceb", string>>;

/** One line in the pre-generated bank: what to say, and how to say it. */
export type PhraseLine = {
  /** File key under data/phrases — also the id the app looks the line up by. */
  key: string;
  /** What the tutor says, and what the student reads in the transcript. */
  text: string;
  /** Voice style the file was generated with, so a regeneration sounds right. */
  style: VoiceStyle;
  /** The same line in Filipino and/or Cebuano, when it has been written. */
  translations?: PhraseTranslations;
};

/**
 * The same line in `lang`, as a different bank key. A translated line is not a
 * separate entry to maintain: its file is `<key>-<lang>.wav`, so the recording
 * for “nav-help-fil” is generated from this line's Filipino text by the same
 * script that renders the English one (scripts/generate-phrases.ts).
 */
export function localizeLine(line: PhraseLine, lang: PhraseLanguage): PhraseLine {
  if (lang === "en") return line;
  const text = line.translations?.[lang];
  if (!text) return line;
  return { key: `${line.key}-${lang}`, text, style: line.style };
}

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
//
// Every line carries its Filipino and Cebuano text (feature 6.5): a student who
// speaks Bisaya or Tagalog hears the confirmation back in the language they
// spoke, not in English. The command words themselves are left untranslated
// inside the sentences — "click three", "next", "select", "stop" are the words
// the parser listens for (lib/commands.ts), so the recording has to say them
// exactly. `npm run phrases:generate` renders each translation to its own file,
// and one that has not been written yet falls back to English (see localizeLine).
export const VOICE_NAV_LINES = [
  {
    key: "nav-on",
    text: "Voice navigation is on. Say help to hear the commands.",
    style: "tutor",
    translations: {
      fil: "Naka-on ang voice navigation. Sabihin ang tulong para marinig ang mga utos.",
      ceb: "Naka-on na ang voice navigation. Ingna ang tabang aron madungog ang mga sugo.",
    },
  },
  {
    key: "nav-help",
    text:
      "Voice navigation commands. Say a page name such as quiz, chat, tasks " +
      "or progress. Say click three to open an item, next and select to move " +
      "and choose, read the page to hear it, or stop to be quiet.",
    style: "tutor",
    translations: {
      fil:
        "Mga utos sa voice navigation. Sabihin ang pangalan ng pahina tulad ng " +
        "quiz, chat, tasks o progress. Sabihin ang click three para buksan ang " +
        "isang item, next at select para lumipat at pumili, read the page para " +
        "marinig ito, o stop para tumahimik.",
      ceb:
        "Mga sugo sa voice navigation. Ingna ang ngalan sa panid sama sa quiz, " +
        "chat, tasks o progress. Ingna ang click three aron ablihan ang usa ka " +
        "butang, next ug select aron molihok ug mopili, read the page aron " +
        "madungog kini, o stop aron mohilom.",
    },
  },
  {
    key: "nav-no-catch",
    text: "Sorry, I did not catch that. Say help for the list of commands.",
    style: "tutor",
    translations: {
      fil: "Pasensya na, hindi ko narinig nang malinaw. Sabihin ang tulong para sa listahan ng mga utos.",
      ceb: "Pasayloa, wala ko madunggi og tarong. Ingna ang tabang aron makita ang lista sa mga sugo.",
    },
  },
  {
    key: "nav-nothing-to-move",
    text: "There is nothing to move through on this page.",
    style: "tutor",
    translations: {
      fil: "Walang malilipatan sa pahinang ito.",
      ceb: "Walay malihokan niining panid.",
    },
  },
  {
    key: "nav-nothing-to-select",
    text: "There is nothing to select on this page.",
    style: "tutor",
    translations: {
      fil: "Walang mapipili sa pahinang ito.",
      ceb: "Walay mapilian niining panid.",
    },
  },
  {
    key: "nav-nothing-to-repeat",
    text: "There is nothing to repeat yet.",
    style: "tutor",
    translations: {
      fil: "Wala pang mauulit.",
      ceb: "Wala pay ikasubli.",
    },
  },
  {
    key: "nav-nothing-to-read",
    text: "This page has nothing to read yet.",
    style: "tutor",
    translations: {
      fil: "Wala pang nababasang teksto sa pahinang ito.",
      ceb: "Wala pay mabasa niining panid.",
    },
  },
  {
    key: "nav-scrolled-up",
    text: "Scrolled up.",
    style: "tutor",
    translations: { fil: "Naka-scroll pataas.", ceb: "Ni-scroll pataas." },
  },
  {
    key: "nav-scrolled-down",
    text: "Scrolled down.",
    style: "tutor",
    translations: { fil: "Naka-scroll pababa.", ceb: "Ni-scroll pababa." },
  },
  {
    key: "nav-top",
    text: "At the top of the page.",
    style: "tutor",
    translations: {
      fil: "Nasa itaas na ng pahina.",
      ceb: "Naa na sa ibabaw sa panid.",
    },
  },
  {
    key: "nav-bottom",
    text: "At the bottom of the page.",
    style: "tutor",
    translations: {
      fil: "Nasa ibaba na ng pahina.",
      ceb: "Naa na sa ubos sa panid.",
    },
  },
  {
    key: "nav-back",
    text: "Going back.",
    style: "tutor",
    translations: { fil: "Bumabalik.", ceb: "Mobalik." },
  },

  // Confirmations for the actions a screen registers itself (see
  // PageCommand.spokenKey in features/voice-nav/context.tsx). The quiz page is
  // the only screen that registers voice commands today.
  {
    key: "nav-quiz-start",
    text: "Starting the quiz.",
    style: "tutor",
    translations: {
      fil: "Sinisimulan ang pagsusulit.",
      ceb: "Gisugdan na ang quiz.",
    },
  },
  {
    key: "nav-quiz-submit",
    text: "Submitting your answers.",
    style: "tutor",
    translations: {
      fil: "Isinusumite ang mga sagot mo.",
      ceb: "Gipadala na ang imong mga tubag.",
    },
  },
  {
    key: "nav-quiz-leave",
    text: "Back to the quiz lobby.",
    style: "tutor",
    translations: {
      fil: "Balik sa quiz lobby.",
      ceb: "Balik sa quiz lobby.",
    },
  },

  // Choosing how to take a quiz that has just been written (see
  // features/quiz/components/QuizUI.tsx).
  {
    key: "nav-quiz-voice",
    text: "Starting the voice quiz. I'll read each question out loud.",
    style: "tutor",
    translations: {
      fil: "Sinisimulan ang voice quiz. Babasahin ko ang bawat tanong.",
      ceb: "Gisugdan na ang voice quiz. Basahon nako ang matag pangutana.",
    },
  },
  {
    key: "nav-quiz-manual",
    text: "Opening the quiz on screen.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang pagsusulit sa screen.",
      ceb: "Giablihan ang quiz sa screen.",
    },
  },
] as const satisfies readonly PhraseLine[];

/** Every fixed voice-navigation line, by key. */
export type VoiceNavKey = (typeof VOICE_NAV_LINES)[number]["key"];

const VOICE_NAV_LINE_BY_KEY = Object.fromEntries(
  VOICE_NAV_LINES.map((line) => [line.key, line])
) as Record<VoiceNavKey, PhraseLine>;

/**
 * The fixed line for a voice-navigation announcement, in `lang` when it has a
 * translation. Defaults to English, so existing callers are unchanged.
 */
export function voiceNavLine(key: VoiceNavKey, lang: PhraseLanguage = "en"): PhraseLine {
  return localizeLine(VOICE_NAV_LINE_BY_KEY[key], lang);
}

// ---------------------------------------------------------------------------
// Voice quiz
// ---------------------------------------------------------------------------

// The voice quiz (feature 6.4) talks in three places: the line it opens with,
// what it says when an answer was right or wrong, and the line that closes the
// run. All of it is fixed text — the score is read off the screen — so all of it
// belongs in the bank rather than being synthesized for the first student to
// hear it.
//
// The verdicts come in several takes on purpose: a quiz asks the same question
// of a student five, ten, fifteen times in a row, and hearing "Correct!" every
// single time wears thin. The player picks one at random, never the one it just
// used. The variant id is the key's suffix, so adding another take is one line
// here and one `npm run phrases:generate`.
export const QUIZ_LINES = [
  {
    key: "quiz-intro",
    text:
      "Voice quiz. I'll read each question and its choices, then listen for your " +
      "answer. Say a letter, or say the answer itself. Say repeat to hear the " +
      "question again, skip to move on, or stop to finish.",
    style: "tutor",
  },

  { key: "quiz-correct-1", text: "Correct, great!", style: "tutor" },
  { key: "quiz-correct-2", text: "That's right!", style: "tutor" },
  { key: "quiz-correct-3", text: "Nice work!", style: "tutor" },
  { key: "quiz-correct-4", text: "Exactly right!", style: "tutor" },

  { key: "quiz-wrong-1", text: "Not quite.", style: "tutor" },
  { key: "quiz-wrong-2", text: "That's not right.", style: "tutor" },
  { key: "quiz-wrong-3", text: "Incorrect.", style: "tutor" },
  { key: "quiz-wrong-4", text: "Not this time.", style: "tutor" },

  {
    key: "quiz-not-heard",
    text: "Sorry, I did not catch that. Say a letter, the answer, or skip.",
    style: "tutor",
  },
  {
    key: "quiz-finished",
    text: "That's the last question. Your score is on screen now.",
    style: "tutor",
  },
] as const satisfies readonly PhraseLine[];

/** The verdicts the player chooses between, so a repeat run doesn't sound it. */
export const QUIZ_CORRECT_KEYS = [
  "quiz-correct-1",
  "quiz-correct-2",
  "quiz-correct-3",
  "quiz-correct-4",
] as const;

export const QUIZ_WRONG_KEYS = [
  "quiz-wrong-1",
  "quiz-wrong-2",
  "quiz-wrong-3",
  "quiz-wrong-4",
] as const;

/** Every fixed voice-quiz line, by key, including the verdict variants. */
export type QuizLineKey =
  | (typeof QUIZ_LINES)[number]["key"]
  | (typeof QUIZ_CORRECT_KEYS)[number]
  | (typeof QUIZ_WRONG_KEYS)[number];

const QUIZ_LINE_BY_KEY = Object.fromEntries(
  QUIZ_LINES.map((line) => [line.key, line])
) as Record<QuizLineKey, PhraseLine>;

/** The fixed line for a voice-quiz announcement. */
export function quizLine(key: QuizLineKey): PhraseLine {
  return QUIZ_LINE_BY_KEY[key];
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * "Opening the quiz." — one line per dashboard destination.
 *
 * Navigating by voice is the command students use most ("go to the quiz"), and
 * its confirmation names a page from a fixed list, so it is worth a recording
 * like any other fixed line. A destination that is missing from this table still
 * works: the provider falls back to synthesizing the page's own label.
 */
const NAV_OPENERS = [
  {
    href: "/dashboard",
    key: "nav-open-overview",
    text: "Opening your overview.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang iyong overview.",
      ceb: "Giablihan ang imong overview.",
    },
  },
  {
    href: "/dashboard/chat",
    key: "nav-open-chat",
    text: "Opening the chat.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang chat.",
      ceb: "Giablihan ang chat.",
    },
  },
  {
    href: "/dashboard/quiz",
    key: "nav-open-quiz",
    text: "Opening the quiz.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang pagsusulit.",
      ceb: "Giablihan ang quiz.",
    },
  },
  {
    href: "/dashboard/tasks",
    key: "nav-open-tasks",
    text: "Opening your tasks.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang iyong mga gawain.",
      ceb: "Giablihan ang imong mga buluhaton.",
    },
  },
  {
    href: "/dashboard/rooms",
    key: "nav-open-rooms",
    text: "Opening the study rooms.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang mga study room.",
      ceb: "Giablihan ang mga study room.",
    },
  },
  {
    href: "/dashboard/progress",
    key: "nav-open-progress",
    text: "Opening your progress.",
    style: "tutor",
    translations: {
      fil: "Binubuksan ang iyong progreso.",
      ceb: "Giablihan ang imong pag-uswag.",
    },
  },
] as const satisfies readonly (PhraseLine & { href: string })[];

/** The fixed "Opening …" line for a dashboard route, or null when it has none. */
export function navOpenerFor(
  href: string,
  lang: PhraseLanguage = "en"
): PhraseLine | null {
  const line = NAV_OPENERS.find((entry) => entry.href === href);
  return line ? localizeLine(line, lang) : null;
}

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

/**
 * The translated variant of every line that carries one, as its own bank entry.
 *
 * A translation is not a second list to keep in sync: it is derived from the
 * English line, so adding `translations` above is all it takes for the generation
 * script to write `<key>-<lang>.wav` on the next run.
 */
function localizedVariants(lines: readonly PhraseLine[]): PhraseLine[] {
  const variants: PhraseLine[] = [];
  for (const line of lines) {
    if (!line.translations) continue;
    for (const [lang, text] of Object.entries(line.translations)) {
      if (text) variants.push({ key: `${line.key}-${lang}`, text, style: line.style });
    }
  }
  return variants;
}

/**
 * Every line in the committed bank — the list scripts/generate-phrases.ts walks.
 * Includes the Filipino and Cebuano recordings, so a local student hears a fixed
 * line from disk in their own language too.
 */
export const PHRASE_BANK: PhraseLine[] = [
  ...VOICE_OPENERS,
  ...VOICE_NAV_LINES,
  ...NAV_OPENERS,
  ...QUIZ_LINES,
  ...localizedVariants([...VOICE_NAV_LINES, ...NAV_OPENERS]),
];
