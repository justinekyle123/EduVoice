import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  ListTodo,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";
  const name = clerkUser?.fullName ?? clerkUser?.username ?? null;

  // Fallback sync (in case the Clerk webhook isn't configured yet).
  let dbUser = await getUserByClerkId(userId);
  if (!dbUser) {
    dbUser = await upsertUser({ clerkId: userId, email, name });
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const quickActions = [
    {
      href: "/dashboard/chat",
      label: "Start a chat",
      description: "Ask anything by voice or text",
      icon: MessageSquare,
      accent: "from-indigo-500 to-violet-500",
    },
    {
      href: "/dashboard/documents",
      label: "Upload a document",
      description: "PDFs, Word files, lecture notes",
      icon: FileText,
      accent: "from-sky-500 to-cyan-500",
    },
    {
      href: "/dashboard/quiz",
      label: "Generate a quiz",
      description: "Instant questions from your notes",
      icon: ClipboardList,
      accent: "from-fuchsia-500 to-pink-500",
    },
    {
      href: "/dashboard/tasks",
      label: "Add a task",
      description: "Capture study to-dos hands-free",
      icon: ListTodo,
      accent: "from-emerald-500 to-teal-500",
    },
  ];

  const stats = [
    { label: "Study sessions", value: "0", hint: "No sessions yet" },
    { label: "Quizzes taken", value: "0", hint: "No quizzes yet" },
    { label: "Avg. score", value: "—", hint: "Takes a quiz to begin" },
    { label: "Tasks pending", value: "0", hint: "No tasks yet" },
  ];

  const checklist = [
    { label: "Create your account", done: true },
    { label: "Set up your profile", done: true },
    {
      label: "Start your first chat",
      done: false,
      href: "/dashboard/chat",
    },
    {
      label: "Upload a study document",
      done: false,
      href: "/dashboard/documents",
    },
    {
      label: "Take your first quiz",
      done: false,
      href: "/dashboard/quiz",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <p className="text-sm font-medium text-zinc-500">{today}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
          Welcome back{name ? `, ${name.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600 sm:text-base">
          Ready to study out loud? Your AI tutor is here to chat, quiz you, and
          help you track your progress.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-900/[0.06]"
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${action.accent} text-white shadow-md`}
            >
              <action.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-900">
              {action.label}
              <ArrowRight className="h-3.5 w-3.5 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-indigo-500" />
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {action.description}
            </p>
          </Link>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm"
          >
            <p className="text-3xl font-semibold tracking-tight text-zinc-900">
              {stat.value}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-700">
              {stat.label}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Account & sync */}
        <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-base font-semibold text-zinc-900">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Email</dt>
              <dd className="max-w-[60%] truncate text-zinc-900">{email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">Name</dt>
              <dd className="truncate text-zinc-900">{name ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-zinc-500">DB sync</dt>
              <dd>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3 w-3" />
                  {dbUser ? "Synced" : "Pending"}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-5 rounded-xl bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 ring-1 ring-zinc-100">
            Your profile is stored locally in the{" "}
            <code className="font-mono text-zinc-700">users</code> table and
            synced from Clerk.
          </p>
        </section>

        <div className="space-y-6 lg:col-span-3">
          {/* Getting started */}
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              Getting started
            </h2>
            <ul className="mt-4 space-y-2.5">
              {checklist.map((item) =>
                item.done ? (
                  <li
                    key={item.label}
                    className="flex items-center gap-3 text-sm text-zinc-500"
                  >
                    <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
                    {item.label}
                  </li>
                ) : (
                  <li key={item.label}>
                    <Link
                      href={item.href ?? "#"}
                      className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                    >
                      <span className="h-4.5 w-4.5 shrink-0 rounded-full border-2 border-zinc-300" />
                      {item.label}
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-400" />
                    </Link>
                  </li>
                )
              )}
            </ul>
          </section>

          {/* Recent activity */}
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">
              Recent activity
            </h2>
            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 px-6 py-10 text-center">
              <p className="text-sm font-medium text-zinc-700">
                Nothing here yet
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">
                Your study sessions, quiz results, and tasks will show up here
                as you use EduVoice.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}