"use client";

// Client-only speech playback engine.
//
// This engine plays audio through the Web Audio API:
//
//   • a reply is grouped into as few chunks as possible (see lib/speech.ts) —
//     normally exactly one, so the tutor does not change tone halfway through an
//     answer,
//   • chunks are synthesized one at a time, and the next is fetched while the
//     current one plays,
//   • each chunk is scheduled onto one audio timeline, so there are no gaps
//     between sentences,
//   • a single AnalyserNode sits in the output path so the voice UI can draw a
//     waveform that is driven by the tutor's actual voice.
//
// It is a module-level singleton because voice mode, the message "Listen"
// button and the orb all need the same playback and the same interrupt switch.
//
// Where the audio comes from: /api/chat/speech (src/app/api/chat/speech). The
// route returns WAV bytes, saves them under data/speech/<key>.wav the first time
// a passage is synthesized, and serves them straight from that file afterwards.
// So a passage is synthesized once and is free every time after — including the
// pre-generated mode openers, which never touch the API at all.
//
// Failure: the browser's own voices are deliberately never used. If Gemini TTS
// is unavailable (no key, quota, network) the chunk is simply not spoken — the
// reply stays on screen and the UI is told (snapshot.unavailable) — because
// swapping in a different, worse voice for half an answer is worse than
// silence. Bytes are cached in memory by key too, so replaying an answer in the
// same session is instant.

import { DEFAULT_TTS_VOICE, type VoiceStyle } from "./voices";
import {
  chunksForReply,
  createSpeechGrouper,
  drainSentences,
  speakableText,
  SPEECH_BUDGET,
  type SpeechGrouper,
} from "./speech";

export type SpeechStatus = "idle" | "loading" | "speaking";

export type SpeechSnapshot = {
  /** Id of the message the audio belongs to — drives the Listen/Stop button. */
  speakingId: string | null;
  status: SpeechStatus;
  /**
   * True when Gemini TTS could not speak the current or last reply, so it went
   * unspoken. The browser's own voices are never used as a substitute, so this
   * flag is how the UI explains the silence instead of quietly swapping in a
   * different voice. It clears as soon as a passage synthesizes again.
   */
  unavailable: boolean;
};

const IDLE: SpeechSnapshot = {
  speakingId: null,
  status: "idle",
  unavailable: false,
};

/** How much audio we are willing to synthesize ahead of the playhead. */
const LOOKAHEAD_SECONDS = 9;
/** Let the audio graph settle before the next run's first chunk plays. */
const START_LEAD_SECONDS = 0.08;
/** Short fade on interrupt, so stopping mid-word doesn't click. */
const FADE_SECONDS = 0.05;
const MAX_AUDIO_CACHE_ENTRIES = 10;
/**
 * Give up on a synthesis request that never comes back and drop the chunk.
 *
 * A reply is one request now, and a long one takes a while to render: measured
 * against the live model, ~10 s for a two-sentence answer, ~20 s for a
 * paragraph and ~28 s for the largest reply this app will ask for (a
 * SPEECH_GROUP_CHARS chunk). The limit sits above all of those, so a real
 * answer is never thrown away as though the request had hung.
 */
const TTS_TIMEOUT_MS = 45_000;
/**
 * Requests allowed per spoken reply.
 *
 * A reply is one chunk — one request — unless it is too long for a single
 * synthesis, in which case SPEECH_BUDGET / SPEECH_GROUP_CHARS makes it two. This
 * is headroom rather than a working limit: it bounds a pathological answer
 * without ever cutting short what the budget lets through.
 */
const MAX_REQUESTS_PER_REPLY = 4;
/**
 * Chunks allowed to fail before the rest of a reply is dropped.
 *
 * TTS is either working or it isn't: a second failure means the remaining
 * sentences would each wait out their own timeout before falling silent anyway.
 * The reply stays on screen instead — it is never read out in another voice.
 */
const MAX_CHUNK_FAILURES = 2;
/**
 * How long to stop calling Gemini TTS after it reports its quota is spent.
 * Without this every chunk pays the full retry-across-three-keys delay before
 * falling back, which sounds like broken audio.
 */
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

type Chunk = {
  id: string;
  text: string;
  cacheKey: string;
  /**
   * Server-side file key (a pre-generated phrase). When set, the route serves
   * that file instead of synthesizing from `text`, and saves a first synthesis
   * under the same key, so the line is only ever paid for once.
   */
  fileKey?: string;
};

