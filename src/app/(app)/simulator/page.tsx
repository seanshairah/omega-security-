import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { shiftInclude, CLOSED_STATUSES } from "@/lib/services/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Simulator } from "@/components/simulator";
import { activeProviderName } from "@/lib/sms";
import { fmtTime } from "@/lib/time";
import { STATUS_META } from "@/lib/services/shifts";

export const metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  await requireUser("ADMIN");
  const shifts = await db.shift.findMany({ where: { status: { notIn: CLOSED_STATUSES }, startAt: { lte: new Date(Date.now() + 6 * 3600_000) } }, include: { ...shiftInclude, smsMessages: { orderBy: { createdAt: "desc" }, take: 6 } }, orderBy: { startAt: "asc" } });
  const provider = activeProviderName();
  return (
    <div>
      <PageHeader title="SMS simulator" description={`Play the guard's phone. Replies go through the same pipeline as the live webhook. Outbound provider: ${provider}${provider === "simulated" ? " (nothing is really sent)" : " (real messages will be attempted)"}.`} />
      <Simulator shifts={shifts.map((s) => ({ id: s.id, guardId: s.guardId, guardName: `${s.guard.firstName} ${s.guard.lastName}`, phone: s.guard.phone, location: s.location.name, start: fmtTime(s.startAt), end: fmtTime(s.endAt), status: STATUS_META[s.status].label, pending: s.pendingPrompt, messages: s.smsMessages.reverse().map((m) => ({ id: m.id, direction: m.direction, body: m.body, at: fmtTime(m.createdAt), status: m.status })) }))} />
      <Card className="mt-4">
        <CardHeader title="How the flow runs" description="What the engine does on each minute tick, and what the guard is asked." />
        <CardBody className="grid gap-3 text-[13px] text-ink-2 sm:grid-cols-5">
          {[["1 · Start", "Arrival check sent at shift start. Guard replies YES or NO."], ["2 · Grace", "No reply after the grace period: reminder, status Late. Still nothing: Not confirmed, supervisor notified."], ["3 · Midpoint", "Welfare check at the midpoint. 1 well, 2 assistance, 3 incident (then a description). EMERGENCY works at any time."], ["4 · End", "Completion check at the end. YES completes, NO flags still on duty, INCIDENT starts the incident flow."], ["5 · Record", "Every step is stamped on the timeline, the SMS log and the audit log."]].map(([t, b]) => <div key={t}><p className="font-semibold text-ink">{t}</p><p className="mt-1">{b}</p></div>)}
        </CardBody>
      </Card>
    </div>
  );
}
