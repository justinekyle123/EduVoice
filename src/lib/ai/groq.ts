import Groq from "groq-sdk";
import type { Content } from "@google/genai";
import { EDUVOICE_SYSTEM_INSTRUCTION } from "@/lib/ai/persona";

// Server-only Groq helper. Never import this from client components — the
// API key must stay on the server.
//
// API key: https://console.groq.com → API Keys (env: GROQ_API_KEY)
// Model:   GROQ_MODEL env var, defaults to openai/gpt-oss-20b (fast + cheap).

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";

let client: Groq | null = null;

function getClient(): Groq {
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Create a key at https://console.groq.com and add it to .env"
    );
  }
  client ??= new Groq({ apiKey });
  return client;
}

export type GenerateTextInput = {
  prompt: string;
  systemInstruction?: string;
  history?: Content[];
};

// Convert Gemini-style history ({ role: "user" | "model", parts: [{ text }] })
// into OpenAI-compatible messages expected by Groq.
function toMessages(
  prompt: string,
  systemInstruction: string,
  history: Content[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> =
    [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  for (const entry of history) {
    messages.push({
      role: entry.role === "model" ? "assistant" : "user",
      content: (entry.parts ?? [])
        .map((part) => part.text ?? "")
        .join(""),
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

/** Generate a single AI response, optionally continuing a conversation. */
export async function generateText({
  prompt,
  systemInstruction = EDUVOICE_SYSTEM_INSTRUCTION,
  history = [],
}: GenerateTextInput): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model,
    messages: toMessages(prompt, systemInstruction, history),
  });

  return completion.choices[0]?.message?.content ?? "";
}

/** Quick connectivity check — used by a test script and diagnostics. */
export async function pingGroq(): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });
  return completion.choices[0]?.message?.content ?? "";
}