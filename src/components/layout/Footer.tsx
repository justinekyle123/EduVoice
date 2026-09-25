import { navLinks, siteConfig } from "@/lib/constants";
import { Logo } from "@/components/layout/Logo";

const SOCIALS = [
  { label: "Twitter", href: "https://twitter.com" },
  { label: "LinkedIn", href: "https://linkedin.com" },
  { label: "GitHub", href: "https://github.com" },
];

export function Footer() {
  return (
    <footer className="border-t border-stroke bg-bg">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-14 md:grid-cols-3 md:px-10 lg:px-16">
        <div>
          <a href="#top" className="inline-block">
            <Logo />
          </a>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted">
            {siteConfig.tagline}. Built for students who learn best out loud —
            in English, Filipino, or Cebuano.
          </p>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-[0.3em] text-muted">
            Product
          </h3>
          <ul className="mt-5 space-y-3">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-muted transition-colors hover:text-text-primary"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#cta"
                className="text-sm text-muted transition-colors hover:text-text-primary"
              >
                Get started
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-[0.3em] text-muted">
            Languages
          </h3>
          <p className="mt-5 text-sm leading-6 text-muted">
            English · Filipino (Tagalog) · Cebuano (Bisaya)
          </p>
        </div>
      </div>

      <div className="border-t border-stroke">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between md:px-10 lg:px-16">
          <div className="flex items-center gap-5">
            {SOCIALS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-text-primary"
              >
                {social.label}
              </a>
            ))}
          </div>

          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
            </span>
            Available for projects
          </span>

          <p>© 2026 EduVoice. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
