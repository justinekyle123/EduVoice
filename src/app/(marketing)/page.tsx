import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { LoadingScreen } from "@/features/marketing/components/LoadingScreen";
import { Hero } from "@/features/marketing/components/Hero";
import { Features } from "@/features/marketing/components/Features";
import { HowItWorks } from "@/features/marketing/components/HowItWorks";
import { Languages } from "@/features/marketing/components/Languages";
import { Stats } from "@/features/marketing/components/Stats";
import { CTA } from "@/features/marketing/components/CTA";

export default function MarketingPage() {
  return (
    <main className="dark flex min-h-full flex-1 flex-col bg-bg font-body text-text-primary">
      <LoadingScreen />
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Languages />
      <Stats />
      <CTA />
      <Footer />
    </main>
  );
}
