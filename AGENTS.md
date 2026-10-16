<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- **Never use the browser's text-to-speech.** Spoken replies come only from the
  server-side Gemini TTS (`src/features/chat/lib/speechEngine.ts` →
  `/api/chat/speech` → `src/features/chat/server/ttsCore.ts`).
  `window.speechSynthesis` and `SpeechSynthesisUtterance` must not appear
  anywhere in the app. If synthesis fails, the reply stays on screen and the
  engine reports it through `SpeechSnapshot.unavailable` so the UI can say so
  instead of swapping in a different voice. Speech *recognition* (Web Speech
  STT) is a separate feature and is unaffected.
