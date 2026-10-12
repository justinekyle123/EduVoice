// Parsing for Hands-Free Task Capture (feature 6.9).
//
// Kept deterministic on purpose: the activity diagram puts "Extract title and
// due date" in the SYSTEM lane rather than the AI lane, and a free-tier Gemini
// request is better spent on a student's question than on splitting "review
// notes tomorrow at 5pm" in two. Pure and dependency-free, so the server action
// (and anything else) can call it without pulling in Node-only modules.
//
// The phrases understood here mirror how students actually dictate study tasks
// in Polomolok: English, Filipino, and Cebuano, in one flat list.
//
//   "review chapter 4 tomorrow at 7pm"    → title "Review chapter 4", tomorrow 19:00
//   "pass the lab report sa Lunes"       → title "Pass the lab report", next Monday 09:00
//   "ugma 3pm submit physics quiz"       → title "Submit physics quiz", tomorrow 15:00
//   "read the module in 3 days"          → title "Read the module", +3 days 09:00
//   "read the module in 3 days at 8am"   → title "Read the module", +3 days 08:00
//   "review chapter 4 tomorrow at seven pm" → title "Review chapter 4", tomorrow 19:00
//   "quiz sa Lunes alas tres ng hapon"   → title "Quiz", next Monday 15:00
//   "study at 8 in the evening"          → title "Study", today/tomorrow 20:00
//
// Times accept digits or spoken numbers ("seven", "alas tres"), am/pm or the
// longer day-part phrases students actually say ("in the evening", "ng hapon",
// "sa buntag"), plus noon/midnight. A bare hour with no day-part ("at 7") is
// resolved to the nearest upcoming reading instead of silently becoming 9am.

export type TaskSource = "voice" | "text";
export type TaskLanguage = "en" | "fil" | "ceb";

export type ParsedTaskInput = {
  /** The task with its date words stripped out. Never empty. */
  title: string;
  /** Resolved instant, or null when the sentence named no date. */
  dueDate: Date | null;
  /** Which language the date phrase came from, for the capture feedback chip. */
  language: TaskLanguage;
};

export type ParseOptions = {
  /** Clock that relative phrases ("tomorrow") are measured from. */
  now?: Date;
  /**
   * Minutes behind UTC, exactly as `new Date().getTimezoneOffset()` reports it
   * (-480 for Polomolok). Callers pass their own so "tomorrow 9am" means 9am
   * where the student is sitting, not on the server.
   */
  tzOffsetMinutes?: number;
};

/** A date with no time lands here — early enough to act on during the day. */
export const DEFAULT_DUE_HOUR = 9;

/** "tonight" / "mamayang gabi" / "karong gabii" mean the evening. */
const EVENING_HOUR = 19;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

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
  duha: 2,
  tulo: 3,
  upat: 4,
  lima: 5,
  unom: 6,
  pito: 7,
  walo: 8,
  siyam: 9,
  napulo: 10,
};

// English, Filipino, and Cebuano day names share one table. Where a name means
// the same day in both local languages (Lunes, Martes…) one entry covers both.
const DAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  linggo: 0,
  domingo: 0,
  monday: 1,
  mon: 1,
  lunes: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  martes: 2,
  wednesday: 3,
  wed: 3,
  miyerkules: 3,
  miyerkoles: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  huwebes: 4,
  friday: 5,
  fri: 5,
  biyernes: 5,
  saturday: 6,
  sat: 6,
  sabado: 6,
};

const MONTH_ALIASES: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

