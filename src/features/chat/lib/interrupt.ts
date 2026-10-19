// Words that mean "stop talking" — shared by voice mode and voice navigation.
//
// The tutor is interrupted by *what the student says*, never by the microphone
// simply getting loud. That distinction matters: a cough, a chair, or the
// tutor's own voice leaking back through the speakers used to cut an answer off
// mid-sentence. Saying one of these words is an explicit request, and only an
// explicit request stops the audio.
//
// The vocabulary spans English, Filipino and Cebuano because the student may
// answer in any of them (feature 6.5): "stop", "wait", "sandali lang",
// "hunong sa", "undang", "hulat".
//
// A line only counts as a stop request when *every* word in it belongs to that
// request. That is what keeps a fragment of the tutor's own speech — "or stop to
// be quiet" — from being mistaken for the student saying "stop": "or" is not
// part of a stop request, so the line is ignored. It also means a real
// question that merely contains the word ("what does stop mean?") is not
// mistaken for an interruption.
//
// Client-safe: plain data and pure functions, no DOM or Node APIs.

/** Words that on their own mean "stop" (or are part of such a phrase). */
const STOP_CORE = new Set([
  // English
  "stop", "wait", "hold", "pause", "quiet", "silence", "shut", "cancel",
  "enough", "hush", "moment", "second", "minute", "excuse",
  // Filipino
  "tigil", "itigil", "ihinto", "hinto", "tumahimik", "mahimik", "sandali",
  "teka", "hintay", "hintayin", "sapat", "ayaw", "hindi",
  // Cebuano
  "hilom", "mohilom", "paghilom", "hunong", "hunonga", "undang", "undangi",
  "hulat", "paghuwat", "mohunong", "dili",
]);

/**
 * Words that may surround a stop word without changing the request:
 * "please stop", "wait a second", "sandali lang po", "hunong sa".
 */
const STOP_FILLER = new Set([
  // English
  "please", "pls", "now", "just", "a", "an", "one", "the", "it", "that", "this",
  "to", "be", "for", "already", "again", "on", "up", "talking", "talk",
  "speaking", "speak", "reading", "read", "you", "can", "could", "would",
  "will", "me", "i", "am", "give", "some", "bit", "okay", "ok", "hey",
  // Filipino / Cebuano
  "po", "lang", "lng", "na", "sa", "mo", "ka", "ko", "nga", "muna", "man",
  "pala", "ng", "ang", "yung", "iyong", "daw", "ba",
]);

/**
 * Multi-word idioms that mean stop but whose key word is ambiguous on its own:
 * "tama" is also "correct", "sakto" also "right", "igo" also "just right".
 */
const STOP_PHRASES = [
  "tama na",
  "tama na po",
  "sapat na",
  "sakto na",
  "igo na",
  "hinto na",
  "tama lang",
] as const;

/** Split a spoken utterance into comparable lowercase words. */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word-boundary match, so "stop" does not fire inside "stopwatch". */
function containsPhrase(text: string, phrase: string): boolean {
  const needle = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`, "i").test(text);
}

/**
 * True when `text` is an explicit request to stop the tutor, spoken in English,
 * Filipino or Cebuano.
 *
 * Deliberately strict: a sentence that happens to contain a stop word, or a
 * fragment of the tutor's own reply, is not a request. Only a short utterance
 * made entirely of stop words and the filler around them counts.
 */
export function isStopRequest(text: string): boolean {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (STOP_PHRASES.some((phrase) => containsPhrase(normalized, phrase))) {
    return true;
  }

  const tokens = tokensOf(text);
  if (tokens.length === 0) return false;

  let hasCore = false;
  for (const token of tokens) {
    if (STOP_CORE.has(token)) {
      hasCore = true;
      continue;
    }
    if (!STOP_FILLER.has(token)) return false;
  }
  return hasCore;
}
