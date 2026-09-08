"use client";

import { motion, type Variants } from "motion/react";
import { features } from "@/lib/constants";

const grid: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07 },
  },
};

const card: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-white py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
            Everything in one app
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            15 ways to study smarter
          </h2>
          <p className="mt-4 text-lg leading-8 text-zinc-600">
            No more switching between a chat app, a quiz app, and a document
            reader. EduVoice brings chat, voice, quizzes, and documents
            together — and tracks it all.
          </p>
        </motion.div>

        <motion.div
          variants={grid}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={card}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="group relative rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm transition-colors duration-300 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-900/[0.06]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 ring-1 ring-indigo-100 transition-transform duration-300 group-hover:scale-110">
                <feature.icon className="h-5 w-5 text-indigo-600" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}