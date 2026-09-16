"use client";

import { useEffect, useRef, useState } from "react";
import { getSpeechEngine } from "../lib/speechEngine";

/**
 * Microphone level meter.
 *
 * Voice mode needs a *level*, not audio: the orb should swell when the student
 * speaks, the session should notice when they have stopped talking, and a
 * sustained loud voice should be able to interrupt the tutor. All three read
 * `levelRef` (RMS, 0–1) which is refreshed every animation frame.
 *
 * The stream feeds an AnalyserNode on the speech engine's AudioContext and is
 * deliberately *not* connected to the speakers — that would echo.
 *
 * `available === false && error === null` while the permission prompt is still
 * open, which is what the UI shows as "getting your microphone ready".
 */
export function useMicStream(enabled: boolean) {
  const levelRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let raf = 0;
    const engine = getSpeechEngine();
    const ctx = engine.ensureContext();

    async function open() {
      if (!ctx || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setError("This browser can't read microphone levels.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Microphone access is blocked — allow it in your browser settings."
            : "No microphone was found. Check your input device."
        );
        return;
      }

      if (cancelled || !ctx) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      if (ctx.state === "suspended") void ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          sum += samples[i] * samples[i];
        }
        levelRef.current = Math.sqrt(sum / samples.length);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      setError(null);
      setAvailable(true);
    }

    void open();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      analyserRef.current = null;
      levelRef.current = 0;
      try {
        source?.disconnect();
      } catch {
        // The node was never connected.
      }
      stream?.getTracks().forEach((track) => track.stop());
      setAvailable(false);
    };
  }, [enabled]);

  return { levelRef, analyserRef, available, error };
}