// Prefixes that add nothing once the task is in a list. Longest first so
// "remind me to" wins over "remind me".
const FILLER_PREFIXES = [
  "don't forget to",
  "dont forget to",
  "remind me to",
  "reminder to",
  "note to self",
  "add a task to",
  "add task to",
  "add a task",
  "add task",
  "i need to",
  "i have to",
  "new task",
  "remember to",
  "remind me",
  "pahinumdom nga",
  "hinumdumi nga",
  "ipaalala na",
  "buhaton ang",
  "tandaan na",
  "paalala na",
  "gawin ang",
  "pahinumdom",
  "hinumdumi",
  "ipaalala",
  "paalala",
  "tandaan",
  "buhaton",
  "gawin",
  "task:",
  "task",
  "to-do:",
  "todo:",
  "i must",
].sort((a, b) => b.length - a.length);

// Words that only one of the two local languages uses, for the capture feedback
// chip. Shared Spanish-derived day names (Lunes, Martes…) are deliberately in
// neither list — they can't name a language on their own.
const CEB_WORDS = [
  "ugma",
  "karon",
  "karong",
  "gabii",
  "sunod",
  "semana",
  "adlaw",
  "domingo",
  "pahinumdom",
  "hinumdumi",
  "buhaton",
  "palihug",
];

const FIL_WORDS = [
  "bukas",
  "ngayon",
  "mamaya",
  "mamayang",
  "gabi",
  "makalawa",
  "susunod",
  "linggo",
  "ipaalala",
  "paalala",
  "tandaan",
  "gawin",
];

const WEEKDAY_NAMES = Object.keys(DAY_ALIASES).join("|");
const MONTH_NAMES = Object.keys(MONTH_ALIASES).join("|");
const NUMBER_ALTERNATIVES = Object.keys(NUMBER_WORDS).join("|");

// ---------------------------------------------------------------------------
// Wall-clock helpers
//
// Relative phrases are resolved against the caller's local clock instead of the
// server's, so a due date lands on the day the student meant. The trick: carry
// a Date whose *UTC* fields are the caller's local fields, and convert back to
// a real instant once at the end.
// ---------------------------------------------------------------------------

function wallClock(now: Date, tzOffsetMinutes: number) {
  return new Date(now.getTime() - tzOffsetMinutes * MS_PER_MINUTE);
}

function toInstant(wallDate: Date, tzOffsetMinutes: number) {
  return new Date(wallDate.getTime() + tzOffsetMinutes * MS_PER_MINUTE);
}

/** Midnight of the caller's local day, as a wall-clock Date. */
function startOfDay(wall: Date) {
  return new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
  );
}

function addDays(day: Date, days: number) {
  return new Date(day.getTime() + days * MS_PER_DAY);
}

/** The same day at `hour`, still in wall-clock terms. */
function withTime(day: Date, hour: number, minute = 0) {
  return new Date(day.getTime() + hour * MS_PER_HOUR + minute * MS_PER_MINUTE);
}

/**
 * How many days ahead `target` (0 = Sunday) is from `wall`; today counts as a
 * full week so a bare "Monday" means the next one, never today.
 */
function daysUntilWeekday(wall: Date, target: number) {
  const delta = (target - wall.getUTCDay() + 7) % 7;
  return delta === 0 ? 7 : delta;
}

// ---------------------------------------------------------------------------
// Date rules
// ---------------------------------------------------------------------------

type ResolvedDay = {
  /** The local day the phrase points at, when it names a calendar day. */
  day?: Date;
  /** Days from today, for the phrases that count forward instead. */
  days?: number;
  /** Preferred hour when the sentence gives none of its own. */
  hour?: number;
};

type DateRule = {
  pattern: RegExp;
  resolve: (match: RegExpExecArray, wall: Date) => ResolvedDay | null;
};

/** A phrase that counts forward from today: "in 3 days", "next week". */
function relative(days: number, hour?: number) {
  return (): ResolvedDay => ({ days, hour });
}

/** Which local language an utterance is in, judged from its own words. */
function languageOf(text: string): TaskLanguage {
  const padded = ` ${text.toLowerCase()} `;
  const has = (word: string) => new RegExp(`\\b${word}\\b`).test(padded);
  if (CEB_WORDS.some(has)) return "ceb";
  if (FIL_WORDS.some(has)) return "fil";
  return "en";
}

