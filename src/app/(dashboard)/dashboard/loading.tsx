// Loading UI for the dashboard branch (Next's `loading.tsx` → the Suspense
// boundary wrapped around every page below /dashboard).
//
// Every dashboard route is dynamic: each page checks the session on the server
// before it renders. Without this file the router has no fallback to show while
// that round trip runs, so the *old* screen simply sits there until the new one
// is ready — which is what makes moving between pages by voice feel stalled.
// With it, a navigation paints this immediately and the page streams in behind.
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="space-y-3">
        <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800/70" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800" />
            <div className="mt-4 h-4 w-32 animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800" />
            <div className="mt-2 h-3 w-40 max-w-full animate-pulse rounded bg-zinc-200/50 dark:bg-zinc-800/70" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-4 w-40 animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="h-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
