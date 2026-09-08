"use client";

import { motion } from "motion/react";
import { Mic, Volume2 } from "lucide-react";
import { languages } from "@/lib/constants";

export function Languages() {
  return (
    <section id="languages" className="scroll-mt-20 bg-white py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
            Speak your language
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            No need to switch to English
          </h2>
          <p className="mt-4 text-lg leading-8 text-zinc-600">
            EduVoice detects the language you speak or type and answers back
            in the same one.
          </p>
        </motion.div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {languages.map((language, index) => (
            <motion.div
              key={language.name}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.55, delay: index * 0.1, ease: "easeOut" }}
              whileHover={{ y: -4 }}
              className="group rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-white to-zinc-50 p-6 shadow-sm transition-colors duration-300 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-900/[0.06]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25 transition-transform duration-300 group-hover:scale-110">
                <Volume2 className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">
                {language.name}
              </h3>
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-white px-3.5 py-3 text-sm italic leading-6 text-zinc-600 ring-1 ring-zinc-100">
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>{language.sample}</span>
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                {language.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}