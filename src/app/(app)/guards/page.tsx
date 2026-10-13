import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ON_SITE_STATUSES } from "@/lib/services/shifts";
import { guardLiveStatus, GUARD_STATUS_LABEL } from "@/lib/services/guards";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Guards" };

export default async function GuardsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = sp.f ?? "active";
  const where: Prisma.GuardWhereInput = {};
  if (f === "active") where.active = true;
  if (f === "inactive") where.active = false;
  if (f === "leave") where.employmentStatus = { in: ["ON_LEAVE", "SUSPENDED"] };
  if (sp.q) where.OR = [{ firstName: { contains: sp.q, mode: "insensitive" } }, { lastName: { contains: sp.q, mode: "insensitive" } }, { phone: { contains: sp.q.replace(/\s/g, "") } }, { guardNo: { contains: sp.q, mode: "insensitive" } }, { nationalId: { contains: sp.q, mode: "insensitive" } }];
  if (sp.locationId) where.homeLocationId = sp.locationId;
  if (sp.supervisorId) where.supervisorId = sp.supervisorId;
  const [guards, locations, supervisors, deployed, counts] = await Promise.all([
    db.guard.findMany({ where, include: { homeLocation: true, supervisor: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.shift.findMany({ where: { status: { in: ON_SITE_STATUSES } }, select: { guardId: true, location: { select: { name: true } } } }),
    Promise.all([db.guard.count({ where: { active: true } }), db.guard.count({ where: { employmentStatus: { in: ["ON_LEAVE", "SUSPENDED"] } } }), db.guard.count({ where: { active: false } })]),
  ]);
  const deployedMap = new Map(deployed.map((d) => [d.guardId, d.location.name]));
  const tone = { DEPLOYED: "ok", AVAILABLE: "neutral", ON_LEAVE: "warn", SUSPENDED: "critical", INACTIVE: "muted" } as const;

  return (
    <div>
      <PageHeader title="Guards" description={`${counts[0]} active guards. Phone numbers are unique so SMS replies route to the right person.`} actions={can.manageGuards(user) && <LinkButton href="/guards/new" variant="primary">Add guard</LinkButton>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segments items={[
          { href: "/guards", label: "Active", count: counts[0], active: f === "active" },
          { href: "/guards?f=leave", label: "On leave / suspended", count: counts[1], active: f === "leave", tone: "warn" },
          { href: "/guards?f=inactive", label: "Inactive", count: counts[2], active: f === "inactive" },
          { href: "/guards?f=all", label: "All", active: f === "all" },
        ]} />
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="f" value={f} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, phone, ID or guard no." className="w-56" />
          <Select name="locationId" defaultValue={sp.locationId ?? ""} className="w-48"><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          <Select name="supervisorId" defaultValue={sp.supervisorId ?? ""} className="w-44"><option value="">Any supervisor</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Search</button>
        </form>
      </div>
      <Card>
        <Table>
          <THead><tr><th>Guard</th><th>Phone</th><th>National ID</th><th>Usual location</th><th>Supervisor</th><th>Employment</th><th>Current status</th></tr></THead>
          <TBody>
            {guards.length === 0 && <Empty colSpan={7} title="No guards match" body={sp.q ? `Nothing found for “${sp.q}”.` : "Add your first guard to start scheduling."} action={can.manageGuards(user) ? <LinkButton href="/guards/new" variant="primary" size="sm">Add guard</LinkButton> : undefined} />}
            {guards.map((g) => {
              const live = guardLiveStatus(g, deployedMap.has(g.id));
              return (
                <tr key={g.id}>
                  <td><Link href={`/guards/${g.id}`} className="flex items-center gap-3"><Avatar src={g.photoUrl} name={`${g.firstName} ${g.lastName}`} size={32} /><div><div className="font-medium text-ink">{g.firstName} {g.lastName}</div><div className="text-[12px] text-ink-3">{g.guardNo}</div></div></Link></td>
                  <td className="tnum text-ink-2">{formatPhone(g.phone)}</td>
                  <td className="tnum text-ink-2">{g.nationalId}</td>
                  <td className="text-ink-2">{g.homeLocation?.name ?? "—"}</td>
                  <td className="text-ink-2">{g.supervisor?.name ?? "—"}</td>
                  <td className="text-ink-2">{g.employmentStatus === "ACTIVE" ? "Active" : g.employmentStatus === "ON_LEAVE" ? "On leave" : g.employmentStatus === "SUSPENDED" ? "Suspended" : "Inactive"}</td>
                  <td><Status tone={tone[live]}>{live === "DEPLOYED" ? `Deployed · ${deployedMap.get(g.id)}` : GUARD_STATUS_LABEL[live]}</Status></td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
