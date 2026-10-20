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

/** True for the two ways a caller spells "no value": "—" and <span>—</span>. */
function isBlank(v: React.ReactNode): boolean {
  if (v == null || v === "" || v === "—") return true;
  if (typeof v === "object" && "props" in (v as object)) {
    const kids = (v as { props?: { children?: unknown } }).props?.children;
    return kids === "—";
  }
  return false;
}

export function CardRow({ href, avatar, title, subtitle, right, meta, tone, children }: { href?: string; avatar?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; meta?: { label: string; value: React.ReactNode }[]; tone?: "critical"; children?: React.ReactNode }) {
  // Callers mark "nothing to show" two ways: the bare string "—", and <span>—</span> for the
  // table variant, where a dash is wanted because it holds the column's alignment. On a phone
  // there are no columns, so a labelled cell reading only "—" costs two lines and says nothing.
  // Both shapes are dropped here rather than at each call site.
  const shown = (meta ?? []).filter((m) => !isBlank(m.value));
  const inner = (
    <>
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{title}</div>
          {subtitle && <div className="truncate text-[12.5px] text-ink-2">{subtitle}</div>}
        </div>
        {/* The status may be long ("Assistance required"). Cap it so it cannot squeeze the name,
            and let it shrink rather than press against the card edge. */}
        {right && <div className="flex max-w-[45%] shrink-0 justify-end text-right">{right}</div>}
      </div>
      {shown.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {shown.map((m) => <div key={m.label} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{m.label}</dt><dd className="truncate text-[13px] text-ink tnum">{m.value}</dd></div>)}
        </dl>
      )}
      {children}
    </>
  );
  const cls = cn("block border-b border-line px-4 py-3.5 last:border-b-0", tone === "critical" && "bg-critical-soft/40", href && "active:bg-surface-2");
  return href ? <a href={href} className={cls}>{inner}</a> : <div className={cls}>{inner}</div>;
}
