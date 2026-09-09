"use client";

import { motion } from "motion/react";
import { features } from "@/lib/constants";

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-white py-24 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Everything in one app
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-4xl">
            15 ways to study smarter
          </h2>
          <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            No more switching between a chat app, a quiz app, and a document
            reader. EduVoice brings chat, voice, quizzes, and documents
            together — and tracks it all.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="group relative mt-16"
        >
          {/* single-row marquee; pauses while hovered */}
          <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
              {[0, 1].map((copy) => (
                <div
                  key={copy}
                  aria-hidden={copy === 1}
                  className="flex gap-5 pr-5"
                >
                  {features.map((feature) => (
                    <div
                      key={feature.title}
                      className="group/card w-72 shrink-0 rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-900/[0.06] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500/40 dark:hover:shadow-black/40 sm:w-80"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 ring-1 ring-indigo-100 transition-transform duration-300 group-hover/card:scale-110 dark:from-indigo-500/10 dark:to-fuchsia-500/10 dark:ring-indigo-500/30">
                        <feature.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                        {feature.description}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}