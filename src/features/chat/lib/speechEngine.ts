"use client";

// Client-only speech playback engine.
//
// The previous implementation waited for the whole reply and then asked Gemini
// for one long WAV, so a voice turn stalled for seconds before any sound came
// out. This engine plays audio through the Web Audio API in chunks:
//
//   • text is cut into sentence-sized chunks (see lib/speech.ts),
//   • chunks are synthesized one at a time, *while the previous chunk plays*,
//   • each chunk is scheduled onto one audio timeline, so there are no gaps
//     between sentences,
//   • a single AnalyserNode sits in the output path so the voice UI can draw a
//     waveform that is driven by the tutor's actual voice.
//
// It is a module-level singleton because voice mode, the message "Listen"
// button and the orb all need the same playback and the same interrupt switch.
//
// Fallbacks: if Gemini TTS is unavailable (no key, quota, network), the chunk is
// spoken with the browser's built-in voices instead. Audio is cached by text, so
// replaying an answer is instant and does not spend TTS quota twice.

import { synthesizeSpeech } from "../server/tts";
import { DEFAULT_TTS_VOICE, type VoiceStyle } from "./voices";
import { chunkForSpeech, drainSentences, speakableText } from "./speech";

export type SpeechStatus = "idle" | "loading" | "speaking";

export type SpeechSnapshot = {
  /** Id of the message the audio belongs to — drives the Listen/Stop button. */
  speakingId: string | null;
  status: SpeechStatus;
  /**
   * Where the current/previous audio came from. "browser" means Gemini TTS was
   * unavailable (no key, quota spent, network) and the built-in voice was used
   * — the UI says so instead of quietly swapping in a worse voice.
   */
  voice: "gemini" | "browser";
};

const IDLE: SpeechSnapshot = {
  speakingId: null,
  status: "idle",
  voice: "gemini",
};

/** How much audio we are willing to synthesize ahead of the playhead. */
const LOOKAHEAD_SECONDS = 9;
/** Let the audio graph settle before the next run's first chunk plays. */
const START_LEAD_SECONDS = 0.08;
/** Short fade on interrupt, so stopping mid-word doesn't click. */
const FADE_SECONDS = 0.05;
/** Longest reply we speak for one message; the rest stays on screen. */
const DEFAULT_SPEAK_BUDGET = 1200;
const MAX_AUDIO_CACHE_ENTRIES = 10;
/** Give up on a synthesis request that never comes back and use browser voices. */
const TTS_TIMEOUT_MS = 20_000;
/**
 * Requests allowed per spoken reply.
 *
 * Gemini TTS on the free tier is metered per model (10 requests for
 * gemini-3.1-flash-tts when this was written), so a reply must not cost one
 * request per sentence. Voice mode spends at most two: the opening sentence, so
 * audio starts fast, then everything else in a single request. A one-shot
 * "Listen" playback spends exactly one.
 */
const MAX_REQUESTS_PER_REPLY = 2;
/**
 * Opening chunk length target. Shorter than a full sentence-group on purpose:
 * the first request is what decides how long the student waits to hear
 * anything, and a short sentence synthesizes noticeably faster.
 */
const OPENING_MIN_CHARS = 25;
/** Remainder length that forces a second request instead of waiting for the end. */
const CONTINUATION_CHARS = 700;
/**
 * How long to stop calling Gemini TTS after it reports its quota is spent.
 * Without this every chunk pays the full retry-across-three-keys delay before
 * falling back, which sounds like broken audio.
 */
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

type Chunk = { id: string; text: string; cacheKey: string };

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
  /** Sentences held back to merge into a longer chunk before synthesis. */
  pending: string;
  /** Text received from the stream that has not been split yet. */
  buffer: string;
  streamEnded: boolean;
  /** ctx.currentTime that the last scheduled chunk finishes at. */
  scheduledUntil: number;
  /** True once TTS failed — the rest of this reply uses browser voices. */
  browserOnly: boolean;
  failures: number;
  /** Set while a browser utterance is playing (its length is unknown). */
  browserActive: boolean;
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

