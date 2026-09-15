import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/components/layout/Logo";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-50/80 via-white to-white px-4 py-16 dark:from-brand-950/40 dark:via-zinc-950 dark:to-zinc-950">
      <Logo size={40} priority />
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}