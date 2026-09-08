"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UserButton } from "@clerk/nextjs";
import { GraduationCap, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardNav, siteConfig } from "@/lib/constants";

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2 px-5 py-5"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25">
          <GraduationCap className="h-4.5 w-4.5" />
        </span>
        <span className="text-lg font-semibold tracking-tight text-zinc-900">
          {siteConfig.name}
        </span>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {dashboardNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              <item.icon
                className={cn(
                  "h-4.5 w-4.5 shrink-0 transition-colors",
                  active
                    ? "text-indigo-600"
                    : "text-zinc-400 group-hover:text-zinc-600"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <UserButton />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">
              My account
            </p>
            <p className="truncate text-xs text-zinc-500">Signed in via Clerk</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const current = dashboardNav.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-zinc-200/70 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl lg:hidden"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-zinc-200/70 bg-white/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold tracking-tight text-zinc-900">
            {current?.label ?? "Dashboard"}
          </h1>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}