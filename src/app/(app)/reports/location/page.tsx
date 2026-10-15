import Link from "next/link";
import { startOfMonth, subDays, endOfDay } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus, GATEWAY_STATUS_META } from "@/lib/gateway/service";
import { PageHeader, Segments, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { PermissionBadge } from "@/components/location/location-panel";
import { ago } from "@/lib/time";

export const metadata = { title: "Location report" };

export default async function LocationReportPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireUser();
  const { range = "30d" } = await searchParams;
  const now = new Date();
  const from = range === "7d" ? subDays(now, 7) : range === "month" ? startOfMonth(now) : range === "90d" ? subDays(now, 90) : subDays(now, 30);
  const to = endOfDay(now);
  const [guards, events, shifts, devices, offlineMinutes] = await Promise.all([
    db.guard.findMany({ where: { deviceKind: "ANDROID_GUARD" }, orderBy: { lastName: "asc" } }),
    db.locationEvent.findMany({ where: { occurredAt: { gte: from, lte: to }, guardId: { not: null } }, select: { guardId: true, shiftId: true, eventType: true, durationOutsideSeconds: true, syncStatus: true } }),
    db.shift.findMany({ where: { startAt: { gte: from, lte: to }, guard: { deviceKind: "ANDROID_GUARD" } }, select: { id: true, guardId: true, attendance: { select: { locationVerification: true } } } }),
    db.gatewayDevice.findMany({ where: { status: { not: "REVOKED" } }, include: { guard: { select: { id: true, firstName: true, lastName: true } } }, orderBy: [{ mode: "asc" }, { deviceName: "asc" }] }),
    getSettingNumber("gateway.offlineMinutes"),
  ]);
  const rows = guards.map((g) => {
    const ev = events.filter((e) => e.guardId === g.id);
    const sh = shifts.filter((s) => s.guardId === g.id);
    const monitored = new Set(ev.map((e) => e.shiftId).filter(Boolean)).size;
    return { g, scheduled: sh.length, monitored, verified: sh.filter((s) => s.attendance?.locationVerification === "VERIFIED").length, exceptions: sh.filter((s) => s.attendance?.locationVerification === "EXCEPTION").length, exits: ev.filter((e) => e.eventType === "LOCATION_EXIT").length, returns: ev.filter((e) => e.eventType === "LOCATION_RETURNED").length, outsideMin: Math.round(ev.filter((e) => e.eventType === "LOCATION_RETURNED").reduce((n, e) => n + (e.durationOutsideSeconds ?? 0), 0) / 60), unavailable: ev.filter((e) => e.eventType === "LOCATION_UNAVAILABLE" || e.eventType === "LOCATION_VERIFICATION_OVERDUE").length, late: ev.filter((e) => e.syncStatus === "SYNCED_LATE").length };
  });
  const totals = rows.reduce((t, r) => ({ monitored: t.monitored + r.monitored, verified: t.verified + r.verified, exceptions: t.exceptions + r.exceptions, exits: t.exits + r.exits, outsideMin: t.outsideMin + r.outsideMin, unavailable: t.unavailable + r.unavailable }), { monitored: 0, verified: 0, exceptions: 0, exits: 0, outsideMin: 0, unavailable: 0 });
  const dev = devices.map((d) => ({ d, status: effectiveStatus(d, offlineMinutes, now) }));
  return (
    <div>
      <PageHeader title="Location and device report" description="Location compliance for guards with Android devices, and device health for every phone. Feature-phone guards appear in the attendance report only." />
      <Segments className="mb-4" items={[{ href: "/reports/location?range=7d", label: "Last 7 days", active: range === "7d" }, { href: "/reports/location?range=30d", label: "Last 30 days", active: range === "30d" }, { href: "/reports/location?range=month", label: "This month", active: range === "month" }, { href: "/reports/location?range=90d", label: "Last 90 days", active: range === "90d" }]} />
      <Card className="mb-4"><CardBody className="pt-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Meta label="Shifts monitored"><span className="text-[20px] font-semibold tnum">{totals.monitored}</span></Meta>
          <Meta label="Arrivals verified"><span className="text-[20px] font-semibold tnum">{totals.verified}</span></Meta>
          <Meta label="Location exceptions"><span className={`text-[20px] font-semibold tnum ${totals.exceptions ? "text-warn" : ""}`}>{totals.exceptions}</span></Meta>
          <Meta label="Exits"><span className={`text-[20px] font-semibold tnum ${totals.exits ? "text-critical" : ""}`}>{totals.exits}</span></Meta>
          <Meta label="Time outside"><span className="text-[20px] font-semibold tnum">{totals.outsideMin} min</span></Meta>
          <Meta label="Location unavailable"><span className="text-[20px] font-semibold tnum">{totals.unavailable}</span></Meta>
        </div>
      </CardBody></Card>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Location compliance by guard" description="Only guards with an Android device. Exceptions are something to check, not proof of absence." />
          <Table>
            <THead><tr><th>Guard</th><th>Shifts</th><th>Monitored</th><th>Verified</th><th>Exceptions</th><th>Exits</th><th>Returns</th><th>Outside</th><th>Unavailable</th><th>Synced late</th></tr></THead>
            <TBody>
              {rows.length === 0 && <Empty colSpan={10} title="No Android guards" body="Register a guard device under Devices to start GPS verification." />}
              {rows.map((r) => <tr key={r.g.id}><td><Link href={`/guards/${r.g.id}?tab=location`} className="flex items-center gap-2.5 font-medium text-ink hover:underline"><Avatar src={r.g.photoUrl} name={r.g.firstName} size={28} />{r.g.firstName} {r.g.lastName}</Link></td><td className="tnum">{r.scheduled}</td><td className="tnum">{r.monitored}</td><td className="tnum">{r.verified}</td><td className="tnum">{r.exceptions ? <Status tone="warn">{r.exceptions}</Status> : 0}</td><td className="tnum">{r.exits ? <Status tone="critical">{r.exits}</Status> : 0}</td><td className="tnum">{r.returns}</td><td className="tnum">{r.outsideMin} min</td><td className="tnum">{r.unavailable}</td><td className="tnum">{r.late}</td></tr>)}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Device compliance" description="Every registered phone: online, battery, permissions, app version." />
          <Table>
            <THead><tr><th>Device</th><th>Mode</th><th>Status</th><th>Battery</th><th>Location perm.</th><th>Phone perm.</th><th>App</th></tr></THead>
            <TBody>
              {dev.length === 0 && <Empty colSpan={7} title="No devices" />}
              {dev.map(({ d, status }) => <tr key={d.id}><td><Link href={`/gateways/${d.id}`} className="font-medium text-ink hover:underline">{d.deviceName}</Link>{d.guard && <span className="block text-[12px] text-ink-3">{d.guard.firstName} {d.guard.lastName}</span>}</td><td className="text-ink-2">{d.mode === "GUARD" ? "Guard" : "Operations"}</td><td><Status tone={GATEWAY_STATUS_META[status].tone}>{GATEWAY_STATUS_META[status].label}</Status><span className="block text-[12px] text-ink-3">{d.lastSeenAt ? ago(d.lastSeenAt) : "never"}</span></td><td className="tnum">{d.batteryLevel != null ? <span className={d.batteryLevel < 15 ? "text-critical" : ""}>{d.batteryLevel}%</span> : "—"}</td><td>{d.mode === "GUARD" ? <PermissionBadge v={d.locationPermission} /> : "—"}</td><td><PermissionBadge v={d.callPermission} /></td><td className="tnum text-ink-2">{d.appVersion ?? "—"}</td></tr>)}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
