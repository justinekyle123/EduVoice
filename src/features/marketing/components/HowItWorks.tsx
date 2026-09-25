"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, type Variants } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { steps } from "@/lib/constants";
import { stepPhotos } from "@/features/marketing/lib/images";

const ease = [0.25, 0.1, 0.25, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease } },
};

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-bg py-16 md:py-24"
    >
      <div className="mx-auto max-w-[1200px] px-6 md:px-10 lg:px-16">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-stroke" aria-hidden />
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                How it works
              </p>
            </div>
            <h2 className="mt-5 text-4xl tracking-tight text-text-primary md:text-5xl">
              From question to{" "}
              <span className="font-display italic">mastery</span>
            </h2>
            <p className="mt-4 max-w-md text-sm text-muted md:text-base">
              Four simple steps — ask, upload, practice, and watch your progress
              grow.
            </p>
          </div>
          <Link
            href="/sign-up"
            className="group relative hidden shrink-0 rounded-full p-[2px] md:inline-flex"
          >
            <span
              className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden
            />
            <span className="relative inline-flex items-center gap-2 rounded-full border border-stroke bg-surface px-5 py-2.5 text-sm text-text-primary">
              Start free <ArrowUpRight className="h-4 w-4" />
            </span>
          </Link>
        </motion.div>

        <div className="mt-10 flex flex-col gap-4">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              variants={reveal}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: index * 0.08 }}
            >
              <Link
                href="/sign-up"
                className="group flex items-center gap-5 rounded-[40px] border border-stroke bg-surface/30 p-4 transition-colors duration-300 hover:bg-surface sm:gap-6 sm:rounded-full sm:p-5"
              >
                <span className="relative h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                  <span className="absolute inset-0 overflow-hidden rounded-full border border-white/10">
                    <Image
                      src={stepPhotos[index]}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </span>
                  <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border border-stroke bg-bg">
                    <step.icon className="h-3.5 w-3.5 text-brand-300" />
                  </span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    Step {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 truncate text-lg text-text-primary sm:text-xl">
                    {step.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {step.description}
                  </p>
                </div>

                <span className="hidden shrink-0 items-center gap-4 pr-2 md:flex">
                  <span className="rounded-full border border-stroke px-4 py-1.5 text-xs text-muted">
                    {["2 min", "1 min", "3 min", "Ongoing"][index]}
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-stroke text-muted transition-colors duration-300 group-hover:border-transparent group-hover:bg-text-primary group-hover:text-bg">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
