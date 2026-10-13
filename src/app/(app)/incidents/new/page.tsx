import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createIncident } from "@/actions/incidents";
import { CATEGORY_LABEL } from "@/lib/services/incidents";
import { LIVE_STATUSES } from "@/lib/services/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import { fmtTime, fmtDate } from "@/lib/time";

export const metadata = { title: "Log incident" };

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<{ shiftId?: string; guardId?: string }> }) {
  await requireUser("SUPERVISOR");
  const sp = await searchParams;
  const [guards, locations, shifts, supervisors] = await Promise.all([
    db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" } }), db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { guard: true, location: true }, orderBy: { startAt: "desc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Log incident" description="For incidents reported by phone, radio or in person. SMS incidents are created automatically." />
      <Card><CardBody>
        <ActionForm action={createIncident} submitLabel="Log incident">
          <FormSection title="Where and who">
            <Field label="Guard" required><Select name="guardId" defaultValue={sp.guardId ?? ""} required><option value="" disabled>Select a guard</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select></Field>
            <Field label="Location" required><Select name="locationId" defaultValue="" required><option value="" disabled>Select a site</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Live shift" hint="Optional. Links the incident to the shift timeline."><Select name="shiftId" defaultValue={sp.shiftId ?? ""}><option value="">Not linked</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.guard.firstName} {s.guard.lastName} · {s.location.name} · {fmtDate(s.startAt)} {fmtTime(s.startAt)}</option>)}</Select></Field>
            <Field label="Supervisor"><Select name="supervisorId" defaultValue=""><option value="">Unassigned</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </FormSection>
          <FormSection title="What happened">
            <Field label="Category" required><Select name="category" defaultValue="OTHER">{Object.entries(CATEGORY_LABEL).filter(([k]) => k !== "ASSISTANCE_REQUEST").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Severity" required><Select name="severity" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></Select></Field>
            <Field label="When" required><Input type="datetime-local" name="occurredAt" defaultValue={local} required /></Field>
            <Field label="Description" required className="sm:col-span-2"><Textarea name="description" required placeholder="What happened, who was involved, what action was taken" /></Field>
          </FormSection>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
