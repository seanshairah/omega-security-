/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/cn";

/** Standard illustrated avatar for anyone without a photo, deterministic per name. */
export function standardAvatar(name: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}&skinColor=ae5d29,614335,d08b5b&backgroundColor=e8ebfa,e4f4ee,fcf1d9&backgroundType=solid&accessoriesProbability=10&facialHairProbability=30`;
}

export function Avatar({ src, name, size = 32, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  return <img src={src || standardAvatar(name)} alt={name} width={size} height={size} loading="lazy" className={cn("shrink-0 rounded-full bg-[#e9e8e6] object-cover", className)} style={{ width: size, height: size }} />;
}
