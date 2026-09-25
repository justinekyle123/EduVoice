"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import gsap from "gsap";
import { Languages as LanguagesIcon, X, type LucideIcon } from "lucide-react";
import { features, languages } from "@/lib/constants";
import { explorePhotos } from "@/features/marketing/lib/images";

type ExploreItem = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
};

const CAPABILITY_TITLES = [
  "Smart Flashcards",
  "Collaborative Study Rooms",
  "Progress Visualization",
];

const ITEMS: ExploreItem[] = [
  ...languages.map((language) => ({
    title: language.name,
    subtitle: language.sample,
    icon: LanguagesIcon,
  })),
  ...CAPABILITY_TITLES.map((title) => {
    const feature = features.find((item) => item.title === title)!;
    return {
      title: feature.title,
      subtitle: feature.description,
      icon: feature.icon,
    };
  }),
];

const ROTATIONS = [-4, 3, -2, 4, -3, 2];

export function Languages() {
  const sectionRef = useRef<HTMLElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const colARef = useRef<HTMLDivElement>(null);
  const colBRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<ExploreItem | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const pinned = pinnedRef.current;
    const colA = colARef.current;
    const colB = colBRef.current;
    if (!section || !pinned || !colA || !colB) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx: gsap.Context | undefined;
    let cancelled = false;
    let onIntroDone: (() => void) | undefined;

    (async () => {
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      // The intro overlay locks body scroll; re-measure once it releases.
      onIntroDone = () => ScrollTrigger.refresh();
      window.addEventListener("eduvoice:intro-done", onIntroDone);

      ctx = gsap.context(() => {
        ScrollTrigger.create({
          trigger: section,
          start: "top top",
          end: "bottom bottom",
          pin: pinned,
          pinSpacing: false,
        });

        gsap.to(colA, {
          yPercent: -18,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        });

        gsap.fromTo(
          colB,
          { yPercent: 12 },
          {
            yPercent: -30,
            ease: "none",
            scrollTrigger: {
              trigger: section,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
            },
          }
        );
      }, section);
    })();

    return () => {
      cancelled = true;
      if (onIntroDone) {
        window.removeEventListener("eduvoice:intro-done", onIntroDone);
      }
      ctx?.revert();
    };
  }, []);

  return (
    <section
      id="languages"
      ref={sectionRef}
      className="relative min-h-[300vh] scroll-mt-20 bg-bg"
    >
      <div
        ref={pinnedRef}
        className="relative z-10 flex h-screen flex-col items-center justify-center px-6 text-center"
      >
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-stroke" aria-hidden />
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Speak your language
          </p>
          <span className="h-px w-8 bg-stroke" aria-hidden />
        </div>
        <h2 className="mt-6 font-display text-5xl italic tracking-tight text-text-primary md:text-7xl">
          Visual playground
        </h2>
        <p className="mt-5 max-w-md text-sm text-muted md:text-base">
          Ask in English, Filipino, or Cebuano and EduVoice answers back in the
          same language — with tools that make every session stick.
        </p>
        <button
          type="button"
          onClick={() => setActiveItem(ITEMS[0])}
          className="group relative mt-8 inline-flex rounded-full p-[2px] transition-transform duration-200 hover:scale-105"
        >
          <span
            className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden
          />
          <span className="relative inline-flex items-center gap-2 rounded-full border border-stroke bg-surface px-6 py-3 text-sm text-text-primary">
            Take a look around
          </span>
        </button>
      </div>

      <div className="absolute inset-0 z-20">
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-12 px-6 md:gap-40 md:px-10">
          <div ref={colARef} className="flex flex-col gap-12 pt-[20vh] md:gap-40">
            {ITEMS.slice(0, 3).map((item, index) => (
              <ExploreCard
                key={item.title}
                item={item}
                rotation={ROTATIONS[index]}
                onOpen={() => setActiveItem(item)}
              />
            ))}
          </div>
          <div ref={colBRef} className="flex flex-col gap-12 pt-[55vh] md:gap-40">
            {ITEMS.slice(3).map((item, index) => (
              <ExploreCard
                key={item.title}
                item={item}
                rotation={ROTATIONS[index + 3]}
                onOpen={() => setActiveItem(item)}
              />
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {activeItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActiveItem(null)}
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-bg/80 p-6 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="relative w-full max-w-lg rounded-3xl border border-stroke bg-surface p-8 text-left"
            >
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActiveItem(null)}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-stroke text-muted transition-colors hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
              <span className="relative block aspect-video overflow-hidden rounded-2xl border border-stroke">
                <Image
                  src={explorePhotos[activeItem.title as keyof typeof explorePhotos]}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 512px, 100vw"
                  className="object-cover"
                />
              </span>
              <span className="mt-5 grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-bg/60">
                <activeItem.icon className="h-5 w-5 text-brand-300" />
              </span>
              <h3 className="mt-5 text-2xl text-text-primary">
                {activeItem.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted">
                {activeItem.subtitle}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ExploreCard({
  item,
  rotation,
  onOpen,
}: {
  item: ExploreItem;
  rotation: number;
  onOpen: () => void;
}) {
  return (
    <div className="flex justify-center" style={{ transform: `rotate(${rotation}deg)` }}>
      <button
        type="button"
        onClick={onOpen}
        className="group relative aspect-square w-full max-w-[320px] overflow-hidden rounded-3xl border border-stroke bg-surface text-left transition-transform duration-300 hover:scale-105"
      >
        <Image
          src={explorePhotos[item.title as keyof typeof explorePhotos]}
          alt=""
          fill
          sizes="320px"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-bg/10"
        />
        <span className="relative flex h-full flex-col justify-between p-6">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-bg/60 backdrop-blur-sm">
            <item.icon className="h-5 w-5 text-brand-300" />
          </span>
          <span className="block">
            <span className="block text-lg text-text-primary">
              {item.title}
            </span>
            <span className="mt-2 line-clamp-3 block text-xs leading-5 text-muted">
              {item.subtitle}
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-xs text-muted">
              View <span aria-hidden>↗</span>
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}
