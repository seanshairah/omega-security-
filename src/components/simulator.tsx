"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { simulateInbound, runTickNow } from "@/actions/sms";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button, ButtonGroup } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";

type Shift = { id: string; guardId: string; guardName: string; phone: string; location: string; start: string; end: string; status: string; pending: string; messages: { id: string; direction: string; body: string; at: string; status: string }[] };

const QUICK = [
  { label: "YES", body: "YES" }, { label: "NO", body: "NO" }, { label: "1 · Going well", body: "1" }, { label: "2 · Need assistance", body: "2" }, { label: "3 · Incident", body: "3" },
  { label: "INCIDENT", body: "INCIDENT" }, { label: "EMERGENCY", body: "EMERGENCY", critical: true },
];

export function Simulator({ shifts }: { shifts: Shift[] }) {
  const [sel, setSel] = useState(shifts[0]?.id ?? "");
  const [text, setText] = useState("");
  const [log, setLog] = useState<{ at: string; line: string; tone?: "ok" | "critical" }[]>([]);
  const [busy, start] = useTransition();
  const router = useRouter();
  const shift = shifts.find((s) => s.id === sel);
  const stamp = () => new Date().toTimeString().slice(0, 8);

  const reply = (body: string) => { if (!shift) return; start(async () => { const r = await simulateInbound({ guardId: shift.guardId, body }); setLog((l) => [{ at: stamp(), line: r.ok ? `${shift.guardName} → "${body}" · read as ${r.result.interpreted} · ${r.result.action}` : r.error, tone: r.ok ? "ok" : "critical" }, ...l]); setText(""); router.refresh(); }); };
  const tick = (offset: number) => start(async () => { const r = await runTickNow(offset); if (!r.ok) { setLog((l) => [{ at: stamp(), line: r.error, tone: "critical" }, ...l]); return; } const rep = r.report; const parts = [["arrival checks", rep.arrivalSent], ["reminders", rep.remindersSent], ["escalations", rep.escalated], ["welfare checks", rep.welfareSent], ["missed welfare", rep.welfareMissed], ["handover notices", rep.handoverNotices], ["completion checks", rep.completionSent], ["timeouts", rep.completionTimedOut], ["missed shifts", rep.missed], ["recurring shifts created", rep.recurrencesCreated]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`); setLog((l) => [{ at: stamp(), line: `Engine tick${offset ? ` as if ${offset} min from now` : ""}: ${parts.length ? parts.join(", ") : "nothing due"}${rep.errors.length ? ` · errors: ${rep.errors.join("; ")}` : ""}`, tone: rep.errors.length ? "critical" : "ok" }, ...l]); router.refresh(); });

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Guard's phone" description="Pick a live shift and send what the guard would type." />
          <CardBody>
            <Select value={sel} onChange={(e) => setSel(e.target.value)}>{shifts.map((s) => <option key={s.id} value={s.id}>{s.guardName} · {s.location} · {s.start}–{s.end}</option>)}</Select>
            {shift && (
              <div className="mt-4 max-w-full overflow-hidden rounded-[20px] border-[6px] border-[#2a2a2a] bg-[#f6f6f4] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-1 text-[11px] text-ink-3"><span className="flex items-center gap-1"><Icon name="mobile" size={12} filled /> {shift.phone}</span><span className="truncate">{shift.status} · awaiting {shift.pending === "NONE" ? "nothing" : shift.pending.toLowerCase().replace("_", " ")}</span></div>
                <div className="h-72 space-y-2 overflow-y-auto scroll-thin px-1">
                  {shift.messages.length === 0 && <p className="pt-10 text-center text-[12px] text-ink-3">No messages yet. Run the engine to send the arrival check.</p>}
                  {shift.messages.map((m) => (
                    <div key={m.id} className={m.direction === "INBOUND" ? "flex justify-end" : "flex"}><div className={cn("max-w-[85%] rounded-[14px] px-3 py-2 text-[12.5px] leading-snug", m.direction === "INBOUND" ? "bg-accent text-white" : "bg-white text-ink shadow-[0_1px_1px_rgb(0_0_0/0.06)]")}>{m.body}<div className={cn("mt-1 text-[10px]", m.direction === "INBOUND" ? "text-white/70" : "text-ink-3")}>{m.at}{m.status === "FAILED" ? " · failed to send" : ""}</div></div></div>
                  ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply(text); }} className="mt-2 flex gap-1.5">
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply" className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3.5 text-[13px] focus:border-accent focus:outline-none" />
                  <button disabled={busy || !text.trim()} className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-40">Send</button>
                </form>
                <div className="mt-2 flex flex-wrap gap-1.5">{QUICK.map((q) => <button key={q.label} disabled={busy || !shift} onClick={() => reply(q.body)} className={cn("h-7 rounded-full border px-2.5 text-[12px] font-medium disabled:opacity-50", q.critical ? "border-critical/40 bg-critical-soft text-[#b3301a]" : "border-line bg-white text-ink")}>{q.label}</button>)}</div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Automation engine" description="The engine runs every minute on its own. Run it now, or pretend time has passed to reach the next step." action={
            <ButtonGroup>
              <Button size="sm" disabled={busy} onClick={() => tick(0)}><Icon name="play_arrow" size={13} filled /> Run now</Button>
              <Button size="sm" disabled={busy} onClick={() => tick(20)}><Icon name="fast_forward" size={13} filled /> +20 min</Button>
              <Button size="sm" disabled={busy} onClick={() => tick(60)}><Icon name="fast_forward" size={13} filled /> +1 h</Button>
              <Button size="sm" disabled={busy} onClick={() => tick(360)}><Icon name="fast_forward" size={13} filled /> +6 h</Button>
              <Button size="sm" disabled={busy} onClick={() => tick(720)}><Icon name="fast_forward" size={13} filled /> +12 h</Button>
            </ButtonGroup>
          } />
          <CardBody>
            <p className="text-[12px] text-ink-3">Fast-forwarding evaluates due actions as if the clock had moved; it does not change recorded times.</p>
            <ul className="mt-3 max-h-[480px] space-y-1.5 overflow-y-auto scroll-thin font-mono text-[12px]">
              {log.length === 0 && <li className="text-ink-3">Actions you take appear here.</li>}
              {log.map((l, i) => <li key={i} className={cn("flex gap-3", l.tone === "critical" ? "text-critical" : "text-ink-2")}><span className="shrink-0 text-ink-3">{l.at}</span><span>{l.line}</span></li>)}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
