"use client";

import { useEffect, useRef } from "react";
import type { VoicePhase } from "../hooks/useVoiceSession";

/**
 * The voice-mode orb.
 *
 * A ring of bars drawn on a canvas, driven by *real* audio: the tutor's voice
 * through the playback AnalyserNode while speaking, and the microphone level
 * while listening. Drawing happens on the animation frame with the levels read
 * from refs, so nothing here re-renders React 60 times a second.
 */
export function VoiceOrb({
  phase,
  micLevel,
  playbackAnalyser,
  size = 300,
  className,
}: {
  phase: VoicePhase;
  /** RMS of the microphone input, refreshed every animation frame. */
  micLevel: { current: number };
  /** Output analyser of the speech engine (null before audio is prepared). */
  playbackAnalyser: AnalyserNode | null;
  /**
   * Fallback box size used before the element is measured. Prefer `className`
   * with width/height classes — the drawing scales to whatever the element is.
   */
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  const analyserRef = useRef(playbackAnalyser);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    analyserRef.current = playbackAnalyser;
  }, [playbackAnalyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = size;
    let height = size;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || size;
      height = rect.height || size;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const BARS = 64;
    let frequencies = new Uint8Array(0);
    let smoothLevel = 0;
    let raf = 0;
    let lastDraw = 0;

    /** Row of the frequency spectrum for a bar, mirrored so the ring is even. */
    const spectrumAt = (t: number, data: Uint8Array) => {
      if (data.length === 0) return 0;
      const mirrored = t < 0.5 ? t * 2 : (1 - t) * 2;
      const index = Math.min(
        data.length - 1,
        Math.floor(mirrored * data.length * 0.55)
      );
      return data[index] / 255;
    };

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      // Reduced motion keeps the orb responsive but redraws it far less often.
      if (reduce && time - lastDraw < 250) return;
      lastDraw = time;

      const current = phaseRef.current;
      const analyzer = analyserRef.current;
      const mic = Math.min(1, Math.max(0, micLevel.current ?? 0) * 7);

      let energy = 0;
      if (current === "speaking" && analyzer) {
        if (frequencies.length !== analyzer.frequencyBinCount) {
          frequencies = new Uint8Array(analyzer.frequencyBinCount);
        }
        analyzer.getByteFrequencyData(frequencies);
        let sum = 0;
        for (let i = 0; i < 24; i += 1) sum += frequencies[i] / 255;
        energy = Math.min(1, sum / 12);
      } else if (current === "listening") {
        energy = mic;
      } else if (current === "thinking") {
        energy = 0.18 + 0.12 * Math.sin(time / 420);
      }

      // Keep the ring calm but alive: fast attack, slow release.
      smoothLevel +=
        (energy - smoothLevel) * (energy > smoothLevel ? 0.35 : 0.08);

      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = Math.min(width, height) * 0.3;
      const spin = reduce ? 0 : time / (current === "thinking" ? 900 : 2600);

      ctx.clearRect(0, 0, width, height);

      // Soft glow behind the ring.
      const glow = ctx.createRadialGradient(
        cx,
        cy,
        baseRadius * 0.1,
        cx,
        cy,
        baseRadius * (1.5 + smoothLevel * 0.5)
      );
      glow.addColorStop(0, `rgba(0, 230, 251, ${0.16 + smoothLevel * 0.22})`);
      glow.addColorStop(0.6, `rgba(6, 182, 212, ${0.06 + smoothLevel * 0.08})`);
      glow.addColorStop(1, "rgba(6, 182, 212, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Inner core.
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 0.62, 0, Math.PI * 2);
      const core = ctx.createLinearGradient(
        cx - baseRadius,
        cy - baseRadius,
        cx + baseRadius,
        cy + baseRadius
      );
      core.addColorStop(0, "rgba(0, 230, 251, 0.92)");
      core.addColorStop(1, "rgba(8, 145, 178, 0.92)");
      ctx.fillStyle = current === "muted" ? "rgba(148, 163, 184, 0.7)" : core;
      ctx.fill();

      // The waveform ring.
      const barWidth = ((2 * Math.PI * baseRadius) / BARS) * 0.45;
      ctx.lineCap = "round";
      for (let i = 0; i < BARS; i += 1) {
        const t = i / BARS;
        const angle = t * Math.PI * 2 - Math.PI / 2 + spin;

        let amplitude: number;
        if (current === "speaking" && analyzer) {
          amplitude = 0.1 + spectrumAt(t, frequencies) * 1.15;
        } else if (current === "listening") {
          // Idle shimmer plus a live bump where the voice is loudest.
          const room = 0.4 + 0.6 * Math.sin(t * Math.PI);
          amplitude = 0.1 + mic * room * (0.6 + 0.4 * Math.sin(time / 500 + i));
        } else if (current === "thinking") {
          amplitude =
            0.22 + 0.1 * Math.sin(time / 300 + t * Math.PI * 4) + smoothLevel;
        } else {
          amplitude = 0.08;
        }
        amplitude = Math.max(0.06, amplitude);

        const inner = baseRadius * 1.02;
        const outer = inner + baseRadius * 0.42 * amplitude;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        ctx.strokeStyle = `rgba(0, 230, 251, ${
          (0.35 + 0.55 * Math.min(1, amplitude)) *
          (current === "muted" ? 0.4 : 1)
        })`;
        ctx.lineWidth = barWidth;
        ctx.beginPath();
        ctx.moveTo(cx + cos * inner, cy + sin * inner);
        ctx.lineTo(cx + cos * outer, cy + sin * outer);
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [micLevel, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "h-[300px] w-[300px]"}
      aria-hidden="true"
    />
  );
}
