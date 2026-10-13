import { cn } from "@/lib/cn";

export type Tone = "ok" | "warn" | "critical" | "neutral" | "muted" | "info";

const dot: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  critical: "bg-critical",
  info: "bg-info",
  neutral: "border-[1.5px] border-ink-3 bg-transparent",
  muted: "bg-line-strong",
};
const text: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", critical: "text-critical", info: "text-info", neutral: "text-ink-2", muted: "text-ink-3" };
const pill: Record<Tone, string> = {
  ok: "bg-ok-soft text-[#1e7a5e]",
  warn: "bg-warn-soft text-[#8a5e05]",
  critical: "bg-critical-soft text-[#b3301a]",
  info: "bg-info-soft text-[#3a50ad]",
  neutral: "bg-surface-2 text-ink-2 border border-line",
  muted: "bg-surface-2 text-ink-3",
};

/** Glyph + word. Neutral states get a hollow circle, never a badge. */
export function Status({ tone, children, className, pulse }: { tone: Tone; children: React.ReactNode; className?: string; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", text[tone], className)}>
      <span className="relative inline-flex h-2 w-2">
        {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", dot[tone])} />}
        <span className={cn("relative inline-block h-2 w-2 rounded-full", dot[tone])} />
      </span>
      {children}
    </span>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium", pill[tone], className)}>{children}</span>;
}

/** Counter badge: grey by default, red when urgent. */
export function Count({ value, urgent, className }: { value: number; urgent?: boolean; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tnum", urgent ? "bg-critical text-white" : "bg-[#e9e8e6] text-ink-2", className)}>
      {value > 99 ? "99+" : value}
    </span>
  );
}
