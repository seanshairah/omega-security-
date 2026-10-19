import Link from "next/link";
import { subDays, subHours } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { LIVE_STATUSES } from "@/lib/services/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { LinkButton, ButtonGroup } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { fmtDateTime, ago } from "@/lib/time";

export const metadata = { title: "Location exceptions" };

/**
 * Everything GPS verification could not confirm, in one place, each with the reason so that
 * "device offline", "GPS unknown" and "outside the site" are never confused:
 *  - guards outside their site right now (confirmed exit, not yet returned)
 *  - attendance exceptions (SMS said yes, GPS said outside) and arrivals with no usable fix
 *  - verification overdue (online phone, no checks)
 *  - location unavailable spells, with their reasons
 *  - integrity (mock location provider seen)
 */
export default async function LocationExceptionsPage() {
  await requireUser();
  const now = new Date();
  const [liveShifts, exceptions, overdue, unavailable, mocks] = await Promise.all([
    db.shift.findMany({ where: { status: { in: LIVE_STATUSES }, guard: { deviceKind: "ANDROID_GUARD" } }, include: { guard: true, location: true }, orderBy: { startAt: "asc" } }),
    db.attendance.findMany({ where: { locationVerification: { in: ["EXCEPTION", "UNAVAILABLE"] }, shift: { startAt: { gte: subDays(now, 7) } } }, include: { shift: { include: { guard: true, location: true } } }, orderBy: { locationVerifiedAt: "desc" }, take: 100 }),
    db.locationEvent.findMany({ where: { eventType: "LOCATION_VERIFICATION_OVERDUE", occurredAt: { gte: subHours(now, 24) } }, include: { guard: true, location: true, shift: { select: { id: true, status: true } } }, orderBy: { occurredAt: "desc" }, take: 100 }),
    db.locationEvent.findMany({ where: { eventType: "LOCATION_UNAVAILABLE", occurredAt: { gte: subHours(now, 24) } }, include: { guard: true, location: true }, orderBy: { occurredAt: "desc" }, take: 300 }),
    db.gatewayDevice.findMany({ where: { mockLocationSeen: true, status: { not: "REVOKED" } }, include: { guard: true }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  // Guards outside right now: the latest exit/outside/returned event per live shift decides.
  const latestByShift = new Map<string, { eventType: string; occurredAt: Date; distanceM: number | null; accuracyM: number | null; syncStatus: string }>();
  if (liveShifts.length) for (const e of await db.locationEvent.findMany({ where: { shiftId: { in: liveShifts.map((s) => s.id) }, eventType: { in: ["LOCATION_EXIT", "LOCATION_OUTSIDE", "LOCATION_RETURNED", "SHIFT_STARTED", "LOCATION_CHECK"] } }, orderBy: { occurredAt: "desc" }, take: 800 })) if (e.shiftId && !latestByShift.has(e.shiftId)) latestByShift.set(e.shiftId, e);
  const outsideNow = liveShifts.map((s) => ({ s, e: latestByShift.get(s.id) })).filter(({ e }) => e && (e.eventType === "LOCATION_EXIT" || e.eventType === "LOCATION_OUTSIDE"));
  // Unavailable spells: group consecutive unavailable events per shift into one row with the reasons seen.
  const spells = new Map<string, { guard: string; guardId: string; site: string | null; first: Date; last: Date; count: number; reasons: Set<string>; shiftId: string | null }>();
  for (const e of unavailable) {
    const key = e.shiftId ?? `${e.guardId}:${e.occurredAt.toDateString()}`;
    const sp = spells.get(key) ?? { guard: `${e.guard?.firstName ?? "?"} ${e.guard?.lastName ?? ""}`.trim(), guardId: e.guardId ?? "", site: e.location?.name ?? null, first: e.occurredAt, last: e.occurredAt, count: 0, reasons: new Set<string>(), shiftId: e.shiftId };
    sp.count += 1; if (e.occurredAt < sp.first) sp.first = e.occurredAt; if (e.occurredAt > sp.last) sp.last = e.occurredAt; if (e.reason) sp.reasons.add(e.reason.replace(/_/g, " "));
    spells.set(key, sp);
  }

  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title="Location exceptions" description="What GPS verification could not confirm, with the reason each time. A missing or poor fix is not an exit; a phone that is offline is not a guard who left." actions={
        <ButtonGroup><LinkButton href="/operations">Active operations</LinkButton><LinkButton href="/operations/map">Live map</LinkButton><LinkButton href="/alerts">Guard alerts</LinkButton></ButtonGroup>
      } />
      <div className="space-y-4">
        <Card>
          <CardHeader title={`Outside their site now · ${outsideNow.length}`} description="A confirmed exit (two readings) with no return yet. Call the guard before drawing conclusions." />
          <Table>
            <THead><tr><th>Guard</th><th>Site</th><th>Since</th><th>Last reading</th><th>Shift</th></tr></THead>
            <TBody>
              {outsideNow.length === 0 && <Empty colSpan={5} title="Nobody is outside their site" />}
              {outsideNow.map(({ s, e }) => <tr key={s.id}><td><Link href={`/guards/${s.guardId}`} className="font-medium hover:underline">{s.guard.firstName} {s.guard.lastName}</Link></td><td><Link href={`/locations/${s.locationId}`} className="hover:underline">{s.location.name}</Link></td><td className="tnum">{ago(e!.occurredAt)}</td><td className="tnum">{e!.distanceM != null ? `${Math.round(e!.distanceM)} m from the centre` : "—"}{e!.accuracyM != null ? ` · ±${Math.round(e!.accuracyM)} m` : ""}{e!.syncStatus === "SYNCED_LATE" ? " · synced late" : ""}</td><td><Link href={`/shifts/${s.id}`} className="underline">open</Link></td></tr>)}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title={`Attendance exceptions · last 7 days · ${exceptions.length}`} description="EXCEPTION: the guard confirmed arrival by SMS while the phone's fix was outside the site. UNAVAILABLE: arrival confirmed, no usable fix at the time." />
          <Table>
            <THead><tr><th>When</th><th>Guard</th><th>Site</th><th>Verification</th><th>Shift</th></tr></THead>
            <TBody>
              {exceptions.length === 0 && <Empty colSpan={5} title="No attendance exceptions" />}
              {exceptions.map((a) => <tr key={a.shiftId}><td className="tnum">{fmtDateTime(a.locationVerifiedAt ?? a.shift.startAt)}</td><td><Link href={`/guards/${a.shift.guardId}`} className="font-medium hover:underline">{a.shift.guard.firstName} {a.shift.guard.lastName}</Link></td><td>{a.shift.location.name}</td><td><Status tone={a.locationVerification === "EXCEPTION" ? "warn" : "muted"}>{a.locationVerification === "EXCEPTION" ? "SMS yes · GPS outside" : "No usable fix at arrival"}</Status></td><td><Link href={`/shifts/${a.shiftId}`} className="underline">open</Link></td></tr>)}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title={`Verification overdue · last 24 h · ${overdue.length}`} description="The phone was online but sent no location check for two intervals. Usually a battery manager killed the app; see ANDROID_INSTALLATION.md." />
          <Table>
            <THead><tr><th>When</th><th>Guard</th><th>Site</th><th>Shift</th></tr></THead>
            <TBody>
              {overdue.length === 0 && <Empty colSpan={4} title="No overdue verifications" />}
              {overdue.map((e) => <tr key={e.id}><td className="tnum">{fmtDateTime(e.occurredAt)}</td><td>{e.guard ? <Link href={`/guards/${e.guard.id}`} className="font-medium hover:underline">{e.guard.firstName} {e.guard.lastName}</Link> : "—"}</td><td>{e.location?.name ?? "—"}</td><td>{e.shift ? <Link href={`/shifts/${e.shift.id}`} className="underline">open · {e.shift.status.toLowerCase().replace(/_/g, " ")}</Link> : "—"}</td></tr>)}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title={`Location unavailable · last 24 h · ${spells.size} spell${spells.size === 1 ? "" : "s"}`} description="Grouped per shift, with every reason seen. Who to chase: GPS conditions clear on their own, a phone setting needs the guard, a missing site centre needs an administrator." />
          <Table>
            <THead><tr><th>Guard</th><th>Site</th><th>From</th><th>To</th><th>Events</th><th>Reasons</th><th>Shift</th></tr></THead>
            <TBody>
              {spells.size === 0 && <Empty colSpan={7} title="No unavailable spells" />}
              {[...spells.values()].map((sp, i) => <tr key={i}><td><Link href={`/guards/${sp.guardId}`} className="font-medium hover:underline">{sp.guard}</Link></td><td>{sp.site ?? "—"}</td><td className="tnum">{fmtDateTime(sp.first)}</td><td className="tnum">{fmtDateTime(sp.last)}</td><td className="tnum">{sp.count}</td><td>{[...sp.reasons].join(", ") || "—"}</td><td>{sp.shiftId ? <Link href={`/shifts/${sp.shiftId}`} className="underline">open</Link> : "—"}</td></tr>)}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title={`Integrity · ${mocks.length}`} description="Phones that reported a mock (fake) location provider at some point. Treat their location events with caution; it is a warning, not an accusation." />
          <Table>
            <THead><tr><th>Device</th><th>Guard</th><th>Last seen</th></tr></THead>
            <TBody>
              {mocks.length === 0 && <Empty colSpan={3} title="No integrity warnings" />}
              {mocks.map((d) => <tr key={d.id}><td><Link href={`/gateways/${d.id}`} className="font-medium hover:underline">{d.deviceName}</Link></td><td>{d.guard ? `${d.guard.firstName} ${d.guard.lastName}` : "—"}</td><td className="tnum">{d.lastSeenAt ? ago(d.lastSeenAt) : "never"}</td></tr>)}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
