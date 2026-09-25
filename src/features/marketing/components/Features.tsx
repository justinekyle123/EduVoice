"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, type Variants } from "motion/react";
import { ArrowRight } from "lucide-react";
import { features } from "@/lib/constants";
import { featurePhotos } from "@/features/marketing/lib/images";

const BENTO_TITLES = [
  "Voice-Based Q&A",
  "Document Q&A",
  "Quiz Generation",
  "Filipino & Cebuano Detection",
];

const SPANS = [
  "md:col-span-7",
  "md:col-span-5",
  "md:col-span-5",
  "md:col-span-7",
];

const ease = [0.25, 0.1, 0.25, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease } },
};

export function Features() {
  const bento = BENTO_TITLES.map(
    (title) => features.find((feature) => feature.title === title)!
  );
  const rest = features.filter(
    (feature) => !BENTO_TITLES.includes(feature.title)
  );

  return (
    <section id="features" className="scroll-mt-20 bg-bg py-12 md:py-16">
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
                Selected features
              </p>
            </div>
            <h2 className="mt-5 text-4xl tracking-tight text-text-primary md:text-5xl">
              Built to <span className="font-display italic">teach</span>
            </h2>
            <p className="mt-4 max-w-md text-sm text-muted md:text-base">
              Fifteen tools that turn your notes into spoken answers, quizzes,
              and review material — all in one place.
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
              Get started <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-12 md:gap-6">
          {bento.map((feature, index) => (
            <motion.div
              key={feature.title}
              variants={reveal}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: index * 0.08 }}
              className={`group relative overflow-hidden rounded-3xl border border-stroke bg-surface ${SPANS[index]}`}
            >
              <Image
                src={featurePhotos[feature.title]}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 to-bg/25"
              />
              <div
                aria-hidden
                className="absolute inset-0 opacity-20 mix-blend-multiply"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, #000 1px, transparent 1px)",
                  backgroundSize: "4px 4px",
                }}
              />

              <div className="relative flex aspect-[16/11] flex-col justify-between p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-bg/60">
                  <feature.icon className="h-5 w-5 text-brand-300" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-2 text-xl text-text-primary md:text-2xl">
                    {feature.title}
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                    {feature.description}
                  </p>
                </div>
              </div>

              <div className="absolute inset-0 flex items-center justify-center bg-bg/70 opacity-0 backdrop-blur-lg transition-opacity duration-300 group-hover:opacity-100">
                <span className="relative inline-flex rounded-full p-[2px]">
                  <span className="accent-gradient absolute inset-0 animate-gradient-shift rounded-full bg-[length:200%_200%]" />
                  <span className="relative inline-flex items-center gap-1 rounded-full bg-white px-5 py-2.5 text-sm text-bg">
                    Explore —{" "}
                    <span className="font-display italic">
                      {feature.title}
                    </span>
                  </span>
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* remaining features as an auto-scrolling strip */}
        <div className="group mt-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                aria-hidden={copy === 1}
                className="flex gap-3 pr-3"
              >
                {rest.map((feature) => (
                  <span
                    key={feature.title}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-stroke bg-surface/60 px-4 py-2.5 text-sm text-text-primary/90"
                  >
                    <feature.icon className="h-4 w-4 text-brand-300" />
                    {feature.title}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
