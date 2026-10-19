// Render the fixed spoken lines in src/features/chat/lib/phrases.ts to WAV files
// under data/phrases/, once, so the app never spends a TTS request on words that
// never change again.
//
// That is two groups of lines today: what voice mode opens with, and what voice
// navigation says back to a command ("Scrolled up.", "Opening the quiz."). Both
// are fixed text, both would otherwise be synthesized — and written into
// data/speech/ — the first time a student heard them.
//
//   npm run phrases:generate                      → generate anything missing
//   npm run phrases:generate -- --force           → regenerate every line
//   npm run phrases:generate -- --only key1,key2  → render just those keys
//
// The npm script bundles this file with esbuild (the app's own code is
// TypeScript and imports through the `@/` alias, which plain `node` can't
// resolve) and runs it with the project's .env loaded, so GEMINI_API_KEY and the
// same voice/style tables the server uses are all in play. Anything already on
// disk in data/phrases is skipped unless --force, so re-running is cheap.

import { PHRASE_BANK } from "../src/features/chat/lib/phrases";
import { DEFAULT_TTS_VOICE, resolveTtsVoice } from "../src/features/chat/lib/voices";
import {
  readPhraseAudio,
  savePhraseAudio,
} from "../src/features/chat/server/speechStore";
import { synthesizeSpeechBytes } from "../src/features/chat/server/ttsCore";
import { hasReadyKey } from "../src/lib/ai/keys";

const force = process.argv.includes("--force");

/**
 * `--only a,b,c` renders just those keys. Useful right after a line is added:
 * the bank has many translations, and a single new greeting should not have to
 * wait behind every other line (or spend the quota they would cost).
 */
function parseOnly(): Set<string> | null {
  const inline = process.argv.find((arg) => arg.startsWith("--only="));
  const index = process.argv.indexOf("--only");
  const value = inline
    ? inline.slice("--only=".length)
    : index >= 0
      ? process.argv[index + 1]
      : undefined;
  if (!value) return null;
  const keys = value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

const only = parseOnly();

async function main() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error(
      "No GEMINI_API_KEY. Put one in .env (see .env.example) and run this again."
    );
    process.exitCode = 1;
    return;
  }

  // Every key parked on a cooldown means every line would fail the same way —
  // each one after walking the pool — so say so now instead of grinding.
  if (!hasReadyKey()) {
    console.error(
      "No Gemini key is usable right now (a spent daily quota parks one for an hour)." +
        " Nothing was written; run this again once the quota resets."
    );
    process.exitCode = 1;
    return;
  }

  const voice = resolveTtsVoice(process.env.GEMINI_TTS_VOICE ?? DEFAULT_TTS_VOICE);
  const lines = only ? PHRASE_BANK.filter((line) => only.has(line.key)) : PHRASE_BANK;

  if (only && lines.length === 0) {
    console.error(`No phrase matches --only ${[...only].join(",")}.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Phrase bank — voice: ${voice} (${lines.length} of ${PHRASE_BANK.length} lines)`
  );

  const failed: string[] = [];

  for (const line of lines) {
    // Only the committed folder counts: a line that happens to be cached in
    // data/speech is still missing from the bank the next clone will speak from.
    if (!force && (await readPhraseAudio(line.key))) {
      console.log(`  • ${line.key} already exists — skipping`);
      continue;
    }

    const started = Date.now();
    const result = await synthesizeSpeechBytes({
      text: line.text,
      voice,
      style: line.style,
    });

    if ("error" in result) {
      failed.push(`${line.key}: ${result.error}`);
      console.error(`  ✗ ${line.key} — ${result.error}`);
      // A spent quota is spent for every remaining line too, and each attempt
      // walks the whole key pool first — so stop rather than grind through the
      // bank, and say what to do about it.
      if (result.quota) {
        console.error(
          "\nOut of TTS quota — stopping here. The bank is only written for the lines" +
            " that were rendered; run this again once the quota resets (the lines already" +
            " on disk are skipped)."
        );
        break;
      }
      continue;
    }

    await savePhraseAudio(line.key, result.bytes);
    console.log(
      `  ✓ ${line.key} — ${(result.bytes.length / 1024).toFixed(0)} KB in ${(
        (Date.now() - started) / 1000
      ).toFixed(1)}s  "${line.text}"`
    );
  }

  if (failed.length > 0) {
    console.error(
      `\n${failed.length} line(s) failed. Nothing is broken at runtime — the app` +
        ` synthesizes a line on first use and saves it — but check the TTS quota/model.`
    );
    process.exitCode = 1;
  } else {
    console.log("\nDone. Files written under data/phrases/.");
  }
}

main().catch((err) => {
  console.error("Phrase generation failed:", err);
  process.exitCode = 1;
});
