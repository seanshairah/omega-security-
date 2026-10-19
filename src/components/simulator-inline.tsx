"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { simulateInbound } from "@/actions/sms";
import { cn } from "@/lib/cn";

const REPLIES: Record<string, { label: string; body: string; tone?: "critical" }[]> = {
  ARRIVAL: [{ label: "YES — arrived", body: "YES" }, { label: "NO — not arrived", body: "NO" }],
  WELFARE: [{ label: "1 — going well", body: "1" }, { label: "2 — need assistance", body: "2" }, { label: "3 — incident", body: "3" }],
  INCIDENT_DESCRIPTION: [{ label: "Describe incident", body: "Two people attempted to enter the warehouse without authorization." }],
  COMPLETION: [{ label: "YES — completed", body: "YES" }, { label: "NO — still on duty", body: "NO" }, { label: "INCIDENT", body: "INCIDENT" }],
  NONE: [{ label: "INCIDENT", body: "INCIDENT" }],
};

export function SimulatorInline({ guardId, guardName, pending }: { guardId: string; guardName: string; pending: string }) {
  const [custom, setCustom] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const send = (body: string) => start(async () => { const r = await simulateInbound({ guardId, body }); setLast(r.ok ? `Read as ${r.result.interpreted}: ${r.result.action}` : r.error); setCustom(""); router.refresh(); });
  const opts = [...(REPLIES[pending] ?? []), { label: "EMERGENCY", body: "EMERGENCY", tone: "critical" as const }];
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3"><Icon name="mobile" size={14} filled /> Demo · reply as {guardName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {opts.map((o) => <button key={o.label} disabled={busy} onClick={() => send(o.body)} className={cn("h-8 rounded-[8px] border px-3 text-[12.5px] font-medium disabled:opacity-50", o.tone === "critical" ? "border-critical/40 bg-critical-soft text-[#b3301a]" : "border-line bg-surface text-ink hover:bg-surface-2")}>{o.label}</button>)}
        <form onSubmit={(e) => { e.preventDefault(); if (custom.trim()) send(custom); }} className="flex gap-1">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Free text reply" className="h-8 w-48 rounded-[8px] border border-line px-2.5 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none" />
          <button disabled={busy || !custom.trim()} className="h-8 rounded-[8px] bg-ink px-3 text-[12.5px] font-medium text-white disabled:opacity-40">Send</button>
        </form>
      </div>
      {last && <p className="mt-2 text-[12.5px] text-ink-2">{last}</p>}
    </div>
  );
}
