import type { Content } from "@google/genai";
import { EDUVOICE_SYSTEM_INSTRUCTION } from "@/lib/ai/persona";
import { withGeminiKey } from "./keys";

// Server-only Gemini helper. Never import this from client components —
// the API key must stay on the server.
//
// API keys: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 — one per Google
//           AI Studio account. Requests rotate across them; see ./keys.ts.
// Model:    GEMINI_MODEL env var, defaults to gemini-3.6-flash (free tier).

const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

// Persona lives in ./persona.ts so the client can reuse it for mode pickers.

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
};

export type GenerateTextOutput = {
  text: string;
  /** Slot of the API key that answered, so callers can record which account. */
  slot: number;
};

/** Generate a single AI response, optionally continuing a conversation. */
export async function generateText({
  prompt,
  systemInstruction = EDUVOICE_SYSTEM_INSTRUCTION,
  history = [],
}: GenerateTextInput): Promise<GenerateTextOutput> {
  const { value: response, key } = await withGeminiKey((client) =>
    client.models.generateContent({
      model,
      contents: [...history, { role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction },
    })
  );

  return { text: response.text ?? "", slot: key.slot };
}

/** Quick connectivity check — used by a test script and diagnostics. */
export async function pingGemini(): Promise<string> {
  const { value: response } = await withGeminiKey((client) =>
    client.models.generateContent({
      model,
      contents: "Reply with exactly: OK",
    })
  );
  return response.text ?? "";
}
