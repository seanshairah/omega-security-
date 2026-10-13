import { cn } from "@/lib/cn";

/**
 * Responsive record list: a table on wide screens, stacked cards on phones.
 * Pass `table` (the full <Table>) and `cards` (one card per record).
 */
export function Rows({ table, cards, className }: { table: React.ReactNode; cards: React.ReactNode; className?: string }) {
  return (
    <>
      <div className={cn("hidden md:block", className)}>{table}</div>
      <div className="md:hidden">{cards}</div>
    </>
  );
}

export function CardRow({ href, avatar, title, subtitle, right, meta, tone, children }: { href?: string; avatar?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; meta?: { label: string; value: React.ReactNode }[]; tone?: "critical"; children?: React.ReactNode }) {
  const inner = (
    <>
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{title}</div>
          {subtitle && <div className="truncate text-[12.5px] text-ink-2">{subtitle}</div>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {meta.map((m) => <div key={m.label} className="min-w-0"><dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">{m.label}</dt><dd className="truncate text-[13px] text-ink tnum">{m.value}</dd></div>)}
        </dl>
      )}
      {children}
    </>
  );
  const cls = cn("block border-b border-line px-4 py-3.5 last:border-b-0", tone === "critical" && "bg-critical-soft/40", href && "active:bg-surface-2");
  return href ? <a href={href} className={cls}>{inner}</a> : <div className={cls}>{inner}</div>;
}
