"use client";

import { motion } from "motion/react";
import { ArrowRight, Sparkles } from "lucide-react";

export function CTA() {
  return (
    <section id="cta" className="scroll-mt-20 bg-white px-4 pb-24 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-20 text-center shadow-2xl shadow-indigo-900/20 sm:px-16"
      >
        {/* decorative blobs */}
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-fuchsia-300/20 blur-3xl [animation-delay:1.5s]"
        />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Free for students
          </span>
          <h2 className="mx-auto mt-6 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            Ready to study out loud?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-indigo-100">
            Ask questions by voice, get spoken answers, and turn your notes
            into quizzes — all in the language you feel most comfortable speaking.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#features"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-indigo-700 shadow-lg shadow-indigo-900/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              Explore all 15 features
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center rounded-full border border-white/30 bg-white/10 px-7 text-sm font-medium text-white backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20"
            >
              See how it works
            </a>
          </div>
          <p className="mt-6 text-xs font-medium uppercase tracking-widest text-indigo-200">
            English · Filipino · Cebuano
          </p>
        </div>
      </motion.div>
    </section>
  );
}