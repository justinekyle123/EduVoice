// Text helpers for the spoken side of chat (features 6.1 / 6.8).
//
// The tutor writes in Markdown, but a voice should never read "asterisk
// asterisk". These helpers turn a reply into clean prose, group it into the
// chunks the TTS model is asked for in one request, and expose a sentence
// splitter that the streaming pipeline feeds as text arrives.
//
// A reply is spoken as ONE take. Gemini renders each request separately — the
// take before the cut and the take after it differ slightly in pitch, pace and
// energy — so an answer split in two sounds like the tutor changing tone halfway
// through. Measured, the per-request overhead (~9 s) dominates the cost of a
// request too, so grouping a whole reply costs next to nothing in
// time-to-first-audio while making the voice continuous.
//
// The grouping rule lives here once, in `createSpeechGrouper`, because it is
// what decides where a reply is cut — and a cut is what a chunk's audio is
// cached under. A live reply (sentences arriving one at a time) and a later
// replay of the same reply (the whole text at once) must land on the same cuts,
// or replaying an answer would synthesize and store a second copy of it.

/** Shortest piece a long sentence is cut into (below this the cut moves later). */
export const SPEECH_MIN_CHUNK = 60;

/**
 * Longest run of words a sentence is handed over in.
 *
 * A run-on sentence is cut at a word boundary into pieces this size, and the
 * grouper joins them straight back up — the point is that no single piece can
 * overshoot the size of one request, while the words still reach the model as
 * one unbroken sentence.
 */
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
 * Cut a sentence longer than SPEECH_MAX_CHUNK at word boundaries.
 *
 * It only ever looks at the sentence it is given, which is what makes a long
 * run-on split the same way whether it is still arriving or being replayed in
 * one piece. (Cutting the *buffer* instead — while it was still streaming — used
 * to make the cut depend on how the text happened to arrive, so the same reply
 * replayed later was cut differently and had to be synthesized again.)
 *
 * The pieces are re-joined by the grouper, so a long sentence is still spoken as
 * one sentence; this only keeps any single piece inside one request.
 */
function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= SPEECH_MAX_CHUNK) return [sentence];

  const pieces: string[] = [];
  let rest = sentence;

  while (rest.length > SPEECH_MAX_CHUNK) {
    const cut = rest.lastIndexOf(" ", SPEECH_MAX_CHUNK);
    const at = cut > SPEECH_MIN_CHUNK ? cut : SPEECH_MAX_CHUNK;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trimStart();
  }
  if (rest.trim()) pieces.push(rest.trim());

  return pieces;
}

/**
 * Pull finished sentences off the front of a buffer.
 *
 * Used by the streaming pipeline: text arrives a few tokens at a time, and a
 * sentence is only "finished" once a terminator is followed by whitespace — a
 * trailing "." might still be part of a longer number or abbreviation.
 *
 * Everything emitted is bounded by SPEECH_MAX_CHUNK, and the bound is applied to
 * the sentence rather than to whatever happened to be buffered, so the sentences
 * (and therefore the chunks) do not depend on when the text arrived.
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
    if (sentence) ready.push(...splitLongSentence(sentence));
    rest = rest.slice(match[0].length);
    if (!rest.trim()) {
      rest = "";
      break;
    }
  }

  if (options?.flush && rest.trim()) {
    ready.push(...splitLongSentence(rest.trim()));
    rest = "";
  }

  return { ready, rest };
}

/**
 * How much text goes into one synthesis request.
 *
 * A whole voice reply — the mode instruction asks the tutor for three or four
 * sentences — fits under this, so an answer is one recording instead of two
 * takes with a tone change between them. It is also the server's single-request
 * ceiling (`MAX_TTS_CHARS` in server/ttsCore.ts): a chunk built here is never
 * truncated on the way in, so it is always cached and always replayable.
 */
export const SPEECH_GROUP_CHARS = 1200;

/**
 * Longest reply we speak for one message; the rest stays on screen.
 *
 * One number for both paths — voice mode streaming a live reply and a one-shot
 * "Listen" playback of a finished one — so the two cut a reply in exactly the
 * same places and share the same cached audio. It is wider than
 * SPEECH_GROUP_CHARS on purpose: a reply too long for one request is still
 * spoken in full, in a second take, rather than being cut off mid-answer.
 */
export const SPEECH_BUDGET = 1920;

/**
 * Groups sentences into the chunks that get spoken.
 *
 * Used twice, in the same order, for the same reply: by the streaming pipeline
 * as sentences arrive, and over a finished reply that is being replayed. A whole
 * reply is held back until it has been read, so it becomes one chunk — one
 * request, one recording — and only a reply too long for one request is cut,
 * always on a sentence boundary.
 *
 * `add` returns the chunks that became complete, `flush` returns whatever is
 * still held back once the reply has ended.
 */
export type SpeechGrouper = {
  add(sentence: string): string[];
  flush(): string[];
};

export function createSpeechGrouper(): SpeechGrouper {
  let pending = "";

  return {
    add(sentence: string): string[] {
      const merged = pending ? `${pending} ${sentence}` : sentence;

      // Emit *before* adding a sentence that would push the group past one
      // request. That keeps every chunk inside the server's limit and ends it on
      // a sentence boundary, so no take stops mid-clause.
      if (pending && merged.length > SPEECH_GROUP_CHARS) {
        const complete = pending;
        pending = sentence;
        return [complete];
      }

      pending = merged;
      // One sentence longer than a whole request (a run-on that the splitter
      // could not shorten): speak it on its own rather than hold it forever.
      if (pending.length >= SPEECH_GROUP_CHARS) {
        const held = pending;
        pending = "";
        return [held];
      }
      return [];
    },

    flush(): string[] {
      const held = pending;
      pending = "";
      return held ? [held] : [];
    },
  };
}

/**
 * The chunks a finished reply is spoken in — one for a reply that fits, the same
 * cuts the streaming pipeline would make, so a replay is a cache hit rather than
 * a second copy.
 */
export function chunksForReply(text: string): string[] {
  // Sentences are cut from the raw reply and cleaned one at a time, exactly as
  // the streaming pipeline does it, so both paths group identical text.
  const { ready } = drainSentences(text, { flush: true });
  const grouper = createSpeechGrouper();
  const chunks: string[] = [];

  for (const sentence of ready) {
    // Skip what cleans away to nothing, exactly as the engine's streaming path
    // does — an empty sentence must not reach the grouper and shift a cut.
    const spoken = speakableText(sentence);
    if (!spoken) continue;
    chunks.push(...grouper.add(spoken));
  }
  chunks.push(...grouper.flush());

  return chunks;
}
