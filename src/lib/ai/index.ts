// Unified AI entry point. Call this instead of the individual providers.
//
// Order (per EduVoice_stack.md, Google AI Studio is the primary API):
//   1. gemini (primary, default) — falls back to groq on failure
//   2. groq (primary)            — falls back to gemini on failure
//
// Override the primary with the AI_PROVIDER env var: AI_PROVIDER=groq

import { generateText as geminiGenerateText } from "./gemini";
import { generateText as groqGenerateText } from "./groq";
import type { Content } from "@google/genai";

export type Provider = "gemini" | "groq";

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
};

export type GenerateTextResult = {
  text: string;
  provider: Provider;
};

function primaryProvider(): Provider {
  return process.env.AI_PROVIDER?.toLowerCase() === "groq" ? "groq" : "gemini";
}

export async function generateText(
  input: GenerateTextInput
): Promise<GenerateTextResult> {
  const primary = primaryProvider();
  const fallback: Provider = primary === "groq" ? "gemini" : "groq";
  const first = primary === "groq" ? groqGenerateText : geminiGenerateText;
  const second = fallback === "groq" ? groqGenerateText : geminiGenerateText;

  try {
    return { text: await first(input), provider: primary };
  } catch (primaryError) {
    console.error(
      `[ai] ${primary} request failed, falling back:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );
  }

  return { text: await second(input), provider: fallback };
}