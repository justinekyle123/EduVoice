"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { HlsVideo } from "@/features/marketing/components/HlsVideo";
import { siteConfig } from "@/lib/constants";

const ROLES = ["tutor", "study buddy", "quiz maker", "note reader"];

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const [roleIndex, setRoleIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setRoleIndex((i) => (i + 1) % ROLES.length),
      2000
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from(".hero-name", { opacity: 0, y: 50, duration: 1.2, delay: 0.1 })
        .from(
          ".hero-blur",
          {
            opacity: 0,
            y: 20,
            filter: "blur(10px)",
            duration: 1,
            stagger: 0.1,
          },
          "<"
        );
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="top"
      ref={root}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg"
    >
      <HlsVideo />
      <div aria-hidden className="absolute inset-0 bg-black/20" />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-bg to-transparent"
      />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-5 pb-24 pt-32 text-center">
        <p className="hero-blur mb-8 text-xs uppercase tracking-[0.3em] text-muted">
          Study out loud
        </p>

        <h1 className="hero-name mb-6 font-display text-6xl italic leading-[0.9] tracking-tight text-text-primary md:text-8xl lg:text-9xl">
          Learn out loud.
        </h1>

        <p className="hero-blur mb-6 text-lg text-text-primary/90 sm:text-xl">
          Your AI{" "}
          <span
            key={roleIndex}
            className="animate-role-fade-in inline-block font-display italic text-text-primary"
          >
            {ROLES[roleIndex]}
          </span>
          , always ready.
        </p>

        <p className="hero-blur mb-12 max-w-md text-sm text-muted md:text-base">
          {siteConfig.description}
        </p>

        <div className="hero-blur inline-flex flex-col items-center gap-4 sm:flex-row">
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
            href="#how-it-works"
            className="group relative inline-flex rounded-full p-[2px] transition-transform duration-200 hover:scale-105"
          >
            <span
              className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden
            />
            <span className="relative inline-flex items-center rounded-full border-2 border-stroke bg-bg px-7 py-3.5 text-sm text-text-primary transition-colors duration-300 group-hover:border-transparent">
              See how it works
            </span>
          </a>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
        <span className="text-xs uppercase tracking-[0.2em] text-muted">
          Scroll
        </span>
        <span className="relative block h-10 w-px overflow-hidden bg-stroke">
          <span className="accent-gradient absolute inset-x-0 h-full animate-scroll-down" />
        </span>
      </div>
    </section>
  );
}
