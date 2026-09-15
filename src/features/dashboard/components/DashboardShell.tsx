"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowLeft,
  Menu,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardNav } from "@/lib/constants";
import { Logo } from "@/components/layout/Logo";
import {
  deleteChatSession,
  getChatSessions,
} from "@/features/chat/server/actions";

type ChatSessionPreview = Awaited<ReturnType<typeof getChatSessions>>[number];

/** Chat-specific sidebar: back to dashboard, new chat, and the session history. */
function ChatSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSessionPreview[]>([]);

  // Refetch whenever the route changes so new chats show up in the history.
  useEffect(() => {
    let cancelled = false;
    getChatSessions()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch(() => {
        // Best-effort — the chat page surfaces DB errors already.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const activeId = pathname.startsWith("/dashboard/chat/")
    ? pathname.slice("/dashboard/chat/".length)
    : null;

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this chat?")) return;
    await deleteChatSession(id);
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (id === activeId) {
      router.replace(
        remaining.length > 0
          ? `/dashboard/chat/${remaining[0].id}`
          : "/dashboard/chat"
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mb-1 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <Link
        href="/dashboard/chat"
        onClick={onNavigate}
        className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 px-4 py-2.5 text-sm font-semibold text-brand-950 shadow-md shadow-brand-500/25 transition-all duration-200 hover:shadow-lg hover:brightness-105"
      >
        <Plus className="h-4 w-4" />
        New chat
      </Link>

      <p className="mb-1.5 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        <MessageSquare className="h-3.5 w-3.5" />
        Chat history
      </p>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-4">
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-brand-50 dark:bg-brand-500/10"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <Link
                href={`/dashboard/chat/${s.id}`}
                onClick={onNavigate}
                className="min-w-0 flex-1"
              >
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    active
                      ? "text-brand-800 dark:text-brand-300"
                      : "text-zinc-800 dark:text-zinc-100"
                  )}
                >
                  {s.title ?? "Untitled chat"}
                </p>
                {s.preview && (
                  <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {s.preview}
                  </p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                aria-label={`Delete ${s.title ?? "chat"}`}
                className="shrink-0 rounded-lg p-1.5 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-5 text-zinc-400 dark:text-zinc-500">
            No chats yet. Start a new conversation!
          </p>
        )}
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isChat = pathname.startsWith("/dashboard/chat");

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="px-5 py-5">
        <Logo />
      </Link>

      {isChat ? (
        <ChatSidebarNav onNavigate={onNavigate} />
      ) : (
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
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4.5 w-4.5 shrink-0 transition-colors",
                    active
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <UserButton />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              My account
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">Signed in via Clerk</p>
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
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-zinc-200/70 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:block">
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
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl dark:bg-zinc-900 lg:hidden"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-zinc-200/70 bg-white/80 px-4 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/80 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {current?.label ?? "Dashboard"}
          </h1>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>

        <main
          className={cn(
            "mx-auto w-full flex-1 px-4 sm:px-6",
            pathname.startsWith("/dashboard/chat")
              ? "py-2"
              : "max-w-5xl py-8 lg:px-8"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}