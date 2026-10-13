import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Select, Input } from "@/components/ui/form";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser("SUPER_ADMIN");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 60;
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.action) where.action = sp.action;
  if (sp.actor) where.actor = { contains: sp.actor, mode: "insensitive" };
  const [rows, total, actions] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip: (page - 1) * take }), db.auditLog.count({ where }), db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } })]);
  return (
    <div>
      <PageHeader title="Audit log" description="Who did what, when, and from where. System actions are attributed to the automation engine or the SMS gateway." />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Select name="action" defaultValue={sp.action ?? ""} className="w-56"><option value="">Any action</option>{actions.map((a) => <option key={a.action} value={a.action}>{a.action.toLowerCase().replace(/_/g, " ")}</option>)}</Select>
        <Input name="actor" defaultValue={sp.actor ?? ""} placeholder="Actor" className="w-48" />
        <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
      </form>
      <Card>
        <Table>
          <THead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP / device</th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={6} title="Nothing recorded" />}
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap tnum">{fmtDateTime(a.createdAt)}</td>
                <td className="font-medium text-ink">{a.actor}</td>
                <td>{a.action.toLowerCase().replace(/_/g, " ")}</td>
                <td className="text-ink-2">{a.entity ?? "—"}</td>
                <td className="max-w-md truncate font-mono text-[12px] text-ink-2">{a.details ? JSON.stringify(a.details) : ""}</td>
                <td className="text-[12px] text-ink-3">{a.ip ?? ""}{a.userAgent ? <span className="block max-w-[180px] truncate">{a.userAgent}</span> : null}</td>
              </tr>
            ))}
          </TBody>
        </Table>
        {total > take && <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-ink-2"><span>{(page - 1) * take + 1}–{Math.min(page * take, total)} of {total}</span><span className="flex gap-2">{page > 1 && <a href={`/audit?page=${page - 1}`} className="underline">Previous</a>}{page * take < total && <a href={`/audit?page=${page + 1}`} className="underline">Next</a>}</span></div>}
      </Card>
    </div>
  );
}
