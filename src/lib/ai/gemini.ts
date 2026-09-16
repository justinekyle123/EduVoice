import type { Content } from "@google/genai";
import { EDUVOICE_SYSTEM_INSTRUCTION } from "@/lib/ai/persona";
import {
  classifyFailure,
  clientFor,
  parkKeyForFailure,
  markSuccess,
  pickKey,
  withGeminiKey,
  type AiFailure,
  type FailureKind,
} from "./keys";

// Server-only Gemini helper. Never import this from client components —
// the API key must stay on the server.
//
// API keys: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 — one per Google
//           AI Studio account. Requests rotate across them; see ./keys.ts.
// Models:   GEMINI_MODEL (defaults to gemini-3.6-flash) followed by
//           GEMINI_MODEL_FALLBACKS. Free-tier quota is metered per model —
//           gemini-3.6-flash allows 20 requests per day when this was written —
//           so an exhausted model falls through to the next in the chain instead
//           of ending the request.

const DEFAULT_MODEL = "gemini-3.6-flash";

// Sibling flash models, newest first. Each has its own daily free allowance, so
// these are what keep the app answering after the primary model's 20 requests.
// (Checked against this key's ModelService.ListModels — a model name that isn't
// served for the key fails with a 404, so the chain only lists real ones.)
const DEFAULT_FALLBACKS = "gemini-3.7-flash,gemini-3.8-flash";

/** Models to try in order, de-duplicated. */
export function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS ?? DEFAULT_FALLBACKS)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return [...new Set([primary, ...fallbacks])];
}

// Persona lives in ./persona.ts so the client can reuse it for mode pickers.

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
  /**
   * Request a JSON body (used by the quiz generator, which parses the reply).
   * Chat leaves this off so replies stay prose.
   */
  json?: boolean;
};

export type GenerateTextOutput = {
  text: string;
  /** Slot of the API key that answered, so callers can record which account. */
  slot: number;
  /** Which model in the chain produced the reply, recorded for diagnostics. */
  model: string;
};

/** Generate a single AI response, optionally continuing a conversation. */
export async function generateText({
  prompt,
  systemInstruction = EDUVOICE_SYSTEM_INSTRUCTION,
  history = [],
  json = false,
}: GenerateTextInput): Promise<GenerateTextOutput> {
  const models = modelChain();
  let lastError: unknown = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];

    try {
      const { value: response, key } = await withGeminiKey((client) =>
        client.models.generateContent({
          model,
          contents: [...history, { role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        })
      );

      return { text: response.text ?? "", slot: key.slot, model };
    } catch (err) {
      lastError = err;

      // A model name that isn't served to this key produces a wall of JSON, so
      // say the actionable part instead.
      if (/NOT_FOUND|is not found for API version|not supported for generateContent/i.test(
        err instanceof Error ? err.message : ""
      )) {
        throw new Error(
          `The model "${model}" isn't available to this API key. Check GEMINI_MODEL in .env — "${DEFAULT_MODEL}" is a safe default.`
        );
      }

      // Only a spent quota is worth re-sending to another model: the daily
      // allowance is per model, so the next one may be untouched. A busy model, a
      // bad key, or a rejected prompt would fail identically elsewhere.
      if ((err as AiFailure).kind !== "quota") throw err;

      const next = models[index + 1];
      if (next) {
        console.warn(`[ai] ${model} is out of quota — falling back to ${next}`);
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Streaming (voice mode)
// ---------------------------------------------------------------------------

export type TextStreamChunk = {
  /** Text that arrived since the previous chunk. */
  delta: string;
  /** Slot of the API key that answered. */
  slot: number;
  /** Model in the chain that is answering. */
  model: string;
};

export type GenerateTextStreamInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
  /** Aborts the upstream request when the student hangs up or interrupts. */
  signal?: AbortSignal;
};

/**
 * Stream a reply token by token.
 *
 * Voice mode speaks each sentence as soon as it lands, so the student hears the
 * tutor start answering while the rest of the reply is still being written.
 *
 * Rotation works as in generateText — least-recently-used key first, then the
 * next model — with one extra rule: a failure is only retried on another key or
 * model while *nothing has been spoken yet*. Once words are on their way,
 * restarting would repeat or contradict them, so the error is surfaced instead.
 */
export async function* generateTextStream({
  prompt,
  systemInstruction = EDUVOICE_SYSTEM_INSTRUCTION,
  history = [],
  signal,
}: GenerateTextStreamInput): AsyncGenerator<TextStreamChunk> {
  const models = modelChain();
  const tried = new Set<number>();
  let lastError: unknown = null;
  let lastKind: FailureKind = "quota";

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];

    for (;;) {
      const key = pickKey({ exclude: tried });
      if (!key) break;
      tried.add(key.slot);

      let stream: AsyncGenerator<{ text?: string }>;
      try {
        stream = await clientFor(key).models.generateContentStream({
          model,
          contents: [...history, { role: "user", parts: [{ text: prompt }] }],
          config: { systemInstruction, abortSignal: signal },
        });
      } catch (err) {
        // The request never started, so another key can take it over.
        lastError = err;
        lastKind = classifyFailure(err);
        if (lastKind === "fatal") throw err;
        parkKeyForFailure(key.slot, lastKind, err);
        continue;
      }

      let emitted = false;
      try {
        for await (const chunk of stream) {
          const delta = chunk.text ?? "";
          if (!delta) continue;
          emitted = true;
          yield { delta, slot: key.slot, model };
        }
        markSuccess(key.slot);
        return;
      } catch (err) {
        lastError = err;
        lastKind = classifyFailure(err);
        parkKeyForFailure(key.slot, lastKind, err);
        if (lastKind === "fatal" || emitted) throw err;
        continue;
      }
    }

    // A spent quota is metered per model, so the next model in the chain may
    // still have its own daily allowance. Any other failure would repeat there.
    if (lastKind !== "quota" && lastKind !== "busy") break;
    const next = models[index + 1];
    if (next) {
      console.warn(`[ai] stream: ${model} unavailable — trying ${next}`);
      tried.clear();
    }
  }

  if (lastKind === "auth") {
    throw new Error(
      "Every configured Gemini API key was rejected. Check GEMINI_API_KEY, GEMINI_API_KEY_2 and GEMINI_API_KEY_3."
    );
  }
  throw lastError ?? new Error("The AI could not answer right now.");
}

/** Quick connectivity check — used by a test script and diagnostics. */
export async function pingGemini(): Promise<string> {
  const models = modelChain();
  const { value: response } = await withGeminiKey((client) =>
    client.models.generateContent({
      model: models[0],
      contents: "Reply with exactly: OK",
    })
  );
  return response.text ?? "";
}