const DATE_RULES: DateRule[] = [
  {
    // "the day after tomorrow" / "sa makalawa" / "sunod nga adlaw"
    pattern: /\b(?:day after tomorrow|sa makalawa|sunod nga adlaw)\b/,
    resolve: relative(2),
  },
  {
    // "next week" counts as one week out, not next Monday.
    pattern: /\b(?:next week|sa sunod nga semana|susunod na linggo)\b/,
    resolve: relative(7),
  },
  {
    // Evening, so "tonight" doesn't land at 9am and read as overdue.
    pattern: /\b(?:tonight|mamayang gabi|mamaya ng gabi|karong gabii)\b/,
    resolve: relative(0, EVENING_HOUR),
  },
  {
    pattern: /\b(?:tomorrow|bukas|ugma)\b/,
    resolve: relative(1),
  },
  {
    pattern: /\b(?:today|ngayon|karon)\b/,
    resolve: relative(0),
  },
  {
    // "in 3 days" / "in two weeks" / "sa 3 ka adlaw" / "sa duha ka semana"
    pattern: new RegExp(
      `\\b(?:in\\s+|sa\\s+)(\\d{1,2}|${NUMBER_ALTERNATIVES})\\s+(?:ka\\s+)?(days?|adlaw|weeks?|semana)\\b`
    ),
    resolve: (match) => {
      const amount =
        Number(match[1]) || NUMBER_WORDS[match[1].toLowerCase()] || 0;
      if (amount <= 0) return null;
      const unit = match[2].toLowerCase();
      const weeks = unit.startsWith("week") || unit === "semana";
      return { days: weeks ? amount * 7 : amount };
    },
  },
  {
    // "on Friday" / "next Lunes" / "sa Sabado" — the next occurrence, so a
    // weekday named today means the one a week out.
    pattern: new RegExp(
      `\\b(?:(?:on|next|this|sa)\\s+)?(${WEEKDAY_NAMES})\\b`
    ),
    resolve: (match, wall) => {
      const target = DAY_ALIASES[match[1].toLowerCase()];
      if (target === undefined) return null;
      return { day: addDays(startOfDay(wall), daysUntilWeekday(wall, target)) };
    },
  },
  {
    // ISO: 2026-10-05
    pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
    resolve: (match, wall) =>
      explicitDate(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        wall
      ),
  },
  {
    // "Oct 5", "October 5 2026"
    pattern: new RegExp(
      `\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`
    ),
    resolve: (match, wall) =>
      explicitDate(
        match[3] ? Number(match[3]) : wall.getUTCFullYear(),
        MONTH_ALIASES[match[1].toLowerCase()] ?? 0,
        Number(match[2]),
        wall
      ),
  },
  {
    // "5 October", "5 Oct 2026"
    pattern: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})(?:,?\\s+(\\d{4}))?\\b`
    ),
    resolve: (match, wall) =>
      explicitDate(
        match[3] ? Number(match[3]) : wall.getUTCFullYear(),
        MONTH_ALIASES[match[2].toLowerCase()] ?? 0,
        Number(match[1]),
        wall
      ),
  },
  {
    // 10/5 and 10/5/2026
    pattern: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
    resolve: (match, wall) => {
      const year = match[3]
        ? match[3].length === 2
          ? 2000 + Number(match[3])
          : Number(match[3])
        : wall.getUTCFullYear();
      return explicitDate(year, Number(match[1]) - 1, Number(match[2]), wall);
    },
  },
];

/**
 * A fully spelled-out calendar date. A day that has already passed this year
 * rolls forward — "Dec 5" said in December means next December, not a date in
 * the past.
 */
function explicitDate(
  year: number,
  month: number,
  day: number,
  wall: Date
): ResolvedDay | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month, day));
  // Guards against overflow ("Feb 31" → Mar 3).
  if (candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) {
    return null;
  }
  const today = startOfDay(wall);
  const rolled =
    candidate.getTime() < today.getTime()
      ? new Date(Date.UTC(year + 1, month, day))
      : candidate;
  return { day: rolled };
}

// ---------------------------------------------------------------------------
// Time rules
// ---------------------------------------------------------------------------

type ResolvedTime = {
  /** 24-hour hour when the day-part is known, else the 12-hour value. */
  hour: number;
  minute: number;
  /** True when the hour could be am or pm and the context has to decide. */
  ambiguous: boolean;
  /** The exact text that matched, cut back out of the title. */
  phrase: string;
};

// Spoken hour numbers. English and Filipino/Cebuano plus the Spanish-derived
// forms Filipinos actually say with "alas" (alas tres, alas singko, alas dose).
const HOUR_WORDS: Record<string, number> = {
  ...NUMBER_WORDS,
  eleven: 11,
  twelve: 12,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  singko: 5,
  sais: 6,
  siyete: 7,
  otso: 8,
  nuwebe: 9,
  diyes: 10,
  onse: 11,
  dose: 12,
};

// Phrases that pin a bare hour to the morning or the afternoon/evening. Longest
// first so "in the morning" wins over "morning".
const AM_MARKERS = [
  "in the morning",
  "ng umaga",
  "sa umaga",
  "sa buntag",
  "am",
  "morning",
  "buntag",
];

const PM_MARKERS = [
  "in the afternoon",
  "in the evening",
  "at night",
  "ng hapon",
  "sa hapon",
  "ng gabi",
  "sa gabi",
  "sa gabii",
  "pm",
  "afternoon",
  "evening",
  "night",
  "hapon",
  "gabii",
  "gabi",
];

/** Regex alternation for a word list, longest first so phrases win. */
function alternation(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

const HOUR_TOKEN = `(?:\\d{1,2}|${alternation(Object.keys(HOUR_WORDS))})`;
const MERIDIEM_TOKEN = alternation([...AM_MARKERS, ...PM_MARKERS]);

/** "7 p.m." and "7 P.M" both arrive from speech as "pm". */
function normalizeTimeText(text: string): string {
  return text
    .replace(/\ba\.\s?m\.?\b/gi, "am")
    .replace(/\bp\.\s?m\.?\b/gi, "pm");
}

/** Map a matched day-part phrase to am or pm. */
function meridiemFrom(text: string | undefined): "am" | "pm" | undefined {
  if (!text) return undefined;
  const value = text.toLowerCase().trim();
  if (AM_MARKERS.includes(value)) return "am";
  if (PM_MARKERS.includes(value)) return "pm";
  return undefined;
}

function toHourNumber(token: string): number | null {
  const trimmed = token.trim().toLowerCase();
  if (/^\d{1,2}$/.test(trimmed)) return Number(trimmed);
  return HOUR_WORDS[trimmed] ?? null;
}

// Context handed to each pattern. `allowWordHourAfterPrep` is true once the
// sentence already names a day, which is what makes "tomorrow at seven" a time
// while "look at one example" stays a plain task.
type TimeContext = { allowWordHourAfterPrep: boolean };

// Each pattern declares its own groups and reads them back through `buildTime`,
// so a pattern with two groups ("3pm") can't be read as if it had three.
type TimePattern = {
  pattern: RegExp;
  parse: (match: RegExpExecArray, context: TimeContext) => ResolvedTime | null;
};

const TIME_PATTERNS: TimePattern[] = [
  {
    // "at 5", "at 5:30 pm", "@ 7", "alas tres ng hapon", "a las 8 sa gabi"
    // Groups: 1 preposition, 2 hour, 3 minutes, 4 day-part.
    pattern: new RegExp(
      `(?:^|\\s)(at|@|a las|alas|sa alas)\\s*(${HOUR_TOKEN})(?::(\\d{2}))?\\s*(?:o'?clock)?\\s*(${MERIDIEM_TOKEN})?\\b`
    ),
    parse: (match, context) => {
      const prep = match[1].toLowerCase();
      // "alas" always introduces a time, so a spoken hour is trusted there. After
      // "at", it is trusted only when the sentence already named a day, so "look
      // at one example" can't invent a deadline.
      const isAtPrep = prep === "at" || prep === "@";
      const allowWordHour = isAtPrep ? context.allowWordHourAfterPrep : true;
      return buildTime(match[2], match[3], match[4], match[0], { allowWordHour });
    },
  },
  {
    // "17:30", "5:00 pm" without a preposition
    pattern: new RegExp(`\\b(\\d{1,2}):(\\d{2})\\s*(${MERIDIEM_TOKEN})?\\b`),
    parse: (match) => buildTime(match[1], match[2], match[3], match[0]),
  },
  {
    // "noon", "midday", "tanghali", "midnight", "hatinggabi"
    pattern: /\b(?:noon|midday|tanghali|midnight|hatinggabi)\b/,
    parse: (match) => ({
      hour: match[0] === "midnight" || match[0] === "hatinggabi" ? 0 : 12,
      minute: 0,
      ambiguous: false,
      phrase: match[0],
    }),
  },
  {
    // "7 o'clock", "seven o'clock in the evening"
    pattern: new RegExp(
      `\\b(${HOUR_TOKEN})\\s+o'?clock(?:\\s*(${MERIDIEM_TOKEN}))?\\b`
    ),
    parse: (match) =>
      buildTime(match[1], null, match[2], match[0], { allowWordHour: true }),
  },
  {
    // "3pm", "eight am", "8 sa gabi" — no preposition. A spoken hour is only
    // accepted together with a day-part, so it can't fire on a stray number word,
    // and the verb "am" ("…3, am I right?") is excluded.
    pattern: new RegExp(
      `\\b(${HOUR_TOKEN})\\s*(${MERIDIEM_TOKEN})\\b(?!\\s+i\\b)`
    ),
    parse: (match) => buildTime(match[1], null, match[2], match[0]),
  },
];

