import { cn } from "@/lib/cn";

/** Omega Security mark: an omega inside a shield. One colour, works at 16px. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-[9px] bg-accent text-white", className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="currentColor">
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm3.6 15h-2.4v-1.4c1.3-.7 2-1.9 2-3.4 0-2-1.4-3.4-3.2-3.4S8.8 10.2 8.8 12.2c0 1.5.7 2.7 2 3.4V17H8.4v-2.1c-1.1-1-1.7-2.3-1.7-3.9 0-3 2.3-5.2 5.3-5.2s5.3 2.2 5.3 5.2c0 1.6-.6 2.9-1.7 3.9V17Z" />
      </svg>
    </span>
  );
}

export const COMPANY = {
  name: "Omega Security",
  portal: "Operations portal",
  tagline: "Guarding and site operations across Zimbabwe",
  city: "Harare, Zimbabwe",
  domain: "omegasecurity.co.zw",
};
