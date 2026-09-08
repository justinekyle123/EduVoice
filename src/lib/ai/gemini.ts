import { GoogleGenAI, type Content } from "@google/genai";

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

export const EDUVOICE_SYSTEM_INSTRUCTION = `You are EduVoice, an AI learning companion for students. You are patient, encouraging, and concise.
- Detect the language the student uses (English, Filipino/Tagalog, or Cebuano/Bisaya) and ALWAYS respond in that same language.
- Explain concepts clearly with short, concrete examples.
- If the student sounds confused, frustrated, or stressed, simplify your explanation and offer encouragement.
- Never give away the full answer in Hint Mode; give one progressive clue at a time and ask the student to try again.
- Keep answers focused — no long preambles.`;

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