import { Sparkles } from "lucide-react";
import { dashboardNav } from "@/lib/constants";

export function ComingSoon({ section }: { section: string }) {
  const item = dashboardNav.find(
    (nav) => nav.href === `/dashboard/${section}`
  );

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-20 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 ring-1 ring-indigo-100">
        {item ? (
          <item.icon className="h-6 w-6 text-indigo-600" />
        ) : (
          <Sparkles className="h-6 w-6 text-indigo-600" />
        )}
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900">
        {item?.label ?? section}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">
        {item?.description ??
          "This part of EduVoice is under construction."}
      </p>
      <span className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
        <Sparkles className="h-3.5 w-3.5" />
        Coming soon
      </span>
    </div>
  );
}