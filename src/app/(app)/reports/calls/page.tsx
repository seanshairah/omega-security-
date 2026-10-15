import { startOfMonth, subDays, endOfDay } from "date-fns";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { callRows, callMetrics, type CallFilter } from "@/lib/gateway/calls";
import { fmtCallDuration } from "@/lib/gateway/call-state";
import { PageHeader, Segments, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { CallList } from "@/components/calls/call-list";

export const metadata = { title: "Call report" };

export default async function CallReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const range = sp.range ?? "30d";
  const now = new Date();
  const from = range === "7d" ? subDays(now, 7) : range === "month" ? startOfMonth(now) : range === "90d" ? subDays(now, 90) : subDays(now, 30);
  const to = endOfDay(now);
  const f: CallFilter = { from, to, guardId: sp.guardId || undefined, locationId: sp.locationId || undefined, clientId: sp.clientId || undefined, gatewayId: sp.gatewayId || undefined, status: (sp.status as never) || undefined, direction: (sp.direction as never) || undefined };
  const [metrics, rows, guards, locations, clients, gateways] = await Promise.all([
    callMetrics(f), callRows(f, 300),
    db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.gatewayDevice.findMany({ orderBy: { deviceName: "asc" }, select: { id: true, deviceName: true } }),
  ]);
  const keep = Object.entries({ guardId: sp.guardId, locationId: sp.locationId, clientId: sp.clientId, gatewayId: sp.gatewayId, status: sp.status, direction: sp.direction }).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
  const seg = (r: string) => `/reports/calls?range=${r}${keep ? `&${keep}` : ""}`;
  const csv = `/api/reports/calls.csv?from=${from.toISOString()}&to=${to.toISOString()}${keep ? `&${keep}` : ""}`;
  return (
    <div>
      <PageHeader title="Call report" description="Calls to the gateway phones by guard, location, client and gateway." actions={<a href={csv} className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Export CSV</a>} />
      <Segments className="mb-4" items={[{ href: seg("7d"), label: "Last 7 days", active: range === "7d" }, { href: seg("30d"), label: "Last 30 days", active: range === "30d" }, { href: seg("month"), label: "This month", active: range === "month" }, { href: seg("90d"), label: "Last 90 days", active: range === "90d" }]} />
      <Card className="mb-4"><CardBody className="pt-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
          <Meta label="Total calls"><span className="text-[20px] font-semibold tnum">{metrics.total}</span></Meta>
          <Meta label="Incoming"><span className="text-[20px] font-semibold tnum">{metrics.incoming}</span></Meta>
          <Meta label="Outgoing"><span className="text-[20px] font-semibold tnum">{metrics.outgoing}</span></Meta>
          <Meta label="Answered"><span className="text-[20px] font-semibold tnum">{metrics.answered}</span></Meta>
          <Meta label="Missed"><span className={`text-[20px] font-semibold tnum ${metrics.missed ? "text-critical" : ""}`}>{metrics.missed}</span></Meta>
          <Meta label="Average duration"><span className="text-[20px] font-semibold tnum">{fmtCallDuration(metrics.avgDurationSeconds)}</span></Meta>
          <Meta label="Unknown callers"><span className="text-[20px] font-semibold tnum">{metrics.unknown}</span></Meta>
        </div>
      </CardBody></Card>
      <Card>
        <CardHeader title="Calls" description={`${rows.length} shown${rows.length === 300 ? " (first 300; narrow the filters or export the CSV for everything)" : ""}.`} />
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" method="get">
          <input type="hidden" name="range" value={range} />
          <Select name="guardId" defaultValue={sp.guardId ?? ""} className="w-full sm:w-44"><option value="">All guards</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select>
          <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-full sm:w-44"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select name="clientId" defaultValue={sp.clientId ?? ""} className="w-full sm:w-44"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="gatewayId" defaultValue={sp.gatewayId ?? ""} className="w-full sm:w-44"><option value="">All gateways</option>{gateways.map((g) => <option key={g.id} value={g.id}>{g.deviceName}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-full sm:w-36"><option value="">Any status</option>{["ANSWERED", "ENDED", "MISSED", "FAILED", "UNKNOWN"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
          <Select name="direction" defaultValue={sp.direction ?? ""} className="w-full sm:w-36"><option value="">Any direction</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></Select>
          <button className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-medium text-white">Apply</button>
        </form>
        <CallList calls={rows} emptyTitle="No calls in this range" />
      </Card>
    </div>
  );
}
