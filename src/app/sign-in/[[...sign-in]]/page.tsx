import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50/80 via-white to-white px-4 py-16 dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}