import { GoogleGenAI } from "@google/genai";

// Server-only Gemini key pool. Never import this from client components — the
// API keys must stay on the server.
//
// Every Google AI Studio account gets its own free-tier quota, so EduVoice can
// stay on the free tier by spreading requests across the keys of up to three
// accounts:
//
//   GEMINI_API_KEY     → slot 1
//   GEMINI_API_KEY_2   → slot 2
//   GEMINI_API_KEY_3   → slot 3
//
// Requests go to the key used longest ago (round-robin), which keeps all three
// accounts under their per-minute limits instead of burning through one. When a
// key reports a quota or availability error it is parked for a while and the
// same request is retried on the next key, so a single exhausted account can
// never take the app down. Chat and TTS share this pool, so they also share the
// quota accounting.

export type GeminiKey = {
  /** 1-based slot, used in logs and in the `provider` recorded on a message. */
  slot: number;
  /** Label for logs — never the key itself, which must not reach a log line. */
  label: string;
  key: string;
};

/** Env vars by slot, in the order they are preferred. */
const ENV_NAMES = [
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
] as const;

// A quota error usually clears in seconds (per-minute limits) — but a daily cap
// only lifts at midnight Pacific, so each repeat offence doubles the penalty
// instead of letting one dead key soak up every third request.
const MIN_COOLDOWN_MS = 20_000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
/** Overloaded/unavailable upstream: usually recovers within a few seconds. */
const BUSY_COOLDOWN_MS = 15_000;

// A 503 from Google ("this model is currently experiencing high demand") is a
// spike, not a broken key — and with a single configured key there is no other
// account to fall back on, so one spike would otherwise end the request. Retry
// the same key a couple of times with a short backoff before giving up.
const BUSY_RETRIES = 2;
const BUSY_RETRY_BASE_MS = 700;

type KeyState = {
  /** Epoch ms until this key may be used again. */
  cooldownUntil: number;
  /** Epoch ms when this key was last handed out — drives the round-robin. */
  lastUsedAt: number;
  /** Consecutive quota/service failures, used to grow the cooldown. */
  failures: number;
  /** Set when the key was rejected outright (wrong, revoked, no access). */
  disabled: boolean;
};

const states = new Map<number, KeyState>();
const clients = new Map<number, GoogleGenAI>();
let pool: GeminiKey[] | null = null;

function stateFor(slot: number): KeyState {
  let state = states.get(slot);
  if (!state) {
    state = {
      cooldownUntil: 0,
      lastUsedAt: 0,
      failures: 0,
      disabled: false,
    };
    states.set(slot, state);
  }
  return state;
}

/** Configured keys in preference order, with blanks and duplicates dropped. */
export function geminiKeys(): GeminiKey[] {
  if (pool) return pool;

  const seen = new Set<string>();
  const keys: GeminiKey[] = [];
  ENV_NAMES.forEach((name, index) => {
    const key = process.env[name]?.trim();
    // Two identical keys would just add the same quota twice.
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push({ slot: index + 1, label: `key ${index + 1}`, key });
  });

  pool = keys;
  return pool;
}

/** True when at least one key is configured. */
export function hasGeminiKeys(): boolean {
  return geminiKeys().length > 0;
}

/** True when some key is usable right now (not disabled, not cooling down). */
export function hasReadyKey(now = Date.now()): boolean {
  return geminiKeys().some(
    (key) =>
      !stateFor(key.slot).disabled && stateFor(key.slot).cooldownUntil <= now
  );
}

/** Client for a slot, built on first use and reused afterwards. */
function clientFor(key: GeminiKey): GoogleGenAI {
  let client = clients.get(key.slot);
  if (!client) {
    client = new GoogleGenAI({ apiKey: key.key });
    clients.set(key.slot, client);
  }
  return client;
}

/**
 * Next key to use: the least recently used one that isn't parked, so parallel
 * requests fan out across accounts. If every key is cooling down we return the
 * one that recovers soonest — the cooldown is an estimate, and an attempt is a
 * better bet than failing outright. Returns null only when no key is
 * configured or every key has been rejected.
 */
export function pickKey(options?: {
  now?: number;
  exclude?: Set<number>;
}): GeminiKey | null {
  const now = options?.now ?? Date.now();
  const exclude = options?.exclude;
  const usable = geminiKeys().filter(
    (key) => !stateFor(key.slot).disabled && !exclude?.has(key.slot)
  );
  if (usable.length === 0) return null;

  const ready = usable.filter((key) => stateFor(key.slot).cooldownUntil <= now);
  const candidates = ready.length > 0 ? ready : usable;
  candidates.sort((a, b) => {
    const sa = stateFor(a.slot);
    const sb = stateFor(b.slot);
    const delta = ready.length > 0
      ? sa.lastUsedAt - sb.lastUsedAt
      : sa.cooldownUntil - sb.cooldownUntil;
    return delta !== 0 ? delta : a.slot - b.slot;
  });

  const chosen = candidates[0];
  // Reserve it immediately so that requests issued in the same tick don't
  // all land on the same account.
  stateFor(chosen.slot).lastUsedAt = now;
  return chosen;
}

/** The key worked: clear its penalty. */
export function markSuccess(slot: number): void {
  const state = stateFor(slot);
  state.failures = 0;
  state.cooldownUntil = 0;
}

/** Park a key for at least `ms`, doubling the window on repeat failures. */
export function markCooldown(slot: number, ms: number): void {
  const state = stateFor(slot);
  state.failures += 1;
  const grown = Math.min(ms * 2 ** (state.failures - 1), MAX_COOLDOWN_MS);
  state.cooldownUntil = Date.now() + Math.max(grown, MIN_COOLDOWN_MS);
}

