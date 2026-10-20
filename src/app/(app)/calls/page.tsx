import { subDays } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { callRows, liveCalls, callMetrics, type CallFilter } from "@/lib/gateway/calls";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Select, Input } from "@/components/ui/form";
import { LiveCallCards } from "@/components/calls/live-calls";
import { CallList } from "@/components/calls/call-list";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata = { title: "Calls" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const f: CallFilter = { guardId: sp.guardId || undefined, locationId: sp.locationId || undefined, gatewayId: sp.gatewayId || undefined, status: (sp.status as never) || undefined, direction: (sp.direction as never) || undefined, q: sp.q || undefined };
  if (view === "missed") f.status = "MISSED";
  if (view === "unknown") f.unknown = true;
  const [live, missed, calls, metrics, gateways, locations, counts] = await Promise.all([
    liveCalls(),
    db.callLog.findMany({ where: { status: "MISSED", direction: "INCOMING", note: null, startedAt: { gte: subDays(new Date(), 1) } }, include: { guard: { select: { id: true, firstName: true, lastName: true, phone: true, photoUrl: true } }, location: { select: { id: true, name: true } }, client: { select: { id: true, name: true } }, gateway: { select: { id: true, deviceName: true, phoneNumber: true } }, shift: { select: { id: true, startAt: true, endAt: true, status: true } } }, orderBy: { startedAt: "desc" }, take: 9 }),
    callRows(f, 100),
    callMetrics({ from: subDays(new Date(), 30) }),
    db.gatewayDevice.findMany({ orderBy: { deviceName: "asc" }, select: { id: true, deviceName: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    Promise.all([db.callLog.count({ where: { status: "MISSED", startedAt: { gte: subDays(new Date(), 7) } } }), db.callLog.count({ where: { unknownCaller: true, unknownResolution: null } })]),
  ]);
  return (
    <div>
      <AutoRefresh seconds={10} />
      <PageHeader title="Calls" description={`Calls to the gateway phones. Last 30 days: ${metrics.total} calls, ${metrics.missed} missed, ${metrics.unknown} from unknown numbers.`} actions={<a href="/reports/calls" className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Call report</a>} />
      <Card className="mb-4">
        <CardHeader title="Live" description="Calls in progress, then unhandled missed calls from the last 24 hours." />
        <div className="p-4 pt-0"><LiveCallCards live={live} missed={missed.filter((m) => !live.some((l) => l.id === m.id))} /></div>
      </Card>
      <Segments className="mb-4" items={[{ href: "/calls", label: "All", active: view === "all" }, { href: "/calls?view=missed", label: "Missed", count: counts[0], active: view === "missed", tone: "critical" }, { href: "/calls?view=unknown", label: "Unknown callers", count: counts[1], active: view === "unknown", tone: "warn" }]} />
      <Card>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" method="get">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name or number" className="w-full sm:w-48" />
          <Select name="gatewayId" defaultValue={sp.gatewayId ?? ""} className="w-full sm:w-48"><option value="">All gateways</option>{gateways.map((g) => <option key={g.id} value={g.id}>{g.deviceName}</option>)}</Select>
          <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-full sm:w-48"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          {view === "all" && <Select name="status" defaultValue={sp.status ?? ""} className="w-full sm:w-40"><option value="">Any status</option>{["RINGING", "ANSWERED", "ENDED", "MISSED", "FAILED", "UNKNOWN"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>}
          <Select name="direction" defaultValue={sp.direction ?? ""} className="w-full sm:w-36"><option value="">Any direction</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></Select>
          <button className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-medium text-white">Filter</button>
        </form>
        <CallList calls={calls} emptyTitle="No calls match" />
      </Card>
    </div>
  );
}
