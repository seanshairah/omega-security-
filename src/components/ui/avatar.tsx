/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/cn";

export function Avatar({ src, name, size = 32, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  if (src) return <img src={src} alt={name} width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  // Fallback: a neutral silhouette, never initials.
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[#e3e2e0] text-ink-3", className)} style={{ width: size, height: size }} aria-label={name}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.5-8 5.5V21h16v-1.5c0-3-3.6-5.5-8-5.5Z" /></svg>
    </span>
  );
}