type Run = {
  token: number;
  id: string;
  lang: string;
  voice: string;
  /** Study-mode speech style, sent with every chunk of this utterance. */
  style: VoiceStyle;
  /** Characters still allowed to be spoken for this message. */
  budget: number;
  spent: number;
  /** TTS requests already spent on this utterance. */
  requests: number;
  /** Cap on requests for this utterance (2 for streaming, 1 for one-shot). */
  maxRequests: number;
  /** Sentences waiting to be synthesized, in order. */
  queue: Chunk[];
  /**
   * Sentences grouped into spoken chunks. Shared with the one-shot replay path
   * (see lib/speech.ts), so a reply is always cut in the same places whichever
   * way it is spoken — and its audio is therefore already on disk the second
   * time it is played.
   */
  grouper: SpeechGrouper;
  /** Text received from the stream that has not been split yet. */
  buffer: string;
  streamEnded: boolean;
  /** ctx.currentTime that the last scheduled chunk finishes at. */
  scheduledUntil: number;
  /** Chunks of this reply that could not be synthesized. */
  failures: number;
  /**
   * Synthesis requests currently awaiting a result.
   * While this is above zero the reply is not finished, however quiet the
   * audio timeline looks: the next chunk is still being fetched.
   */
  inFlight: number;
  settleTimer: number | null;
};

export type SpeechStream = {
  /** Feed streamed reply text; complete sentences are spoken as they land. */
  push(text: string): void;
  /** The reply is complete — flush the tail and let playback finish. */
  end(): void;
  /** Drop the rest of this reply's audio. */
  cancel(): void;
};

// Keyed by voice + text, so replaying a message never re-calls the API.
const audioCache = new Map<string, Uint8Array>();

function cacheAudio(key: string, bytes: Uint8Array) {
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, bytes);
  while (audioCache.size > MAX_AUDIO_CACHE_ENTRIES) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
}

/**
 * Ask the server for a passage's audio: WAV bytes, either read from the file
 * that passage was saved as or synthesized once and saved on the way out.
 */