/** Pull the WAV bytes out of the `data:audio/wav;base64,…` the server returns. */
function dataUriToBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const base64 = comma >= 0 ? uri.slice(comma + 1) : uri;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Installed voices vary wildly in quality: the browser's *default* voice is
// often the worst one on the machine, while cloud/natural voices are close to
// the Gemini output. Rank the candidates instead of taking the first match.
const QUALITY_HINTS = [
  /natural/i,
  /neural/i,
  /enhanced/i,
  /premium/i,
  /google/i,
  /siri/i,
  /aria|jenny|guy|emma|michelle/i,
];

/** Score 0–3: higher is nicer to listen to. */
function browserVoiceScore(
  voice: SpeechSynthesisVoice,
  wanted: string,
  base: string
): number {
  let score = 0;
  if (voice.lang.toLowerCase() === wanted) score += 2;
  else if (voice.lang.toLowerCase().startsWith(base)) score += 1;
  else if (!voice.lang.toLowerCase().startsWith("en")) return -1;

  // Cloud voices (Chrome, Edge, Windows “Natural”) sound markedly better.
  if (!voice.localService) score += 2;
  if (QUALITY_HINTS.some((pattern) => pattern.test(voice.name))) score += 2;
  return score;
}

/** The nicest browser voice that can speak `lang`, best effort. */
function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const lower = lang.toLowerCase();
  const base = lower.split("-")[0];

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = browserVoiceScore(voice, lower, base);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** Resolve once the browser has published its voice list (or we give up). */
function whenVoicesReady(timeoutMs = 350): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve();
  }
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    window.speechSynthesis.addEventListener("voiceschanged", done);
  });
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
   * While set, Gemini TTS is known to be out of quota, so requests go straight
   * to the browser voice instead of waiting out the key-pool retries.
   */
  private geminiBlockedUntil = 0;

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
      merged.voice === this.snapshot.voice
    ) {
      return;
    }
    this.snapshot = merged;
    for (const listener of this.listeners) listener();
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
   * True once a chunk is actually on the audio timeline. Voice mode waits for
   * real sound before letting the student interrupt, so a cough during
   * synthesis does not cancel the answer.
   */
  isPlaying(): boolean {
    return this.snapshot.status === "speaking";
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
    // One request for the whole message: `chunkForSpeech` merges sentences up
    // to the budget, and the run stops after a single request anyway.
    const budget = options?.maxChars ?? DEFAULT_SPEAK_BUDGET;
    const chunks = chunkForSpeech(text, { maxChars: budget });
    if (chunks.length === 0) return;

    const run = this.begin(id, lang, voice, budget, options?.style, 1);
    for (const chunk of chunks) this.enqueue(run, chunk);
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
        if (run.pending) {
          this.enqueue(run, run.pending);
          run.pending = "";
        }
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

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

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

    this.setSnapshot(IDLE);
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
      budget: maxChars ?? DEFAULT_SPEAK_BUDGET,
      spent: 0,
      requests: 0,
      maxRequests,
      queue: [],
      pending: "",
      buffer: "",
      streamEnded: false,
      scheduledUntil: this.leadUntil,
      // No audio graph, or Gemini TTS is known to be out of quota: go straight
      // to the browser voice instead of making the student wait for a failure.
      browserOnly: ctx === null || Date.now() < this.geminiBlockedUntil,
      failures: 0,
      browserActive: false,
      settleTimer: null,
    };
    this.run = run;
    this.setSnapshot({ speakingId: id, status: "loading" });
    return run;
  }

  /**
   * Decide what to speak next, keeping the reply's request count low.
   *
   * The first complete sentence is sent on its own so sound starts quickly;
   * everything after it is held back and sent as one longer request. That is
   * two TTS requests for a whole reply instead of one per sentence.
   */
  private addSentence(run: Run, sentence: string) {
    const merged = run.pending ? `${run.pending} ${sentence}` : sentence;
    this.wake(run);

    const hasSoundQueued = run.requests > 0 || run.queue.length > 0;
    if (!hasSoundQueued) {
      // Opening sentence: speak as soon as there is enough of it to sound like
      // speech, so the tutor's voice arrives quickly.
      if (merged.length < OPENING_MIN_CHARS) {
        run.pending = merged;
        return;
      }
      run.pending = "";
      this.enqueue(run, merged);
      return;
    }

    // Later sentences: wait for the end of the reply (or a long remainder) and
    // send them together, so a whole answer costs a second request at most.
    run.pending = merged;
    if (run.pending.length >= CONTINUATION_CHARS) {
      const held = run.pending;
      run.pending = "";
      this.enqueue(run, held);
    }
  }

  private enqueue(run: Run, raw: string) {
    const left = run.budget - run.spent;
    if (left <= 0) return;
    if (run.requests >= run.maxRequests) return;

    const text = speakableText(raw);
    if (!text) return;

    const spoken = text.length > left ? text.slice(0, left) : text;
    if (!spoken.trim()) return;
    run.spent += spoken.length;

    run.requests += 1;
    run.queue.push({
      id: run.id,
      text: spoken,
      // Style is part of the key: the same sentence read in Hint mode and in
      // Interview mode must not replay the other one's audio.
      cacheKey: `${run.voice}|${run.style}|${spoken}`,
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
        const ahead = run.scheduledUntil - (ctx?.currentTime ?? 0);
        if (!run.browserOnly && ctx && ahead > LOOKAHEAD_SECONDS) {
          // Enough audio queued; let the playhead catch up before spending
          // another TTS request.
          await sleep(150);
          continue;
        }

        const chunk = run.queue.shift();
        if (!chunk) continue;

        if (run.browserOnly) {
          await this.speakWithBrowser(run, chunk, token);
          continue;
        }

        const buffer = await this.audioFor(run, chunk, token);
        if (token !== this.token || this.run !== run) return;

        if (buffer) {
          this.schedule(run, chunk, buffer);
        } else {
          // TTS unavailable for this chunk — keep the answer audible with the
          // browser's own voice rather than dropping a sentence.
          await this.speakWithBrowser(run, chunk, token);
        }

        if (run.failures >= 2) run.browserOnly = true;
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
        synthesizeSpeech({
          text: chunk.text,
          voice: run.voice,
          style: run.style,
        }),
        sleep(TTS_TIMEOUT_MS).then(() => null),
      ]);
      if (token !== this.token) return null;

      if (!res) {
        run.failures += 1;
        console.warn("[voice] TTS timed out");
        return null;
      }

      if ("error" in res) {
        run.failures += 1;
        // A spent quota is not worth retrying per sentence — every later chunk
        // would pay the same multi-key delay. Park Gemini and fall back fast.
        if (/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(res.error)) {
          this.geminiBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
          run.browserOnly = true;
          this.setSnapshot({ voice: "browser" });
        }
        console.warn("[voice] TTS failed:", res.error);
        return null;
      }
      const bytes = dataUriToBytes(res.audio);
      cacheAudio(chunk.cacheKey, bytes);
      run.failures = 0;
      return this.decode(bytes);
    } catch (err) {
      if (token !== this.token) return null;
      run.failures += 1;
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
      voice: "gemini",
    });
    this.scheduleSettle(run.scheduledUntil - ctx.currentTime);
  }

  /** Browser speech synthesis, used when Gemini TTS is unavailable. */
  private async speakWithBrowser(run: Run, chunk: Chunk, token: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    await whenVoicesReady();
    if (token !== this.token || this.run !== run) return;

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.lang = run.lang;
    utterance.rate = 1;
    // Take the best installed voice, not whatever happens to be the default
    // (which is usually the worst one on the machine).
    const voice = pickBrowserVoice(run.lang);
    if (voice) utterance.voice = voice;

    run.browserActive = true;
    this.setSnapshot({
      speakingId: chunk.id,
      status: "speaking",
      voice: "browser",
    });

    await new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(guard);
        run.browserActive = false;
        resolve();
      };
      // Some browsers never fire onend for an interrupted utterance.
      const guard = window.setTimeout(
        finish,
        Math.max(2000, chunk.text.length * 90)
      );
      utterance.onend = finish;
      utterance.onerror = finish;

      if (token !== this.token) {
        finish();
        return;
      }
      synth.speak(utterance);
    });

    if (token === this.token) this.settle();
  }

  /** Move to idle once every queued chunk has finished playing. */
  private settle() {
    const run = this.run;
    const ctx = this.ctx;

    if (!run) {
      if (this.snapshot.status !== "idle") this.setSnapshot(IDLE);
      return;
    }
    if (run.browserActive || run.queue.length > 0 || run.pending || run.buffer) {
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
    this.setSnapshot(IDLE);
  }

  private scheduleSettle(afterSeconds: number) {
    const run = this.run;
    const ctx = this.ctx;
    if (!run || !ctx || run.browserActive) return;
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
