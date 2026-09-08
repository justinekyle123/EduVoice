import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getUserByClerkId, upsertUser } from "@/features/auth/server/users";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";
  const name = clerkUser?.fullName ?? clerkUser?.username ?? null;

  // Fallback sync: guarantee the user exists locally even before the
  // webhook endpoint is configured in the Clerk dashboard.
  let dbUser = await getUserByClerkId(userId);
  if (!dbUser) {
    dbUser = await upsertUser({ clerkId: userId, email, name });
  }

  const synced = Boolean(dbUser);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/25">
              <GraduationCap className="h-4.5 w-4.5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-zinc-900">
              EduVoice
            </span>
          </Link>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          Welcome{name ? `, ${name.split(" ")[0]}` : ""} 👋
        </h1>
        <p className="mt-2 text-zinc-600">
          Your EduVoice account is connected. This page proves the full chain:
          Clerk authentication → Postgres user sync.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">
              Clerk profile
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">User ID</dt>
                <dd className="max-w-[60%] truncate font-mono text-xs text-zinc-700">
                  {userId}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">Name</dt>
                <dd className="truncate text-zinc-900">{name ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">Email</dt>
                <dd className="max-w-[60%] truncate text-zinc-900">{email}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">
              Postgres sync
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">users table</dt>
                <dd>
                  {synced ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                      ✓ Synced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                      Pending
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">DB row ID</dt>
                <dd className="max-w-[60%] truncate font-mono text-xs text-zinc-700">
                  {dbUser?.id ?? "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">Created</dt>
                <dd className="text-zinc-900">
                  {dbUser?.createdAt
                    ? new Date(dbUser.createdAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </main>
    </div>
  );
}