async function requestSpeech(body: {
  text: string;
  voice: string;
  style: string;
  key?: string;
}): Promise<{ bytes: Uint8Array } | { error: string }> {
  const res = await fetch("/api/chat/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    return { error: payload?.error ?? `Speech request failed (${res.status})` };
  }

  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SpeechEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private listeners = new Set<() => void>();
  private snapshot: SpeechSnapshot = IDLE;
  private run: Run | null = null;
  private token = 0;
  private pumping = false;
  /** Earliest ctx time the next run may start at (after an interrupt fade). */
  private leadUntil = 0;
  /**
   * While set, Gemini TTS is known to be out of quota. Requests are skipped
   * rather than waiting out the key-pool retries for every chunk, so a reply
   * that cannot be spoken fails fast instead of stalling on silence.
   */
  private geminiBlockedUntil = 0;
  /**
   * performance.now() when the last passage finished playing. Speech
   * recognition reads the microphone, and the microphone hears the speakers:
   * this timestamp is how the recognizer knows the words it is hearing are the
   * tutor's, not the student's. Negative infinity until the first clip.
   */
  private lastAudioEndAt = Number.NEGATIVE_INFINITY;

  // -------------------------------------------------------------------------
  // React glue (useSyncExternalStore)
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SpeechSnapshot => this.snapshot;

  private setSnapshot(next: Partial<SpeechSnapshot>) {
    const merged: SpeechSnapshot = { ...this.snapshot, ...next };
    if (
      merged.speakingId === this.snapshot.speakingId &&
      merged.status === this.snapshot.status &&
      merged.unavailable === this.snapshot.unavailable
    ) {
      return;
    }
    this.snapshot = merged;
    for (const listener of this.listeners) listener();
  }

  /** Back to idle, keeping the "TTS is unavailable" flag the UI is showing. */
  private setIdle() {
    const wasActive = this.snapshot.status !== "idle";
    this.setSnapshot({ speakingId: null, status: "idle" });
    if (wasActive) this.lastAudioEndAt = performance.now();
  }

  /** The analyser node that carries the tutor's voice, for visualizers. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** True while audio for the current run is loading or playing. */
  isSpeaking(): boolean {
    return this.run !== null || this.snapshot.status !== "idle";
  }

  /**
   * True while the tutor's voice is playing, and for `graceMs` after it stops.
   *
   * Dictation uses this to ignore words that reached the microphone from the
   * laptop's own speakers. The short tail matters: the browser often finalizes
   * an utterance on the silence just after a clip ends, and that final result
   * would otherwise type the last sentence of the tutor's answer into the
   * student's input.
   */
  isSpeakingOrRecently(graceMs = 700): boolean {
    if (this.isSpeaking()) return true;
    return performance.now() - this.lastAudioEndAt < graceMs;
  }

  // -------------------------------------------------------------------------
  // Audio graph
  // -------------------------------------------------------------------------

  /**
   * Create/resume the AudioContext. Must be called from a user gesture the
   * first time — browsers refuse to start audio otherwise.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** Reuse the engine context for microphone analysis too (one graph, one
   * sample clock). Returns null where Web Audio is unavailable. */
  ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;

    const ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!ctor) return null;

    const ctx = new ctor();
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    this.ctx = ctx;
    this.gain = gain;
    this.analyser = analyser;
    return ctx;
  }

  // -------------------------------------------------------------------------
  // Public playback
  // -------------------------------------------------------------------------

  /** Speak a whole message (the "Listen" button and the task reader). */
  speak(
    id: string,
    text: string,
    lang: string,
    voice: string = DEFAULT_TTS_VOICE,
    options?: { maxChars?: number; style?: VoiceStyle }
  ) {
    // Cut the message the same way voice mode cuts a reply it is streaming, so
    // replaying an answer plays the audio that was already generated for it
    // rather than paying for a second copy cut differently.
    const budget = options?.maxChars ?? SPEECH_BUDGET;
    const chunks = chunksForReply(text);
    if (chunks.length === 0) return;

    const run = this.begin(id, lang, voice, budget, options?.style);
    for (const chunk of chunks) this.enqueue(run, chunk);
    this.endRun(run);
  }

  /**
   * Speak a fixed line that may already exist as a file on disk — the voice-mode
   * openers in lib/phrases.ts.
   *
   * One chunk with a known key: when the phrase bank has been generated
   * (`npm run phrases:generate`) this costs no TTS request at all, and if it has
   * not, the first use synthesizes the line and saves it under the same key, so
   * the line is only ever paid for once.
   */
  speakLine(
    id: string,
    options: {
      key: string;
      text: string;
      lang: string;
      voice: string;
      style?: VoiceStyle;
    }
  ) {
    const run = this.begin(
      id,
      options.lang,
      options.voice,
      options.text.length + 8,
      options.style,
      1
    );
    this.enqueue(run, options.text, options.key);
    this.endRun(run);
  }

  /**
   * Speak a reply that is still being generated: push text as it streams in,
   * call end() when the model stops. Returns a handle the caller can cancel.
   */
  beginStream(
    id: string,
    options: {
      lang: string;
      voice: string;
      maxChars?: number;
      style?: VoiceStyle;
    }
  ): SpeechStream {
    const run = this.begin(
      id,
      options.lang,
      options.voice,
      options.maxChars,
      options.style
    );

    return {
      push: (text: string) => {
        if (this.run !== run || run.token !== this.token || !text) return;
        run.buffer += text;
        const { ready, rest } = drainSentences(run.buffer);
        run.buffer = rest;
        for (const sentence of ready) this.addSentence(run, sentence);
      },
      end: () => {
        if (this.run !== run || run.token !== this.token) return;
        const { ready } = drainSentences(run.buffer, { flush: true });
        run.buffer = "";
        for (const sentence of ready) this.addSentence(run, sentence);
        for (const chunk of run.grouper.flush()) this.enqueue(run, chunk);
        this.endRun(run);
      },
      cancel: () => {
        if (this.run === run) this.stop();
      },
    };
  }

  /** Stop everything: playback, queued chunks and in-flight synthesis. */
  stop() {
    this.token += 1;
    const run = this.run;
    if (run?.settleTimer) window.clearTimeout(run.settleTimer);
    this.run = null;

    const sources = this.sources;
    this.sources = [];
    const ctx = this.ctx;
    const gain = this.gain;

    if (ctx && gain && sources.length > 0) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      // Hold the next run back until the fade is over, then restore the level.
      this.leadUntil = now + FADE_SECONDS + 0.02;
      window.setTimeout(() => {
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Already ended.
          }
        }
        if (this.gain && this.ctx) {
          const t = this.ctx.currentTime;
          this.gain.gain.cancelScheduledValues(t);
          this.gain.gain.setValueAtTime(1, t);
        }
      }, FADE_SECONDS * 1000 + 20);
    }

    this.setIdle();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private begin(
    id: string,
    lang: string,
    voice: string,
    maxChars?: number,
    style?: VoiceStyle,
    maxRequests: number = MAX_REQUESTS_PER_REPLY
  ): Run {
    this.stop();
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();

    const run: Run = {
      token: this.token,
      id,
      lang,
      voice,
      style: style ?? "tutor",
      budget: maxChars ?? SPEECH_BUDGET,
      spent: 0,
      requests: 0,
      maxRequests,
      queue: [],
      grouper: createSpeechGrouper(),
      buffer: "",
      streamEnded: false,
      scheduledUntil: this.leadUntil,
      failures: 0,
      inFlight: 0,
      settleTimer: null,
    };
    this.run = run;
    this.setSnapshot({ speakingId: id, status: "loading" });
    return run;
  }

  /**
   * Hand one finished sentence to the run's grouper and speak whatever chunks
   * that completes.
   *
   * The sentence is cleaned before it is grouped, so the cuts are made on the
   * words that will actually be said — which is what lets a later replay of the
   * same reply reproduce them exactly (see chunksForReply).
   */
  private addSentence(run: Run, sentence: string) {
    const spoken = speakableText(sentence);
    if (!spoken) return;
    for (const chunk of run.grouper.add(spoken)) this.enqueue(run, chunk);
  }

  private enqueue(run: Run, raw: string, fileKey?: string) {
    const left = run.budget - run.spent;
    if (left <= 0) return;
    if (run.requests >= run.maxRequests) return;
    // This utterance has already failed too many times to be spoken: don't keep
    // spending requests on sentences nobody will hear (streaming replies keep
    // arriving after the run has given up).
    if (run.failures >= MAX_CHUNK_FAILURES) return;

    const text = speakableText(raw);
    if (!text) return;

    const spoken = text.length > left ? text.slice(0, left) : text;
    if (!spoken.trim()) return;
    run.spent += spoken.length;

    run.requests += 1;
    run.queue.push({
      id: run.id,
      text: spoken,
      fileKey,
      // Voice + words, matching the server's key: the style shapes the first
      // recording only, so switching study mode replays the same audio instead
      // of re-synthesizing it. A file-backed chunk is keyed by its file instead,
      // which is what makes a pre-generated line a free replay.
      cacheKey: fileKey ?? `${run.voice}|${spoken}`,
    });
    this.wake(run);
  }

  private endRun(run: Run) {
    run.streamEnded = true;
    this.wake(run);
    this.settle();
  }

  private wake(run: Run) {
    void this.pump(run.token);
  }

  /**
   * Serial worker: takes chunks in order, synthesizes while earlier audio is
   * still playing, and schedules each decoded buffer on the shared timeline.
   */
  private async pump(token: number) {
    if (this.pumping) return;
    this.pumping = true;

    try {
      for (;;) {
        const run = this.run;
        if (token !== this.token || !run || run.token !== token) return;

        if (run.queue.length === 0) {
          if (run.streamEnded) return;
          await sleep(80);
          continue;
        }

        const ctx = this.ctx;
        if (!ctx) {
          // No Web Audio here, so nothing could be played even if the server
          // synthesized it: drop the queue rather than spend requests on it.
          run.queue.length = 0;
          this.setSnapshot({ unavailable: true });
          if (run.streamEnded) return;
          await sleep(80);
          continue;
        }

        const ahead = run.scheduledUntil - ctx.currentTime;
        if (ahead > LOOKAHEAD_SECONDS) {
          // Enough audio queued; let the playhead catch up before spending
          // another TTS request.
          await sleep(150);
          continue;
        }

        const chunk = run.queue.shift();
        if (!chunk) continue;

        // Count the work before awaiting it. `settle()` refuses to close the run
        // while this is above zero, so the quiet gap between two sentences can't
        // be mistaken for the end of the reply — which is how a long answer used
        // to stop after its first sentence and lose the rest.
        run.inFlight += 1;
        try {
          const buffer = await this.audioFor(run, chunk, token);
          if (token !== this.token || this.run !== run) return;

          if (buffer) {
            run.failures = 0;
            this.schedule(run, chunk, buffer);
          } else {
            // Gemini TTS could not speak this sentence. The browser's own voices
            // are never a substitute, so it goes unspoken and the UI is told;
            // a second failure drops the rest of the reply rather than spending
            // a timeout on every remaining chunk.
            run.failures += 1;
            this.setSnapshot({ unavailable: true });
            if (run.failures >= MAX_CHUNK_FAILURES) run.queue.length = 0;
          }
        } finally {
          run.inFlight -= 1;
          // The sound may have run out while we were fetching, so re-check now
          // that nothing is outstanding.
          if (token === this.token) this.settle();
        }
      }
    } finally {
      this.pumping = false;
      // A chunk may have been queued while we were unwinding.
      const run = this.run;
      if (run && run.queue.length > 0 && run.token === this.token) this.wake(run);
    }
  }

  private async audioFor(
    run: Run,
    chunk: Chunk,
    token: number
  ): Promise<AudioBuffer | null> {
    const cached = audioCache.get(chunk.cacheKey);
    if (cached) return this.decode(cached);
    if (Date.now() < this.geminiBlockedUntil) return null;

    try {
      // A hung request must not stall the whole reply, so race it with a timer.
      const res = await Promise.race([
        requestSpeech({
          text: chunk.text,
          voice: run.voice,
          style: run.style,
          // A pre-generated line (a mode opener) is asked for by key, so the
          // route can serve the file it already has.
          ...(chunk.fileKey ? { key: chunk.fileKey } : {}),
        }),
        sleep(TTS_TIMEOUT_MS).then(() => null),
      ]);
      if (token !== this.token) return null;

      if (!res) {
        console.warn("[voice] TTS timed out");
        return null;
      }

      if ("error" in res) {
        // A spent quota is not worth retrying per sentence — every later chunk
        // would pay the same multi-key delay. Park the model and fail fast.
        if (/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(res.error)) {
          this.geminiBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
        }
        console.warn("[voice] TTS failed:", res.error);
        return null;
      }
      cacheAudio(chunk.cacheKey, res.bytes);
      return this.decode(res.bytes);
    } catch (err) {
      if (token !== this.token) return null;
      console.warn("[voice] TTS request failed:", err);
      return null;
    }
  }

  private async decode(bytes: Uint8Array): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    try {
      // decodeAudioData detaches the input, so hand it a copy of the cached
      // bytes and keep the cache reusable.
      return await ctx.decodeAudioData(bytes.slice().buffer);
    } catch (err) {
      console.warn("[voice] could not decode speech audio:", err);
      return null;
    }
  }

  private schedule(run: Run, chunk: Chunk, buffer: AudioBuffer) {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const startAt = Math.max(
      ctx.currentTime + START_LEAD_SECONDS,
      run.scheduledUntil
    );
    source.start(startAt);
    run.scheduledUntil = startAt + buffer.duration;
    this.sources.push(source);

    source.onended = () => {
      const index = this.sources.indexOf(source);
      if (index >= 0) this.sources.splice(index, 1);
      this.settle();
    };

    this.setSnapshot({
      speakingId: chunk.id,
      status: "speaking",
      // Audio is playing, so any earlier failure has been made good.
      unavailable: false,
    });
    this.scheduleSettle(run.scheduledUntil - ctx.currentTime);
  }

  /** Move to idle once every queued chunk has finished playing. */
  private settle() {
    const run = this.run;
    const ctx = this.ctx;

    if (!run) {
      if (this.snapshot.status !== "idle") this.setIdle();
      return;
    }
    if (run.queue.length > 0 || run.buffer) {
      this.scheduleSettle(0.25);
      return;
    }
    // Something is still being fetched: silence right now is the gap between two
    // sentences, not the end of the reply. Closing the run here is what used to
    // drop the rest of a long answer when its next chunk arrived.
    if (run.inFlight > 0) {
      this.scheduleSettle(0.25);
      return;
    }
    if (!run.streamEnded) {
      this.scheduleSettle(0.25);
      return;
    }

    const remaining = run.scheduledUntil - (ctx?.currentTime ?? 0);
    if (remaining > 0.05) {
      this.scheduleSettle(remaining);
      return;
    }

    if (run.settleTimer) window.clearTimeout(run.settleTimer);
    this.run = null;
    this.setIdle();
  }

  private scheduleSettle(afterSeconds: number) {
    const run = this.run;
    const ctx = this.ctx;
    if (!run || !ctx) return;
    if (run.settleTimer) window.clearTimeout(run.settleTimer);
    run.settleTimer = window.setTimeout(
      () => this.settle(),
      Math.max(60, afterSeconds * 1000 + 60)
    );
  }
}

let engine: SpeechEngine | null = null;

/** The shared playback engine (created on first use, client only). */
export function getSpeechEngine(): SpeechEngine {
  if (!engine) engine = new SpeechEngine();
  return engine;
}
