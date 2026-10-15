"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { simulateGateway } from "@/actions/gateways";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";

type Device = { id: string; deviceName: string; guardName: string; site: { name: string; lat: number | null; lng: number | null; radiusM: number } | null };

/** Drives the real intake with fixes computed from the site: inside, leave, verify, remain, return, unavailable, late sync. */
export function LocationSimulator({ devices }: { devices: Device[] }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [late, setLate] = useState(false);
  const [log, setLog] = useState<{ at: string; line: string; tone?: "ok" | "critical" }[]>([]);
  const [busy, start] = useTransition();
  const router = useRouter();
  const d = devices.find((x) => x.id === deviceId);
  const stamp = () => new Date().toTimeString().slice(0, 8);
  // metres → degrees of latitude (≈ 111 km per degree)
  const offset = (m: number) => m / 111_000;

  const fire = (eventType: "SHIFT_STARTED" | "LOCATION_CHECK" | "LOCATION_EXIT" | "LOCATION_OUTSIDE" | "LOCATION_RETURNED" | "LOCATION_UNAVAILABLE", distanceM: number | null, extra: Record<string, unknown> = {}) => start(async () => {
    if (!d) return;
    const at = late ? new Date(Date.now() - 85 * 60_000).toISOString() : undefined;
    const hasSite = d.site?.lat != null && d.site?.lng != null;
    const fix = distanceM != null && hasSite ? { latitude: d.site!.lat! + offset(distanceM), longitude: d.site!.lng!, accuracyM: 12, locationState: (distanceM <= d.site!.radiusM ? "INSIDE" : "OUTSIDE") as "INSIDE" | "OUTSIDE", distanceM } : {};
    const r = await simulateGateway({ gatewayId: d.id, eventType, at, ...fix, ...extra });
    setLog((l) => [{ at: stamp(), line: r.ok ? `${eventType}${distanceM != null ? ` @ ${distanceM} m` : ""}${late ? " (85 min ago)" : ""} → ${r.ack.status}${r.ack.error ? ` (${r.ack.error})` : ""}` : r.error, tone: r.ok && r.ack.status !== "rejected" ? "ok" : "critical" }, ...l]);
    router.refresh();
  });

  if (devices.length === 0) return <Card><CardHeader title="Guard location simulator" description="No guard phones registered. Register a device in Guard mode and link it to a guard." /><CardBody><Link href="/gateways/new" className="text-[13px] font-medium text-accent-strong hover:underline">Register a guard device →</Link></CardBody></Card>;
  const noCoords = d && !(d.site?.lat != null && d.site?.lng != null);
  return (
    <Card>
      <CardHeader title="Guard location simulator" description="Pretend the guard's phone is reporting. Fixes are computed from the shift's site and go through the same intake as the app, including the exit verification rule." />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Guard device"><Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((x) => <option key={x.id} value={x.id}>{x.guardName} · {x.deviceName}{x.site ? ` · ${x.site.name}` : " · no live shift"}</option>)}</Select></Field>
          <Field label="Upload timing" hint="Late = the phone had no internet; events arrive 85 minutes after they happened."><Select value={late ? "late" : "live"} onChange={(e) => setLate(e.target.value === "late")}><option value="live">Live (internet available)</option><option value="late">Queued, synced late</option></Select></Field>
        </div>
        {d && !d.site && <p className="mt-3 text-[13px] text-warn">This guard has no live shift. Create one first; monitoring is shift-aware.</p>}
        {noCoords && d?.site && <p className="mt-3 text-[13px] text-warn">{d.site.name} has no coordinates. Add latitude and longitude on the site before simulating.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={busy || !d?.site || noCoords} onClick={() => fire("SHIFT_STARTED", 20)}>Guard arrives (inside)</Button>
          <Button size="sm" disabled={busy || !d?.site || noCoords} onClick={() => fire("LOCATION_CHECK", 35)}>Inside check</Button>
          <Button size="sm" disabled={busy || !d?.site || noCoords} onClick={() => fire("LOCATION_EXIT", 420)}>Guard leaves (exit at 420 m)</Button>
          <Button size="sm" disabled={busy || !d?.site || noCoords} onClick={() => fire("LOCATION_OUTSIDE", 480)}>Remains outside (480 m)</Button>
          <Button size="sm" disabled={busy || !d?.site || noCoords} onClick={() => fire("LOCATION_RETURNED", 38, { durationOutsideSeconds: 50 * 60 })}>Guard returns (38 m)</Button>
          <Button size="sm" disabled={busy || !d?.site} onClick={() => fire("LOCATION_UNAVAILABLE", null, { reason: "no_fix", locationState: "UNKNOWN" })}>GPS unavailable</Button>
          <Button size="sm" disabled={busy || !d?.site} onClick={() => fire("LOCATION_UNAVAILABLE", null, { reason: "permission_revoked", locationState: "UNKNOWN" })}>Permission revoked</Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">On the phone an exit is only recorded after a second outside reading; the simulator sends the confirmed result.</p>
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto scroll-thin text-[12.5px]">
          {log.map((l, i) => <li key={i} className={cn("flex gap-2", l.tone === "critical" ? "text-critical" : "text-ink-2")}><span className="shrink-0 tnum text-ink-3">{l.at}</span><span>{l.line}</span></li>)}
        </ul>
      </CardBody>
    </Card>
  );
}
