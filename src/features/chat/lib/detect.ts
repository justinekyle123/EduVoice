// Lightweight heuristics for language and tone detection (features 6.5, 6.11).
// These are deliberately simple and client-safe; they can be upgraded to
// Gemini-based detection later without changing callers.

export type DetectedLanguage = "en" | "fil" | "ceb";
export type DetectedTone = "frustrated" | "confused" | "positive" | "neutral";

const FIL_MARKERS = [
  "ang ",
  " mga ",
  "ko ",
  " mo ",
  " po ",
  "kasi",
  "dahil",
  "paano",
  "ano ",
  "bakit",
  "hindi",
  "gusto",
  "tulong",
  "di ko",
  "gets",
  "talaga",
  "kailangan",
  "mali",
  "tama",
  "alam",
  "pwede",
];

const CEB_MARKERS = [
  "unsa",
  "ngano",
  "dili",
  "buot",
  "tabang",
  "palihug",
  "kaayo",
  "kanus-a",
  "asa ",
  "ikaw",
  "kami",
  "nimo",
  "niya",
  "nga ",
  " og ",
  "mahimo",
  "sulti",
  "kini",
  "naa",
  "wala",
];

export function detectLanguage(text: string): DetectedLanguage {
  const t = ` ${text.toLowerCase()} `;
  const filScore = FIL_MARKERS.filter((m) => t.includes(m)).length;
  const cebScore = CEB_MARKERS.filter((m) => t.includes(m)).length;

  if (filScore > cebScore && filScore > 0) return "fil";
  if (cebScore > filScore && cebScore > 0) return "ceb";
  if (filScore > 0 || cebScore > 0) return "fil";
  return "en";
}

const CONFUSED_MARKERS = [
  "?",
  "huh",
  "paano",
  "how do",
  "what is",
  "di ko gets",
  "dili ko kasabot",
  "confus",
  "nalilito",
  "explain",
  "sabihin",
  "pasabta",
];

const FRUSTRATED_MARKERS = [
  "?!",
  "ang hirap",
  "lisod",
  "lisud",
  "stress",
  "frustrat",
  "bwisit",
  "galit",
  "irita",
  "!!",
  "wala jud ko kasabot",
];

const POSITIVE_MARKERS = [
  "salamat",
  "thank",
  "nice",
  "galing",
  "great",
  "awesome",
  "maayo",
  "gwapo",
  "👍",
  "😊",
  "🎉",
];

export function detectTone(text: string): DetectedTone {
  const t = ` ${text.toLowerCase()} `;
  if (FRUSTRATED_MARKERS.some((m) => t.includes(m))) return "frustrated";
  if (CONFUSED_MARKERS.some((m) => t.includes(m))) return "confused";
  if (POSITIVE_MARKERS.some((m) => t.includes(m))) return "positive";
  return "neutral";
}

/** Map a detected language to a BCP-47 tag used by speech recognition/TTS. */
export function speechLangFor(lang: DetectedLanguage): string {
  if (lang === "fil") return "fil-PH";
  if (lang === "ceb") return "ceb-PH";
  return "en-PH";
}