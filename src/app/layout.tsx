import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "EduVoice — Voice Chat Learning Assistant with Quiz System",
  description:
    "EduVoice is your AI learning companion for students — ask questions by voice, get spoken answers, generate quizzes from your notes, and learn hands-free in English, Filipino, or Cebuano.",
};

const themeScript = `(function () {
  var mql = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    document.documentElement.classList.toggle("dark", mql.matches);
  }
  applyTheme();
  mql.addEventListener("change", applyTheme);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${instrumentSerif.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}