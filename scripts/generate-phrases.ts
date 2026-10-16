// Render the fixed spoken lines in src/features/chat/lib/phrases.ts to WAV files
// under data/phrases/, once, so the app never spends a TTS request on words that
// never change again.
//
// That is two groups of lines today: what voice mode opens with, and what voice
// navigation says back to a command ("Scrolled up.", "Opening the quiz."). Both
// are fixed text, both would otherwise be synthesized — and written into
// data/speech/ — the first time a student heard them.
//
//   npm run phrases:generate            → generate anything missing
//   npm run phrases:generate -- --force → regenerate every line
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

const force = process.argv.includes("--force");

async function main() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error(
      "No GEMINI_API_KEY. Put one in .env (see .env.example) and run this again."
    );
    process.exitCode = 1;
    return;
  }

  const voice = resolveTtsVoice(process.env.GEMINI_TTS_VOICE ?? DEFAULT_TTS_VOICE);
  console.log(`Phrase bank — voice: ${voice} (${PHRASE_BANK.length} lines)`);

  const failed: string[] = [];

  for (const line of PHRASE_BANK) {
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
