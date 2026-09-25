"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const WORDS = ["Listen", "Learn", "Speak"];
const DURATION = 2700;

/** Full-screen intro overlay: a 000→100 counter, rotating words, and a progress bar. */
export function LoadingScreen() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timers.push(setTimeout(() => setCount(100), 0));
      timers.push(setTimeout(() => setVisible(false), 200));
      return () => timers.forEach(clearTimeout);
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / DURATION, 1);
      setCount(Math.round(progress * 100));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        timers.push(setTimeout(() => setVisible(false), 400));
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => setWordIndex((i) => (i + 1) % WORDS.length),
      900
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "";
    // Let scroll-driven effects re-measure now that the scrollbar is back.
    if (!visible) window.dispatchEvent(new Event("eduvoice:intro-done"));
    return () => {
      document.body.style.overflow = "";
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="fixed inset-0 z-[9999] flex flex-col bg-bg p-6 md:p-10"
        >
          <motion.p
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-xs uppercase tracking-[0.3em] text-muted"
          >
            EduVoice
          </motion.p>

          <div className="flex flex-1 items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={wordIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="font-display text-4xl italic text-text-primary/80 md:text-6xl lg:text-7xl"
              >
                {WORDS[wordIndex]}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex flex-col items-end gap-6">
            <p className="font-display text-6xl tabular-nums text-text-primary md:text-8xl lg:text-9xl">
              {String(count).padStart(3, "0")}
            </p>
            <div className="h-[3px] w-full bg-stroke/50">
              <div
                className="accent-gradient h-full origin-left"
                style={{
                  transform: `scaleX(${count / 100})`,
                  boxShadow: "0 0 8px rgba(137, 170, 204, 0.35)",
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
