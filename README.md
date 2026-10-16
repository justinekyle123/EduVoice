This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Voice audio on disk

Speech is not synthesized twice. `POST /api/chat/speech` returns WAV bytes, saves
them under `data/speech/<key>.wav` the first time a passage is spoken, and serves
the file from then on; `GET /api/chat/speech/<key>` plays a saved clip.

The lines that never change are pre-rendered into `data/phrases/`, which is
committed, so they are free on every call and never write a clip into
`data/speech/`. That is voice mode's opener for each study mode, and the
confirmations voice navigation speaks back to a command — "Opening the quiz.",
"Scrolled up.", "Sorry, I did not catch that." All of them are listed in
`src/features/chat/lib/phrases.ts`; anything carrying a page label, an item
number or the page's own text is synthesized as usual:

```bash
npm run phrases:generate          # render any missing lines (uses GEMINI_API_KEY)
npm run phrases:generate -- --force
```

`data/phrases/` is the only part of `data/` in git; the rest is local state and
can be deleted at any time.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
