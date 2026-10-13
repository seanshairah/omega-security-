import { TrendUpIcon, TrendDownIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";

function Sparkline({ data, tone }: { data: number[]; tone: "ok" | "critical" | "neutral" }) {
  const w = 96, h = 36;
  const max = Math.max(1, ...data), min = Math.min(...data);
  const span = Math.max(1, max - min);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const stroke = tone === "ok" ? "#29a37e" : tone === "critical" ? "#e94127" : "#8f8e8c";
  const id = `sp-${tone}-${data.join("")}`.replace(/[^a-z0-9-]/gi, "");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.18" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function KpiCard({ title, description, value, delta, deltaLabel, deltaGoodWhen = "up", series, tone }: { title: string; description: string; value: number | string; delta?: number; deltaLabel?: string; deltaGoodWhen?: "up" | "down"; series: number[]; tone: "ok" | "critical" | "neutral" }) {
  const good = delta === undefined ? null : delta === 0 ? null : (delta > 0) === (deltaGoodWhen === "up");
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 min-h-[36px] text-[12.5px] leading-snug text-ink-2">{description}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink tnum">{value}</span>
          {delta !== undefined && (
            <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-medium tnum", good === null ? "text-ink-3" : good ? "text-ok" : "text-critical")}>
              {delta > 0 ? <TrendUpIcon size={12} weight="bold" /> : delta < 0 ? <TrendDownIcon size={12} weight="bold" /> : null}
              {Math.abs(delta)}{deltaLabel ?? ""}
            </span>
          )}
        </div>
        <Sparkline data={series} tone={tone} />
      </div>
    </section>
  );
}
