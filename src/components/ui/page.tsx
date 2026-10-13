import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Uppercase micro label over a value. */
export function Meta({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div className="mt-1 text-[14px] text-ink">{children}</div>
    </div>
  );
}

/** Segmented filter bar with counts. */
export function Segments({ items, className }: { items: { href: string; label: string; count?: number; active: boolean; tone?: "ok" | "warn" | "critical" | "neutral" }[]; className?: string }) {
  const dot = { ok: "bg-ok", warn: "bg-warn", critical: "bg-critical", neutral: "border-[1.5px] border-ink-3" };
  return (
    <div className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] border border-line bg-surface-2 p-0.5", className)}>
      {items.map((it) => (
        <a key={it.href} href={it.href} className={cn("inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-[13px] font-medium transition-colors", it.active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(22_22_22/0.08)] border border-line" : "text-ink-2 hover:text-ink")}>
          {it.tone && <span className={cn("h-1.5 w-1.5 rounded-full", dot[it.tone])} />}
          {it.label}
          {typeof it.count === "number" && <span className="text-[12px] text-ink-3 tnum">{it.count}</span>}
        </a>
      ))}
    </div>
  );
}
