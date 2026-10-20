"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { simulateGateway } from "@/actions/gateways";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";

type Gateway = { id: string; deviceName: string; status: string; location: string | null };
type Guard = { id: string; name: string; phone: string };

type EventKey = "CALL_STARTED" | "CALL_ANSWERED" | "CALL_ENDED" | "CALL_MISSED" | "DEVICE_ONLINE" | "DEVICE_OFFLINE";

/** Drives the same intake the Android app uses, one event at a time, so demos need no phone. */
export function CallSimulator({ gateways, guards }: { gateways: Gateway[]; guards: Guard[] }) {
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? "");
  const [phone, setPhone] = useState(guards[0]?.phone ?? "+263771234567");
  const [callId, setCallId] = useState<string | null>(null);
  const [log, setLog] = useState<{ at: string; line: string; tone?: "ok" | "critical" }[]>([]);
  const [busy, start] = useTransition();
  const router = useRouter();
  const stamp = () => new Date().toTimeString().slice(0, 8);

  const fire = (eventType: EventKey, opts: { newCall?: boolean } = {}) => start(async () => {
    const id = opts.newCall || !callId ? undefined : callId;
    const r = await simulateGateway({ gatewayId, eventType, phoneNumber: phone, callId: id, direction: "INCOMING" });
    if (!r.ok) { setLog((l) => [{ at: stamp(), line: r.error, tone: "critical" }, ...l]); return; }
    if (eventType === "CALL_STARTED" || eventType === "CALL_MISSED") setCallId(r.callId);
    if (eventType === "CALL_ENDED" || eventType === "CALL_MISSED") setCallId(null);
    setLog((l) => [{ at: stamp(), line: `${eventType} → ${r.ack.status}${r.ack.error ? ` (${r.ack.error})` : ""}${r.ack.callLogId ? ` · call ${r.callId.slice(0, 12)}…` : ""}`, tone: r.ack.status === "rejected" ? "critical" : "ok" }, ...l]);
    router.refresh();
  });

  if (gateways.length === 0) return <Card><CardHeader title="Call gateway" description="No gateway phones registered yet." /><CardBody><Link href="/gateways/new" className="text-[13px] font-medium text-accent-strong hover:underline">Register a gateway →</Link></CardBody></Card>;

  return (
    <Card>
      <CardHeader title="Call gateway simulator" description="Pretend a number is calling the gateway phone. Events go through the same intake as the real app." />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Gateway"><Select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>{gateways.map((g) => <option key={g.id} value={g.id}>{g.deviceName}{g.location ? ` · ${g.location}` : ""} · {g.status.toLowerCase()}</option>)}</Select></Field>
          <Field label="Caller (guard)"><Select value={guards.find((g) => g.phone === phone)?.id ?? ""} onChange={(e) => { const g = guards.find((x) => x.id === e.target.value); if (g) setPhone(g.phone); }}><option value="">Custom number below</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          <Field label="Phone number" hint="Any format: 0771…, +263 77…, 263 77…"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => fire("CALL_STARTED", { newCall: true })}>Incoming call</Button>
          <Button size="sm" disabled={busy || !callId} onClick={() => fire("CALL_ANSWERED")}>Answer</Button>
          <Button size="sm" disabled={busy || !callId} onClick={() => fire("CALL_ENDED")}>End call</Button>
          <Button size="sm" disabled={busy} onClick={() => fire("CALL_MISSED", { newCall: !callId })}>Missed call</Button>
          <Button size="sm" disabled={busy} onClick={() => { setPhone("+263719000000"); setTimeout(() => fire("CALL_STARTED", { newCall: true }), 0); }}>Unknown caller</Button>
          <span className="mx-1 hidden border-l border-line sm:block" />
          <Button size="sm" disabled={busy} onClick={() => fire("DEVICE_ONLINE")}>Gateway online</Button>
          <Button size="sm" disabled={busy} onClick={() => fire("DEVICE_OFFLINE")}>Gateway offline</Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">{callId ? `A call is in progress (${callId.slice(0, 14)}…). Answer it or end it.` : "Start with Incoming call, then Answer and End, or Missed call."}</p>
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto scroll-thin text-[12.5px]">
          {log.map((l, i) => <li key={i} className={cn("flex gap-2", l.tone === "critical" ? "text-critical" : "text-ink-2")}><span className="shrink-0 tnum text-ink-3">{l.at}</span><span>{l.line}</span></li>)}
        </ul>
      </CardBody>
    </Card>
  );
}
