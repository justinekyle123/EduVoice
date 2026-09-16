// Unified AI entry point. Call this instead of the individual providers.
//
// Everything is served by Google AI Studio (Gemini). Instead of falling back to
// another vendor, the provider layer rotates across the API keys of up to three
// AI Studio accounts — one free-tier quota each — and retries on the next key
// when one is out of quota. That logic lives in ./keys.ts.

import type { Content } from "@google/genai";
import {
  generateText as geminiGenerateText,
  generateTextStream as geminiGenerateTextStream,
} from "./gemini";

/** Which AI Studio account answered: slot 1, 2 or 3 of the key pool. */
export type Provider = `gemini-${number}`;

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
  /** Ask for a JSON body instead of prose (see ./gemini.ts). */
  json?: boolean;
};

export type GenerateTextResult = {
  text: string;
  provider: Provider;
};

export async function generateText(
  input: GenerateTextInput
): Promise<GenerateTextResult> {
  const { text, slot } = await geminiGenerateText(input);
  return { text, provider: `gemini-${slot}` };
}

export type TextStreamChunk = {
  /** Text that arrived since the previous chunk. */
  text: string;
  provider: Provider;
};

/**
 * Stream a reply one fragment at a time. Voice mode feeds these fragments into
 * the speech pipeline so the tutor starts talking before the answer is finished.
 */
export async function* generateTextStream(
  input: Omit<GenerateTextInput, "json"> & { signal?: AbortSignal }
): AsyncGenerator<TextStreamChunk> {
  for await (const chunk of geminiGenerateTextStream(input)) {
    yield { text: chunk.delta, provider: `gemini-${chunk.slot}` };
  }
}