/** The key is not usable at all — a wrong, revoked, or unauthorised key. */
export function markDisabled(slot: number): void {
  stateFor(slot).disabled = true;
}

export type FailureKind =
  /** Out of quota / rate limited — try another key, park this one. */
  | "quota"
  /** Upstream overloaded — try another key, park this one briefly. */
  | "busy"
  /** The key itself was rejected — disable it and try another. */
  | "auth"
  /** Bad request, blocked content… another key would fail the same way. */
  | "fatal";

/**
 * An error raised by the pool, tagged with why it failed. Callers use `kind` to
 * decide what to do next — notably, a spent quota is metered per model, so it is
 * worth retrying the same request on a different model.
 */
export type AiFailure = Error & { kind?: FailureKind };

function aiError(message: string, kind: FailureKind): AiFailure {
  const error = new Error(message) as AiFailure;
  error.kind = kind;
  return error;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return undefined;
  }
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Classify a GenAI failure so we know whether another key is worth trying. */
export function classifyFailure(err: unknown): FailureKind {
  const status = statusOf(err);
  const text = messageOf(err);

  if (
    status === 401 ||
    status === 403 ||
    /API[_ ]KEY_INVALID|PERMISSION_DENIED|API key not valid/i.test(text)
  ) {
    return "auth";
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    return "quota";
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|overloaded|deadline exceeded/i.test(text)
  ) {
    return "busy";
  }
  return "fatal";
}

/**
 * `retryDelay` from a Google quota error body, e.g. `"retryDelay":"37s"`. The
 * SDK puts the whole error JSON in the message, so it is safe to read it from
 * there; when it is missing we fall back to the caller's default.
 */
export function retryDelayMs(err: unknown): number | null {
  const match = /"?retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(
    messageOf(err)
  );
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, MAX_COOLDOWN_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt a request against one key, riding out a busy upstream with a short
 * backoff. Safe to retry: every caller generates text rather than mutating
 * anything, so a repeat costs quota and nothing else.
 */
async function runWithBusyRetries<T>(
  run: (client: GoogleGenAI, key: GeminiKey) => Promise<T>,
  client: GoogleGenAI,
  key: GeminiKey
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await run(client, key);
    } catch (err) {
      if (classifyFailure(err) !== "busy" || retry >= BUSY_RETRIES) throw err;

      const wait = BUSY_RETRY_BASE_MS * 2 ** retry + Math.random() * 300;
      console.warn(
        `[ai] Gemini ${key.label} is busy — retry ${retry + 1}/${BUSY_RETRIES} in ${Math.round(wait)}ms`
      );
      await sleep(wait);
    }
  }
}

/**
 * Run `run` with one of the configured keys, moving to the next key when that
 * key is out of quota or unavailable. Returns the value plus the key that
 * produced it, so callers can record which account answered.
 */
export async function withGeminiKey<T>(
  run: (client: GoogleGenAI, key: GeminiKey) => Promise<T>
): Promise<{ value: T; key: GeminiKey }> {
  const poolSize = geminiKeys().length;
  if (poolSize === 0) {
    throw aiError(
      "GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com/app/apikey and add it to .env",
      "auth"
    );
  }

  // If nothing is ready we still make one best-effort attempt (the cooldown is
  // only an estimate) instead of trying every parked key in turn.
  const attempts = hasReadyKey() ? poolSize : 1;
  const tried = new Set<number>();
  let lastError: unknown = null;
  let lastKind: FailureKind = "quota";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const key = pickKey({ exclude: tried });
    if (!key) break;
    tried.add(key.slot);

    try {
      const value = await runWithBusyRetries(run, clientFor(key), key);
      markSuccess(key.slot);
      return { value, key };
    } catch (err) {
      lastError = err;

      const kind = classifyFailure(err);
      lastKind = kind;

      if (kind === "fatal") {
        // A bad request or blocked content: another account would fail too.
        throw err;
      }

      if (kind === "auth") {
        markDisabled(key.slot);
        console.error(
          `[ai] Gemini ${key.label} was rejected — disabled for this process`
        );
        continue;
      }

      if (kind === "busy") {
        markCooldown(key.slot, BUSY_COOLDOWN_MS);
        console.warn(`[ai] Gemini ${key.label} is overloaded — trying the next key`);
        continue;
      }

      // A per-day allowance won't return in the few seconds the retry hint
      // suggests, so park the key for the full window instead of hammering it.
      const perDay = /PerDay|per day/i.test(messageOf(err));
      markCooldown(
        key.slot,
        perDay ? MAX_COOLDOWN_MS : retryDelayMs(err) ?? MIN_COOLDOWN_MS
      );
      console.warn(
        `[ai] Gemini ${key.label} is out of ${perDay ? "daily " : ""}quota — trying the next key`
      );
    }
  }

  // Everything failed. Log the provider detail, but hand the user something
  // readable (the raw error body is a wall of JSON).
  if (tried.size === 0 || lastKind === "auth") {
    throw aiError(
      "Every configured Gemini API key was rejected. Check GEMINI_API_KEY, GEMINI_API_KEY_2 and GEMINI_API_KEY_3.",
      "auth"
    );
  }
  console.error("[ai] all Gemini keys are unavailable:", messageOf(lastError));

  // Say which of the two problems it is: an overloaded model clears in seconds,
  // while a spent free-tier quota only resets later. Telling a student to
  // "try again in a moment" when the quota is gone just wastes their time.
  if (lastKind === "busy") {
    throw aiError(
      "The AI model is busy right now — Google reports high demand. Try again in a few seconds.",
      "busy"
    );
  }
  throw aiError(
    "The AI has used up its free-tier quota for now. It resets within an hour, or you can add another AI Studio key to spread the load.",
    "quota"
  );
}
