import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/features/marketing/components/Hero";
import { Features } from "@/features/marketing/components/Features";
import { HowItWorks } from "@/features/marketing/components/HowItWorks";
import { Languages } from "@/features/marketing/components/Languages";
import { CTA } from "@/features/marketing/components/CTA";

export default function MarketingPage() {
  return (
    <main className="flex min-h-full flex-col bg-white">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Languages />
      <CTA />
      <Footer />
    </main>
  );
}