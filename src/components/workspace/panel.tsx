import { cn } from "@/lib/cn";

/**
 * Fixed-height workspace primitives. The page owns one scrolling hierarchy:
 *   Workspace (fills the viewport below the top bar on xl screens) → Panel (header stays, body scrolls when `scroll`).
 * Every flex child that may scroll carries min-h-0, or the browser lets it grow past its parent.
 */
export function Workspace({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-col gap-3 xl:h-[calc(100dvh-6.75rem)]", className)}>{children}</div>;
}

export function Panel({ title, subtitle, action, children, className, bodyClassName, scroll = false, tone }: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; scroll?: boolean; tone?: "critical" | "warn" }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-[var(--radius-card)] border bg-surface", tone === "critical" ? "border-critical/50" : tone === "warn" ? "border-warn/50" : "border-line", className)}>
      {(title || action) && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2">
          <div className="min-w-0"><h2 className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>{subtitle && <p className="truncate text-[12px] text-ink-3">{subtitle}</p>}</div>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={cn("min-h-0 min-w-0 flex-1", scroll && "overflow-y-auto scroll-thin", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A compact label/value cell. `strong` for the one number people read first. */
export function Fact({ label, children, className, strong }: { label: string; children: React.ReactNode; className?: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className={cn("mt-0.5 break-words text-[13px] text-ink", strong && "text-[15px] font-semibold tnum")}>{children}</div>
    </div>
  );
}

/** A row of small metrics with hairline separators; wraps on narrow screens. */
export function MetricStrip({ items, className }: { items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "warn" | "critical" | "neutral" }[]; className?: string }) {
  const colour = { ok: "text-ok", warn: "text-warn", critical: "text-critical", neutral: "text-ink" };
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:flex lg:flex-wrap lg:divide-x lg:divide-line", className)}>
      {items.map((m) => (
        <div key={m.label} className="min-w-0 lg:px-4 lg:first:pl-0 lg:last:pr-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{m.label}</div>
          <div className={cn("text-[18px] font-semibold leading-tight tnum", colour[m.tone ?? "neutral"])}>{m.value}</div>
          {m.sub && <div className="text-[11.5px] text-ink-3">{m.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, className }: { title: string; body?: string; className?: string }) {
  return <div className={cn("flex flex-col items-center justify-center px-4 py-8 text-center", className)}><p className="text-[13px] font-medium text-ink">{title}</p>{body && <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">{body}</p>}</div>;
}

export function Skeleton({ className }: { className?: string }) { return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />; }
