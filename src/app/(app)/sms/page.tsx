import Link from "next/link";
import { ArrowDownLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { PageHeader, Segments } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Status } from "@/components/ui/status";
import { Select, Input } from "@/components/ui/form";
import { fmtDate, fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { activeProviderName } from "@/lib/sms";
import { Rows, CardRow } from "@/components/ui/rows";

export const metadata = { title: "Message logs" };
const TYPES = ["ARRIVAL", "ARRIVAL_REMINDER", "WELFARE", "INCIDENT", "ASSISTANCE", "COMPLETION", "HANDOVER", "EMERGENCY", "CLARIFICATION", "GENERAL"];

export default async function SmsLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 50;
  const where: Prisma.SmsMessageWhereInput = {};
  if (sp.direction) where.direction = sp.direction as never;
  if (sp.channel) where.channel = sp.channel as never;
  if (sp.type) where.type = sp.type as never;
  if (sp.status) where.status = sp.status as never;
  if (sp.guardId) where.guardId = sp.guardId;
  if (sp.shiftId) where.shiftId = sp.shiftId;
  if (sp.q) where.OR = [{ body: { contains: sp.q, mode: "insensitive" } }, { toNumber: { contains: sp.q } }, { fromNumber: { contains: sp.q } }];
  const [rows, total, guards, counts] = await Promise.all([
    db.smsMessage.findMany({ where, include: { guard: true, location: true }, orderBy: { createdAt: "desc" }, take, skip: (page - 1) * take }),
    db.smsMessage.count({ where }), db.guard.findMany({ orderBy: { lastName: "asc" } }),
    Promise.all([db.smsMessage.count(), db.smsMessage.count({ where: { direction: "OUTBOUND" } }), db.smsMessage.count({ where: { direction: "INBOUND" } }), db.smsMessage.count({ where: { status: "FAILED" } })]),
  ]);
  const keep = (over: Record<string, string>) => "/sms?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), ...over }).toString();
  const tone = (s: string) => (s === "FAILED" ? "critical" : s === "DELIVERED" || s === "RECEIVED" ? "ok" : s === "SENT" ? "info" : "neutral") as "critical" | "ok" | "info" | "neutral";

  return (
    <div>
      <PageHeader title="Message logs" description={`Every SMS, WhatsApp and email in and out, with how the system read each reply. Provider: ${activeProviderName()}.`} actions={<Link href="/messages/new" className="inline-flex h-9 items-center rounded-[8px] bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-strong">Compose</Link>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segments items={[{ href: keep({ direction: "", status: "" }), label: "All", count: counts[0], active: !sp.direction && !sp.status }, { href: keep({ direction: "OUTBOUND", status: "" }), label: "Sent", count: counts[1], active: sp.direction === "OUTBOUND" }, { href: keep({ direction: "INBOUND", status: "" }), label: "Received", count: counts[2], active: sp.direction === "INBOUND" }, { href: keep({ status: "FAILED", direction: "" }), label: "Failed", count: counts[3], active: sp.status === "FAILED", tone: counts[3] ? "critical" : undefined }]} />
        <form className="flex flex-wrap items-center gap-2">
          {sp.direction && <input type="hidden" name="direction" value={sp.direction} />}
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search text or number" className="w-full sm:w-52" />
          <Select name="channel" defaultValue={sp.channel ?? ""} className="w-full sm:w-36"><option value="">Any channel</option><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></Select>
          <Select name="type" defaultValue={sp.type ?? ""} className="w-full sm:w-44"><option value="">Any type</option>{TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase().replace("_", " ")}</option>)}</Select>
          <Select name="guardId" defaultValue={sp.guardId ?? ""} className="w-full sm:w-44"><option value="">All guards</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select>
          <button className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
        </form>
      </div>
      <Card>
        <Rows cards={
          rows.length === 0 ? <Empty title="No messages match" /> : rows.map((m) => (
            <CardRow key={m.id} href={m.shiftId ? `/shifts/${m.shiftId}` : m.guard ? `/guards/${m.guard.id}` : undefined}
              title={<span className="flex items-center gap-1.5">{m.direction === "OUTBOUND" ? <ArrowUpRightIcon size={13} weight="bold" className="text-ink-3" /> : <ArrowDownLeftIcon size={13} weight="bold" className="text-accent-strong" />}{m.guard ? `${m.guard.firstName} ${m.guard.lastName}` : "Unknown number"}</span>}
              subtitle={`${fmtDate(m.createdAt)} ${fmtTime(m.createdAt)} · ${m.channel === "SMS" ? "SMS" : m.channel === "WHATSAPP" ? "WhatsApp" : "Email"} · ${m.type.toLowerCase().replace("_", " ")}`}
              right={<Status tone={tone(m.status)}>{m.status.toLowerCase()}</Status>}>
              <p className={`mt-2 text-[13px] ${m.direction === "INBOUND" ? "font-medium text-ink" : "text-ink-2"}`}>{m.subject ? <span className="block font-medium text-ink">{m.subject}</span> : null}{m.body}</p>
              {m.error && <p className="mt-1 text-[12px] text-critical">{m.error}</p>}
              {m.interpretedAs && <p className="mt-1 text-[12px] text-ink-3">Read as {m.interpretedAs.toLowerCase().replace("_", " ")}</p>}
            </CardRow>
          ))
        } table={
        <Table>
          <THead><tr><th>When</th><th></th><th>Guard</th><th>To / from</th><th>Message</th><th>Channel</th><th>Type</th><th>Read as</th><th>Location</th><th>Status</th></tr></THead>
          <TBody>
            {rows.length === 0 && <Empty colSpan={10} title="No messages match" />}
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap tnum"><div>{fmtDate(m.createdAt)}</div><div className="text-[12px] text-ink-3">{fmtTime(m.createdAt)}</div></td>
                <td>{m.direction === "OUTBOUND" ? <ArrowUpRightIcon size={14} weight="bold" className="text-ink-3" aria-label="Sent" /> : <ArrowDownLeftIcon size={14} weight="bold" className="text-accent-strong" aria-label="Received" />}</td>
                <td>{m.guard ? <Link href={`/guards/${m.guard.id}`} className="hover:underline">{m.guard.firstName} {m.guard.lastName}</Link> : <span className="text-ink-3">Unknown</span>}</td>
                <td className="whitespace-nowrap tnum text-ink-2">{m.channel === "EMAIL" ? (m.direction === "OUTBOUND" ? m.toNumber : m.fromNumber) : formatPhone(m.direction === "OUTBOUND" ? m.toNumber : m.fromNumber)}</td>
                <td className="max-w-md">{m.subject && <p className="text-[12px] font-medium text-ink">{m.subject}</p>}<p className={`line-clamp-2 ${m.direction === "INBOUND" ? "font-medium text-ink" : "text-ink-2"}`}>{m.body}</p>{m.error && <p className="text-[12px] text-critical">{m.error}</p>}{m.shiftId && <Link href={`/shifts/${m.shiftId}`} className="text-[12px] text-ink-3 hover:underline">shift</Link>}</td>
                <td className="text-ink-2">{m.channel === "SMS" ? "SMS" : m.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</td>
                <td className="text-ink-2">{m.type.toLowerCase().replace("_", " ")}</td>
                <td className="text-ink-2">{m.interpretedAs?.toLowerCase().replace("_", " ") ?? "—"}</td>
                <td className="text-ink-2">{m.location?.name ?? "—"}</td>
                <td><Status tone={tone(m.status)}>{m.status.toLowerCase()}</Status></td>
              </tr>
            ))}
          </TBody>
        </Table>
        } />
        {total > take && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-ink-2">
            <span>{(page - 1) * take + 1}–{Math.min(page * take, total)} of {total}</span>
            <span className="flex gap-2">{page > 1 && <Link href={keep({ page: String(page - 1) })} className="underline">Previous</Link>}{page * take < total && <Link href={keep({ page: String(page + 1) })} className="underline">Next</Link>}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
