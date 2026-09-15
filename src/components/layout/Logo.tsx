import Image from "next/image";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/constants";

/**
 * The EduVoice mark. The source artwork is a rounded navy tile with a
 * transparent surround, so it needs no background or overflow clipping.
 */
export function LogoMark({
  size = 32,
  className,
  priority = false,
}: {
  /** Rendered size in pixels; also the image's intrinsic dimensions. */
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      // Decorative: the wordmark beside it (or the surrounding copy) carries the name.
      alt=""
      src={siteConfig.logo}
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0", className)}
    />
  );
}

/** Mark + wordmark lockup used by the navbar, footer, and dashboard sidebar. */
export function Logo({
  size = 32,
  className,
  markClassName,
  priority = false,
}: {
  size?: number;
  /** Classes for the mark + wordmark wrapper. */
  className?: string;
  /** Extra classes for the mark itself, e.g. hover effects. */
  markClassName?: string;
  priority?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark size={size} className={markClassName} priority={priority} />
      <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {siteConfig.name}
      </span>
    </span>
  );
}