function buildTime(
  hourText: string,
  minuteText: string | null,
  meridiemText: string | undefined,
  phrase: string,
  options: { allowWordHour?: boolean } = {}
): ResolvedTime | null {
  const hour = toHourNumber(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (hour === null || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  const meridiem = meridiemFrom(meridiemText);
  const isWordHour = !/^\d+$/.test(hourText.trim());
  if (!meridiem && isWordHour && !options.allowWordHour) return null;

  if (meridiem === "am") {
    if (hour < 1 || hour > 12) return null;
    return { hour: hour === 12 ? 0 : hour, minute, ambiguous: false, phrase };
  }
  if (meridiem === "pm") {
    if (hour < 1 || hour > 12) return null;
    return { hour: hour === 12 ? 12 : hour + 12, minute, ambiguous: false, phrase };
  }

  // No day-part: a 24-hour reading ("at 17") is exact, but "at 7" could be 7am
  // or 7pm — flag it so the caller picks the nearest upcoming reading.
  if (hour === 0 || hour >= 13) {
    return { hour, minute, ambiguous: false, phrase };
  }
  return { hour, minute, ambiguous: true, phrase };
}

function matchTime(text: string, context: TimeContext): ResolvedTime | null {
  for (const { pattern, parse } of TIME_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const time = parse(match, context);
    if (time) return time;
  }
  return null;
}

/**
 * Resolve "at 7" to the nearest hour that hasn't happened yet: said at 9am it
 * is 7pm today, said at 8pm it is 7am tomorrow. Without this every bare hour
 * fell through to the 9am default.
 */
function soonestAmbiguousHour(hour12: number, wall: Date): number {
  const nowMinutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  const candidates = hour12 === 12 ? [0, 12] : [hour12, hour12 + 12];
  let best = candidates[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const hour of candidates) {
    let delta = hour * 60 - nowMinutes;
    if (delta <= 0) delta += 24 * 60;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = hour;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Title cleanup
// ---------------------------------------------------------------------------

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTitle(text: string, removedPhrases: string[]) {
  let title = text;
  // Case-insensitive: the phrases were matched against a lowercased copy, so
  // "sa Lunes" and "Dec 5" must still come out of the original sentence.
  for (const phrase of removedPhrases) {
    if (phrase) {
      title = title.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
    }
  }

  title = title.replace(/\s+/g, " ").trim();

  // "for" and similar connectors left behind when the date words came out.
  title = title.replace(/\b(?:on|at|by|for|sa|ng)\s*$/i, "").trim();

  const lower = title.toLowerCase();
  for (const filler of FILLER_PREFIXES) {
    if (lower.startsWith(filler)) {
      title = title.slice(filler.length).trim();
      break;
    }
  }

  title = title
    .replace(/^[\s\-–—:,;.]+/, "")
    .replace(/[\s\-–—:,;.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // A sentence that was nothing but a date ("remind me tomorrow") keeps its
  // words rather than becoming an empty task.
  if (!title) title = text.replace(/\s+/g, " ").trim();
  if (!title) return "";

  return title.charAt(0).toUpperCase() + title.slice(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Turn one dictated or typed line into a task.
 *
 * Purely syntactic: no AI call, no I/O. A non-empty sentence always yields a
 * non-empty title, and `dueDate` is null when the sentence named no date — an
 * anytime task.
 */
export function parseTaskInput(
  raw: string,
  options: ParseOptions = {}
): ParsedTaskInput {
  const text = normalizeTimeText(raw.replace(/\s+/g, " ").trim());
  const now = options.now ?? new Date();
  const tzOffsetMinutes = options.tzOffsetMinutes ?? now.getTimezoneOffset();
  const wall = wallClock(now, tzOffsetMinutes);
  // Rules run against a lowercased copy, then the matched phrases are cut back
  // out of the original text (case-insensitively) to build the title.
  const lower = text.toLowerCase();

  let dueDay: Date | null = null;
  let dueHour: number | null = null;
  let dueMinute = 0;
  let timeOnly = false;
  const removed: string[] = [];

  for (const rule of DATE_RULES) {
    const match = rule.pattern.exec(lower);
    if (!match) continue;

    const entry = rule.resolve(match, wall);
    if (!entry) continue;

    const day =
      entry.day ??
      (typeof entry.days === "number"
        ? addDays(startOfDay(wall), entry.days)
        : null);
    if (!day) continue;

    dueDay = day;
    dueHour = entry.hour ?? null;
    removed.push(match[0]);
    break;
  }

  // The time is matched against the sentence minus its date words, so
  // "in 3 days at 8am" reads the "8am" rather than tripping over the "3".
  const remainder = removed.reduce(
    (acc, phrase) => acc.split(phrase).join(" "),
    lower
  );
  const time = matchTime(remainder, {
    allowWordHourAfterPrep: dueDay !== null,
  });
  if (time) {
    // A bare clock time with no date means today — or tomorrow, once today's
    // chance has passed.
    timeOnly = dueDay === null;
    dueDay = dueDay ?? startOfDay(wall);
    dueHour = time.ambiguous
      ? soonestAmbiguousHour(time.hour, wall)
      : time.hour;
    dueMinute = time.minute;
    removed.push(time.phrase);
  }

  let dueDate: Date | null = null;
  if (dueDay) {
    const wallDue = withTime(dueDay, dueHour ?? DEFAULT_DUE_HOUR, dueMinute);
    dueDate = toInstant(wallDue, tzOffsetMinutes);

    if (timeOnly && dueDate.getTime() <= now.getTime()) {
      dueDate = toInstant(addDays(wallDue, 1), tzOffsetMinutes);
    }
  }

  return {
    title: cleanTitle(text, removed),
    dueDate,
    language: languageOf(text),
  };
}
