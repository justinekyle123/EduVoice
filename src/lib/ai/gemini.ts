import { GoogleGenAI, type Content } from "@google/genai";
import { EDUVOICE_SYSTEM_INSTRUCTION } from "@/lib/ai/persona";

// Server-only Gemini helper. Never import this from client components —
// the API key must stay on the server.
//
// API key: https://aistudio.google.com/app/apikey (env: GEMINI_API_KEY)
// Model:   GEMINI_MODEL env var, defaults to gemini-3.6-flash (free tier).

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

let ai: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Create a key at https://aistudio.google.com/app/apikey and add it to .env"
    );
  }
  ai ??= new GoogleGenAI({ apiKey });
  return ai;
}

// Persona lives in ./persona.ts so the client can reuse it for mode pickers.

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
};

/** Generate a single AI response, optionally continuing a conversation. */
export async function generateText({
  prompt,
  systemInstruction = EDUVOICE_SYSTEM_INSTRUCTION,
  history = [],
}: GenerateTextInput): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: [...history, { role: "user", parts: [{ text: prompt }] }],
    config: { systemInstruction },
  });

  return response.text ?? "";
}

/** Quick connectivity check — used by a test script and diagnostics. */
export async function pingGemini(): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: "Reply with exactly: OK",
  });
  return response.text ?? "";
}