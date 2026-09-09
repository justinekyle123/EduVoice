import { GraduationCap } from "lucide-react";
import { navLinks, siteConfig } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
        <div>
          <a href="#top" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
              <GraduationCap className="h-4.5 w-4.5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {siteConfig.name}
            </span>
          </a>
          <p className="mt-4 max-w-xs text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {siteConfig.tagline}. Built for students who learn best out loud —
            in English, Filipino, or Cebuano.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Product</h3>
          <ul className="mt-4 space-y-2.5">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#cta"
                className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Get started
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Languages</h3>
          <p className="mt-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            English · Filipino (Tagalog) · Cebuano (Bisaya)
          </p>
        </div>
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 EduVoice. All rights reserved.</p>
          <p>Made for learners in Polomolok, South Cotabato 🌱</p>
        </div>
      </div>
    </footer>
  );
}