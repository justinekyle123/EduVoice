"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Show, UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

const links = [
  { label: "Home", href: "#top", id: "top" },
  { label: "Features", href: "#features", id: "features" },
  { label: "How it works", href: "#how-it-works", id: "how-it-works" },
  { label: "Languages", href: "#languages", id: "languages" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("top");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 100);
      const probe = window.scrollY + 140;
      let current = "top";
      for (const link of links) {
        const el = document.getElementById(link.id);
        if (el && el.offsetTop <= probe) current = link.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 md:pt-6">
      <nav
        className={cn(
          "pointer-events-auto inline-flex items-center rounded-full border border-white/10 bg-surface/90 px-2 py-2 backdrop-blur-md transition-shadow duration-300",
          scrolled && "shadow-md shadow-black/40"
        )}
      >
        <a
          href="#top"
          aria-label="EduVoice home"
          className="group relative mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full"
        >
          <span
            className="accent-gradient absolute inset-0 rounded-full transition-opacity duration-300 group-hover:opacity-0"
            aria-hidden
          />
          <span
            className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              backgroundImage: "linear-gradient(270deg, #89aacc 0%, #4e85bf 100%)",
            }}
            aria-hidden
          />
          <span className="relative grid h-7 w-7 place-items-center rounded-full bg-bg font-display text-[13px] italic text-text-primary">
            EV
          </span>
        </a>

        <span className="mx-1 hidden h-5 w-px bg-stroke sm:block" aria-hidden />

        <div className="hidden items-center sm:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs transition-colors duration-200 sm:px-4 sm:py-2 sm:text-sm",
                active === link.id
                  ? "bg-stroke/50 text-text-primary"
                  : "text-muted hover:bg-stroke/50 hover:text-text-primary"
              )}
            >
              {link.label}
            </a>
          ))}
        </div>

        <span className="mx-1 hidden h-5 w-px bg-stroke sm:block" aria-hidden />

        <div className="hidden items-center sm:flex">
          <Show when="signed-out">
            <Link
              href="/sign-in"
              className="rounded-full px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:bg-stroke/50 hover:text-text-primary sm:px-4 sm:py-2 sm:text-sm"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="group relative ml-1 inline-flex rounded-full p-[2px]"
            >
              <span
                className="accent-gradient absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                aria-hidden
              />
              <span className="relative inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-xs text-text-primary backdrop-blur-md sm:text-sm">
                Get started <span aria-hidden>↗</span>
              </span>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="rounded-full px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:bg-stroke/50 hover:text-text-primary sm:px-4 sm:py-2 sm:text-sm"
            >
              Dashboard
            </Link>
            <span className="ml-1">
              <UserButton />
            </span>
          </Show>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          className="grid h-9 w-9 place-items-center rounded-full text-text-primary transition-colors hover:bg-stroke/50 sm:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="pointer-events-auto absolute left-4 right-4 top-20 rounded-3xl border border-stroke bg-surface/95 p-3 backdrop-blur-md sm:hidden"
          >
            <div className="flex flex-col">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm transition-colors",
                    active === link.id
                      ? "bg-stroke/50 text-text-primary"
                      : "text-muted hover:bg-stroke/50 hover:text-text-primary"
                  )}
                >
                  {link.label}
                </a>
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-2 border-t border-stroke pt-3">
              <Show when="signed-out">
                <Link
                  href="/sign-in"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl px-4 py-3 text-sm text-muted transition-colors hover:bg-stroke/50 hover:text-text-primary"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl bg-text-primary px-4 py-3 text-center text-sm font-medium text-bg"
                >
                  Get started free
                </Link>
              </Show>
              <Show when="signed-in">
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl px-4 py-3 text-sm text-muted transition-colors hover:bg-stroke/50 hover:text-text-primary"
                >
                  Dashboard
                </Link>
              </Show>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
