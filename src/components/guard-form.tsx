import type { Guard, Location, User } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import { dateInputValue } from "@/lib/time";
import { PhotoField } from "@/components/photo-field";
import type { ActionState } from "@/actions/_helpers";

type Props = { action: (s: ActionState, fd: FormData) => Promise<ActionState>; guard?: Guard | null; locations: Location[]; supervisors: User[]; submitLabel: string };

export function GuardForm({ action, guard, locations, supervisors, submitLabel }: Props) {
  const g = guard;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Identity" description="The phone number is how the system recognises the guard's replies. It must be unique.">
        <Field label="First name" required><Input name="firstName" defaultValue={g?.firstName} required /></Field>
        <Field label="Last name" required><Input name="lastName" defaultValue={g?.lastName} required /></Field>
        <Field label="Mobile number" required hint="Zimbabwean numbers can be entered as 0772 123 456."><Input name="phone" defaultValue={g?.phone} placeholder="+263 77 123 4567" required /></Field>
        <Field label="National ID / passport" required><Input name="nationalId" defaultValue={g?.nationalId} placeholder="63-123456A63" required /></Field>
        <Field label="Gender"><Select name="gender" defaultValue={g?.gender ?? "MALE"}><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Date of birth"><Input type="date" name="dateOfBirth" defaultValue={g?.dateOfBirth ? dateInputValue(g.dateOfBirth) : ""} /></Field>
        <Field label="Home address" className="sm:col-span-2"><Input name="address" defaultValue={g?.address ?? ""} /></Field>
        <PhotoField name="photoUrl" current={g?.photoUrl} personName={g ? `${g.firstName} ${g.lastName}` : "New guard"} />
      </FormSection>
      <FormSection title="Emergency contact">
        <Field label="Name"><Input name="emergencyContactName" defaultValue={g?.emergencyContactName ?? ""} /></Field>
        <Field label="Phone"><Input name="emergencyContactPhone" defaultValue={g?.emergencyContactPhone ?? ""} /></Field>
      </FormSection>
      <FormSection title="Employment" description="Guards on leave, suspended or inactive are not offered when scheduling.">
        <Field label="Employment status"><Select name="employmentStatus" defaultValue={g?.employmentStatus ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive</option></Select></Field>
        <Field label="Date employed"><Input type="date" name="dateEmployed" defaultValue={g?.dateEmployed ? dateInputValue(g.dateEmployed) : dateInputValue(new Date())} /></Field>
        <Field label="Supervisor"><Select name="supervisorId" defaultValue={g?.supervisorId ?? ""}><option value="">Unassigned</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Usual location"><Select name="homeLocationId" defaultValue={g?.homeLocationId ?? ""}><option value="">Unassigned</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={g?.notes ?? ""} placeholder="Training, certifications, disciplinary notes" /></Field>
      </FormSection>
    </ActionForm>
  );
}
