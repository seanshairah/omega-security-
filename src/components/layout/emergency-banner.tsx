import Link from "next/link";
import { SirenIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { fmtTime } from "@/lib/time";

export async function EmergencyBanner() {
  const open = await db.incident.findMany({ where: { category: "EMERGENCY", status: { in: ["OPEN", "ACKNOWLEDGED"] } }, include: { guard: true, location: true }, orderBy: { occurredAt: "desc" }, take: 3 });
  if (open.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {open.map((i) => (
        <Link key={i.id} href={`/incidents/${i.id}`} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-critical bg-critical px-4 py-3 text-white hover:bg-[#d93a21]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20"><SirenIcon size={18} weight="fill" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold uppercase tracking-[0.02em]">Emergency alert received from {i.guard.firstName} {i.guard.lastName} — {i.location.name} — {fmtTime(i.occurredAt)}</p>
            <p className="truncate text-[13px] text-white/85">{i.status === "OPEN" ? "Not yet acknowledged." : "Acknowledged, awaiting resolution."} Call {i.guard.phone}. {i.incidentNo}</p>
          </div>
          <CaretRightIcon size={16} weight="bold" />
        </Link>
      ))}
    </div>
  );
}
