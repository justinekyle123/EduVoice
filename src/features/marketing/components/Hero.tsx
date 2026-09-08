"use client";

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

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-gradient-to-b from-indigo-50/80 via-white to-white"
    >
      {/* soft background blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-200/50 via-violet-200/40 to-fuchsia-200/50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-32 text-center sm:px-6 sm:pt-36">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div
            variants={item}
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-white/70 px-4 py-1.5 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered learning companion
          </motion.div>

          <motion.h1
            variants={item}
            className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-900 sm:text-6xl"
          >
            Study out loud.{" "}
            <span className="animate-gradient bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-[length:200%_auto] bg-clip-text text-transparent">
              Learn smarter.
            </span>
          </motion.h1>

          <motion.p
            variants={item}
            className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600"
          >
            {siteConfig.description}
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <a
              href="#cta"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-zinc-900 px-7 text-sm font-medium text-white shadow-lg shadow-zinc-900/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-700 hover:shadow-xl"
            >
              Get started free
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center rounded-full border border-zinc-200 bg-white px-7 text-sm font-medium text-zinc-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
            >
              See how it works
            </a>
          </motion.div>

          <motion.div
            variants={item}
            className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-zinc-500"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200">
              <Mic className="h-3.5 w-3.5 text-indigo-500" /> Voice Q&A
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200">
              <Volume2 className="h-3.5 w-3.5 text-violet-500" /> Spoken answers
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-zinc-200">
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
          <div className="animate-float rounded-3xl border border-zinc-200/80 bg-white p-5 text-left shadow-2xl shadow-indigo-900/10">
            {/* window header */}
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-4">
              <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              <span className="ml-2 text-xs font-medium text-zinc-400">
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
              <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700">
                <p>
                  Sure! Ang <strong>photosynthesis</strong> ay ang proseso
                  kung saan gumagawa ng pagkain ang mga halaman gamit ang
                  sikat ng araw. 🌱
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
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
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-fuchsia-200/70 bg-fuchsia-50 px-3.5 py-2 text-xs font-medium text-fuchsia-700">
              <Sparkles className="h-4 w-4" />
              Quiz generated · Photosynthesis · 5 items
            </div>
          </div>

          {/* floating chips */}
          <div className="animate-float absolute -left-6 top-16 hidden rounded-2xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs font-medium text-zinc-700 shadow-xl shadow-indigo-900/5 sm:block [animation-delay:1.2s]">
            <span className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Hint mode on
            </span>
          </div>
          <div className="animate-float absolute -right-4 bottom-16 hidden rounded-2xl border border-zinc-200/80 bg-white px-3.5 py-2.5 text-xs font-medium text-zinc-700 shadow-xl shadow-indigo-900/5 sm:block [animation-delay:2s]">
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
          className="mx-auto mt-16 grid max-w-2xl grid-cols-3 divide-x divide-zinc-200 rounded-2xl border border-zinc-200/70 bg-white/60 py-6 shadow-sm backdrop-blur"
        >
          {[
            ["15", "study features"],
            ["3", "languages"],
            ["100%", "hands-free"],
          ].map(([value, label]) => (
            <div key={label} className="px-4 text-center">
              <p className="text-2xl font-semibold tracking-tight text-zinc-900">
                {value}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {label}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}