"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, type Variants } from "motion/react";
import { Languages, Lightbulb, Mic, Sparkles, Volume2 } from "lucide-react";
import { siteConfig } from "@/lib/constants";

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const bars = [0, 1, 2, 3, 4];

function useTypewriter(
  text: string,
  {
    typeMs = 35,
    deleteMs = 14,
    holdMs = 10000,
    restMs = 2000,
  }: { typeMs?: number; deleteMs?: number; holdMs?: number; restMs?: number } = {}
) {
  const [count, setCount] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Skip the animation: show the full text once and stop looping.
      if (count !== text.length) {
        timer = setTimeout(() => setCount(text.length), 0);
      }
      return () => clearTimeout(timer);
    }

    if (!deleting && count === text.length) {
      // Fully typed: hold, then start erasing.
      timer = setTimeout(() => setDeleting(true), holdMs);
    } else if (deleting && count === 0) {
      // Fully erased: rest, then type again.
      timer = setTimeout(() => setDeleting(false), restMs);
    } else {
      timer = setTimeout(
        () => setCount((c) => c + (deleting ? -1 : 1)),
        deleting ? deleteMs : typeMs
      );
    }
    return () => clearTimeout(timer);
  }, [count, deleting, text, typeMs, deleteMs, holdMs, restMs]);

  return text.slice(0, count);
}

export function Hero() {
  const displayed = useTypewriter(siteConfig.description);
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-gradient-to-b from-indigo-50/80 via-white to-white dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950"
    >
      {/* soft background blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-200/50 via-violet-200/40 to-fuchsia-200/50 blur-3xl dark:from-indigo-500/15 dark:via-violet-500/10 dark:to-fuchsia-500/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-32 text-center sm:px-6 sm:pt-36">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.h1
            variants={item}
            className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-6xl"
          >
            Study out loud.{" "}
            <span aria-label="Learn smarter." className="inline-block">
              {"Learn smarter.".split("").map((char, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="animate-wave-gradient inline-block bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-[length:200%_auto] bg-clip-text text-transparent"
                  style={{ animationDelay: `${index * 0.08}s` }}
                >
                  {char === " " ? "\u00A0" : char}
                </span>
              ))}
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            aria-label={siteConfig.description}
            className="relative mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-400"
          >
            {/* invisible copy reserves the paragraph height while typing */}
            <span className="invisible">{siteConfig.description}</span>
            <span className="absolute inset-0" aria-hidden>
              {displayed}
              <span className="animate-blink font-medium text-indigo-500">|</span>
            </span>
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/sign-up"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-zinc-900 px-7 text-sm font-medium text-white shadow-lg shadow-zinc-900/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-700 hover:shadow-xl dark:bg-white dark:text-zinc-900 dark:shadow-black/20 dark:hover:bg-zinc-200"
            >
              Get started free
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center rounded-full border border-zinc-200 bg-white px-7 text-sm font-medium text-zinc-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600"
            >
              See how it works
            </a>
          </motion.div>

          <motion.div
            variants={item}
            className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
              <Mic className="h-3.5 w-3.5 text-indigo-500" /> Voice Q&A
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
              <Volume2 className="h-3.5 w-3.5 text-violet-500" /> Spoken answers
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
              <Languages className="h-3.5 w-3.5 text-fuchsia-500" /> English ·
              Filipino · Cebuano
            </span>
          </motion.div>
        </motion.div>

        {/* chat mockup */}
        <motion.div
          initial={{ opacity: 0, y: 48, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
          className="relative mx-auto mt-16 max-w-xl"
        >
          <div className="animate-float rounded-3xl border border-zinc-200/80 bg-white p-5 text-left shadow-2xl shadow-indigo-900/10 dark:border-zinc-700/60 dark:bg-zinc-900">
            {/* window header */}
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
              <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              <span className="ml-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                EduVoice Assistant
              </span>
            </div>

            {/* user message */}
            <div className="mt-4 flex justify-end">
              <div className="flex max-w-[80%] items-end gap-2 rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm text-white shadow-md shadow-indigo-500/20">
                <Mic className="h-4 w-4 shrink-0 opacity-80" />
                <span>Explain photosynthesis, please.</span>
              </div>
            </div>

            {/* ai message */}
            <div className="mt-3 flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-semibold text-white shadow-sm">
                EV
              </span>
              <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <p>
                  Sure! Ang <strong>photosynthesis</strong> ay ang proseso
                  kung saan gumagawa ng pagkain ang mga halaman gamit ang
                  sikat ng araw. 🌱
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  <span className="flex h-4 items-end gap-[3px]">
                    {bars.map((i) => (
                      <span
                        key={i}
                        className="animate-equalizer w-[3px] origin-bottom rounded-full bg-indigo-500"
                        style={{
                          height: 14,
                          animationDelay: `${i * 0.14}s`,
                        }}
                      />
                    ))}
                  </span>
                  Speaking…
                </div>
              </div>
            </div>

            {/* quiz chip */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-fuchsia-200/70 bg-fuchsia-50 px-3.5 py-2 text-xs font-medium text-fuchsia-700 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
              <Sparkles className="h-4 w-4" />
              Quiz generated · Photosynthesis · 5 items
            </div>
          </div>

          {/* floating chips */}
          <div className="animate-float absolute -left-6 top-16 hidden rounded-2xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs font-medium text-zinc-700 shadow-xl shadow-indigo-900/5 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-zinc-200 sm:block [animation-delay:1.2s]">
            <span className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Hint mode on
            </span>
          </div>
          <div className="animate-float absolute -right-4 bottom-16 hidden rounded-2xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs font-medium text-zinc-700 shadow-xl shadow-indigo-900/5 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-zinc-200 sm:block [animation-delay:2s]">
            <span className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-fuchsia-500" />
              Cebuano detected
            </span>
          </div>
        </motion.div>

        {/* stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1 }}
          className="mx-auto mt-16 grid max-w-2xl grid-cols-3 divide-x divide-zinc-200 rounded-2xl border border-zinc-200/70 bg-white/60 py-6 shadow-sm backdrop-blur dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          {[
            ["15", "study features"],
            ["3", "languages"],
            ["100%", "hands-free"],
          ].map(([value, label]) => (
            <div key={label} className="px-4 text-center">
              <p className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {value}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {label}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}