"use client";

// The round indicator both voice experiences put above a question: it says,
// without words, whether the quiz is speaking, listening, thinking, or done, and
// it pulses only while the microphone is actually open.
//
// Shared between the quiz page's voice player and the study room's live quiz so
// the two surfaces are visually the same — a student who learns it in one place
// reads it in the other.

import { motion } from "motion/react";
import { Check, Loader2, Mic, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Every stage either voice surface can be in. */
export type MicStage =
  | "ready"
  | "asking"
  | "listening"
  | "judging"
  | "verdict"
  | "finished";

export function MicOrb({
  stage,
  correct,
}: {
  stage: MicStage;
  correct: boolean | null;
}) {
  const pulsing = stage === "listening";
  const tone =
    stage === "verdict"
      ? correct
        ? "bg-gradient-to-br from-emerald-400 to-emerald-500 text-emerald-950 shadow-emerald-500/30"
        : "bg-gradient-to-br from-red-400 to-red-500 text-red-950 shadow-red-500/30"
      : pulsing || stage === "asking"
        ? "bg-gradient-to-br from-brand-400 to-brand-500 text-brand-950 shadow-brand-500/30"
        : "bg-zinc-100 text-zinc-400 shadow-zinc-900/5 dark:bg-zinc-800 dark:text-zinc-500";

  const icon =
    stage === "listening" ? (
      <Mic className="h-7 w-7" />
    ) : stage === "judging" ? (
      <Loader2 className="h-7 w-7 animate-spin" />
    ) : stage === "verdict" ? (
      correct ? (
        <Check className="h-7 w-7" />
      ) : (
        <X className="h-7 w-7" />
      )
    ) : stage === "finished" ? (
      <Check className="h-7 w-7" />
    ) : (
      <Volume2 className="h-7 w-7" />
    );

  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      {pulsing && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-400/30"
            animate={{ scale: [1, 1.35, 1], opacity: [0.45, 0.05, 0.45] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-400/20"
            animate={{ scale: [1, 1.55, 1], opacity: [0.35, 0, 0.35] }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.4,
            }}
          />
        </>
      )}
      <span
        className={cn(
          "relative flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-colors duration-300",
          tone
        )}
      >
        {icon}
      </span>
    </span>
  );
}
