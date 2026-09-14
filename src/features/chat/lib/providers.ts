// Display helpers for the `provider` recorded on each assistant message. The
// server stores which key slot answered — "gemini-2" is slot 2 of the Google AI
// Studio pool (see src/lib/ai/keys.ts) — so the badge tells you which account
// is serving you. Older rows may hold plain "gemini" or a provider string from
// before the key pool existed, so unknown values still get a sensible label.

const LABELS: Record<string, string> = {
  gemini: "Gemini",
  "gemini-1": "Gemini · key 1",
  "gemini-2": "Gemini · key 2",
  "gemini-3": "Gemini · key 3",
};

/** Human label for a provider string, e.g. "gemini-2" → "Gemini · key 2". */
export function providerLabel(provider: string): string {
  return (
    LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

/** Dot colour for the badge: brand colour for Gemini, neutral otherwise. */
export function providerDotClass(provider: string): string {
  return provider.startsWith("gemini") ? "bg-indigo-500" : "bg-zinc-400";
}
