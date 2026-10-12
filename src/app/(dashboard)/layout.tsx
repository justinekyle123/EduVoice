import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/features/dashboard/components/DashboardShell";
import { VoiceNavProvider } from "@/features/voice-nav/context";
import { VoiceNavOverlay } from "@/features/voice-nav/components/VoiceNavOverlay";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Voice Navigation Mode (feature 6.14) wraps the whole dashboard: the provider
  // owns the microphone and command dispatch, the overlay is the console. Every
  // dashboard page is therefore reachable by voice without further wiring.
  return (
    <VoiceNavProvider>
      <DashboardShell>{children}</DashboardShell>
      <VoiceNavOverlay />
    </VoiceNavProvider>
  );
}