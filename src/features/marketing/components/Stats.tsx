"use client";

import { motion, type Variants } from "motion/react";

const STATS = [
  { value: "15", label: "Study features" },
  { value: "3", label: "Languages" },
  { value: "100%", label: "Hands-free" },
];

const ease = [0.25, 0.1, 0.25, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease } },
};

export function Stats() {
  return (
    <section className="bg-bg py-16 md:py-24">
      <div className="mx-auto max-w-[1200px] px-6 md:px-10 lg:px-16">
        <div className="grid grid-cols-1 gap-10 border-y border-stroke py-14 sm:grid-cols-3">
          {STATS.map((stat, index) => (
            <motion.div
              key={stat.label}
              variants={reveal}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: index * 0.1 }}
              className="text-center"
            >
              <p className="font-display text-6xl italic text-text-primary md:text-7xl">
                {stat.value}
              </p>
              <p className="mt-3 text-xs uppercase tracking-[0.3em] text-muted">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
