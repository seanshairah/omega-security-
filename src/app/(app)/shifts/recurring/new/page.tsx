import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createRecurrence } from "@/actions/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import { ShiftTimePicker } from "@/components/shift-time-picker";
import { dateInputValue } from "@/lib/time";

export const metadata = { title: "Recurring pattern" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const IDX = [1, 2, 3, 4, 5, 6, 0];

export default async function NewRecurrencePage() {
  await requireUser("ADMIN");
  const [guards, locations, supervisors] = await Promise.all([
    db.guard.findMany({ where: { active: true, employmentStatus: "ACTIVE" }, orderBy: { lastName: "asc" } }),
    db.location.findMany({ where: { active: true }, include: { client: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="w-full">
      <PageHeader title="Recurring pattern" description="For guards who work the same schedule every week. Shifts are created two weeks ahead and kept topped up." />
      <Card><CardBody>
        <ActionForm action={createRecurrence} submitLabel="Create pattern">
          <FormSection title="Who and where">
            <Field label="Guard" required><Select name="guardId" defaultValue="" required><option value="" disabled>Select a guard</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName} · {g.guardNo}</option>)}</Select></Field>
            <Field label="Location" required><Select name="locationId" defaultValue="" required><option value="" disabled>Select a site</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.client.name}</option>)}</Select></Field>
            <Field label="Supervisor"><Select name="supervisorId" defaultValue=""><option value="">Site supervisor</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </FormSection>
          <FormSection title="Schedule" description="Example: Monday to Sunday, 18:00 to 06:00 at ABC Warehouse.">
            <div className="sm:col-span-2">
              <div className="mb-1.5 text-[13px] font-medium text-ink">Days <span className="text-critical">*</span></div>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <label key={d} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-surface px-3 text-[13px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="checkbox" name="daysOfWeek[]" value={IDX[i]} defaultChecked className="accent-[#4f9f3a]" /> {d}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2"><ShiftTimePicker /></div>
            <Field label="Starts on" required><Input type="date" name="startsOn" defaultValue={dateInputValue(new Date())} required /></Field>
            <Field label="Ends on" hint="Leave empty for open-ended."><Input type="date" name="endsOn" /></Field>
          </FormSection>
          <FormSection title="Instructions">
            <Field label="Shift instructions" className="sm:col-span-2"><Textarea name="instructions" /></Field>
          </FormSection>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
