"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { motion, type Variants } from "motion/react";
import gsap from "gsap";
import { HlsVideo } from "@/features/marketing/components/HlsVideo";

const ease = [0.25, 0.1, 0.25, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease } },
};

export function CTA() {
  const marqueeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = marqueeRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.to(el, {
      xPercent: -50,
      duration: 40,
      ease: "none",
      repeat: -1,
    });
    return () => {
      tween.kill();
    };
  }, []);

  return (
    <section
      id="cta"
      className="relative scroll-mt-20 overflow-hidden bg-bg pb-8 pt-16 md:pb-12 md:pt-20"
    >
      <HlsVideo flip />
      <div aria-hidden className="absolute inset-0 bg-black/60" />

      <div className="relative">
        <div className="overflow-hidden border-y border-white/10 py-6">
          <div
            ref={marqueeRef}
            aria-hidden
            className="flex w-max whitespace-nowrap will-change-transform"
          >
            {[0, 1].map((copy) => (
              <div key={copy} className="flex">
                {Array.from({ length: 6 }).map((_, index) => (
                  <span
                    key={index}
                    className="px-6 font-display text-3xl italic text-text-primary/80 md:text-5xl"
                  >
                    Learn out loud •
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="mx-auto max-w-[1200px] px-6 py-16 text-center md:px-10 md:py-20"
        >
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Study out loud
          </p>
          <h2 className="mx-auto mt-5 max-w-2xl text-4xl tracking-tight text-text-primary md:text-6xl">
            Ready to <span className="font-display italic">learn</span> by
            talking?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm text-muted md:text-base">
            Ask questions by voice, get spoken answers, and turn your notes into
            quizzes — in English, Filipino, or Cebuano.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/sign-up"
              className="group relative inline-flex rounded-full p-[2px] transition-transform duration-200 hover:scale-105"
            >
              <span
                className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden
              />
              <span className="relative inline-flex items-center gap-2 rounded-full bg-text-primary px-7 py-3.5 text-sm font-medium text-bg transition-colors duration-300 group-hover:bg-bg group-hover:text-text-primary">
                Get started free
              </span>
            </Link>
            <a
              href="mailto:hello@eduvoice.app"
              className="group relative inline-flex rounded-full p-[2px] transition-transform duration-200 hover:scale-105"
            >
              <span
                className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden
              />
              <span className="relative inline-flex items-center rounded-full border-2 border-stroke bg-bg px-7 py-3.5 text-sm text-text-primary transition-colors duration-300 group-hover:border-transparent">
                hello@eduvoice.app
              </span>
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
