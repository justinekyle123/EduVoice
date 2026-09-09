import { Sparkles } from "lucide-react";
import { dashboardNav } from "@/lib/constants";

export function ComingSoon({ section }: { section: string }) {
  const item = dashboardNav.find(
    (nav) => nav.href === `/dashboard/${section}`
  );

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-20 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 ring-1 ring-indigo-100 dark:from-indigo-500/10 dark:to-fuchsia-500/10 dark:ring-indigo-500/30">
        {item ? (
          <item.icon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        ) : (
          <Sparkles className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        )}
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {item?.label ?? section}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {item?.description ??
          "This part of EduVoice is under construction."}
      </p>
      <span className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30">
        <Sparkles className="h-3.5 w-3.5" />
        Coming soon
      </span>
    </div>
  );
}