"use client";

import { motion } from "motion/react";
import { steps } from "@/lib/constants";

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-y border-zinc-100 bg-zinc-50/60 py-24 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
            From question to mastery in four steps
          </h2>
        </motion.div>

        <div className="relative mt-16 grid gap-10 md:grid-cols-4 md:gap-6">
          {/* connecting line (desktop) */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-indigo-200 via-violet-200 to-fuchsia-200 dark:from-indigo-500/30 dark:via-violet-500/30 dark:to-fuchsia-500/30 md:block"
          />

          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.55, delay: index * 0.12, ease: "easeOut" }}
              className="relative"
            >
              <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-md shadow-zinc-900/[0.04] dark:border-zinc-700 dark:bg-zinc-900">
                <step.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">
                Step {index + 1}
              </p>
              <h3 className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}