// Text helpers for the spoken side of chat (features 6.1 / 6.8).
//
// The tutor writes in Markdown, but a voice should never read "asterisk
// asterisk". These helpers turn a reply into clean prose, cut it into short
// chunks that the TTS model can synthesize one at a time, and expose a
// sentence splitter that the streaming pipeline uses to start speaking before
// the whole answer has finished generating.

/** Shortest chunk worth a TTS round trip (below this we merge sentences). */
export const SPEECH_MIN_CHUNK = 60;

/** Longest chunk we send in one TTS request (keeps time-to-first-audio low). */
export const SPEECH_MAX_CHUNK = 260;

/**
 * Strip Markdown so the spoken audio matches what the student reads. Code
 * blocks are dropped entirely — reading source code aloud is noise — while the
 * human-readable parts of links, tables and lists are kept.
 */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+[.)]\s+/gm, "")
    .replace(/^\s*[-:| ]{3,}\s*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/**
 * Pull finished sentences off the front of a buffer.
 *
 * Used by the streaming pipeline: text arrives a few tokens at a time, and a
 * sentence is only "finished" once a terminator is followed by whitespace — a
 * trailing "." might still be part of a longer number or abbreviation. Very
 * long run-on text is cut at a word boundary so speech still starts promptly.
 */
export function drainSentences(
  buffer: string,
  options?: { flush?: boolean }
): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buffer;

  for (;;) {
    const match = /^([\s\S]*?[.!?…]+)(\s+|$)/.exec(rest);
    if (!match) break;
    const tail = match[2];
    // A terminator at the very end of the buffer might get more text, so hold
    // it back until the stream ends.
    if (tail === "" && !options?.flush) break;
    const sentence = match[1].trim();
    if (sentence) ready.push(sentence);
    rest = rest.slice(match[0].length);
    if (!rest.trim()) {
      rest = "";
      break;
    }
  }

  if (rest.length > SPEECH_MAX_CHUNK) {
    const cut = rest.lastIndexOf(" ", SPEECH_MAX_CHUNK);
    const at = cut > SPEECH_MIN_CHUNK ? cut : SPEECH_MAX_CHUNK;
    const head = rest.slice(0, at).trim();
    if (head) ready.push(head);
    rest = rest.slice(at).trimStart();
  }

  if (options?.flush && rest.trim()) {
    ready.push(rest.trim());
    rest = "";
  }

  return { ready, rest };
}

/**
 * Split a complete reply into TTS-sized chunks. The first chunk is short by
 * design: audio can start playing while the rest is still being synthesized.
 */
export function chunkForSpeech(
  text: string,
  options?: { maxChars?: number }
): string[] {
  const maxChars = options?.maxChars ?? SPEECH_MAX_CHUNK;
  const clean = speakableText(text);
  if (!clean) return [];

  const { ready } = drainSentences(clean, { flush: true });
  const chunks: string[] = [];
  let current = "";

  for (const sentence of ready) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + 1 + sentence.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
