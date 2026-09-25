"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const HLS_SRC =
  "https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8";

/**
 * Muted, looping HLS background video. Falls back to native HLS playback
 * on browsers without Media Source Extensions (e.g. Safari/iOS).
 */
export function HlsVideo({
  className,
  flip = false,
}: {
  className?: string;
  /** Mirror the video vertically (used for the footer's second instance). */
  flip?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled || !videoRef.current) return;

      if (Hls.isSupported()) {
        const instance = new Hls({ enableWorker: false });
        instance.loadSource(HLS_SRC);
        instance.attachMedia(video);
        hls = instance;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = HLS_SRC;
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, []);

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden>
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        className={cn(
          "absolute left-1/2 top-1/2 min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 object-cover",
          flip && "scale-y-[-1]"
        )}
      />
    </div>
  );
}
