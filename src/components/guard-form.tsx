import type { Guard, Location, User } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection, Checkbox } from "@/components/ui/form";
import { dateInputValue } from "@/lib/time";
import { PhotoField } from "@/components/photo-field";
import type { ActionState } from "@/actions/_helpers";

type Props = { action: (s: ActionState, fd: FormData) => Promise<ActionState>; guard?: Guard | null; locations: Location[]; supervisors: User[]; gateways?: { id: string; deviceName: string; phoneNumber: string }[]; submitLabel: string };

export function GuardForm({ action, guard, locations, supervisors, gateways = [], submitLabel }: Props) {
  const g = guard;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Identity" description="The phone number is how the system recognises the guard's replies. It must be unique.">
        <Field label="First name" required><Input name="firstName" defaultValue={g?.firstName} required /></Field>
        <Field label="Last name" required><Input name="lastName" defaultValue={g?.lastName} required /></Field>
        <Field label="Mobile number" required hint="Zimbabwean numbers can be entered as 0772 123 456."><Input name="phone" defaultValue={g?.phone} placeholder="+263 77 123 4567" required /></Field>
        <Field label="National ID / passport" required><Input name="nationalId" defaultValue={g?.nationalId} placeholder="63-123456A63" required /></Field>
        <Field label="Email" hint="Optional. Used for email messages from the portal."><Input type="email" name="email" defaultValue={g?.email ?? ""} /></Field>
        <Field label="Gender"><Select name="gender" defaultValue={g?.gender ?? "MALE"}><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Date of birth"><Input type="date" name="dateOfBirth" defaultValue={g?.dateOfBirth ? dateInputValue(g.dateOfBirth) : ""} /></Field>
        <Field label="Home address" className="sm:col-span-2"><Input name="address" defaultValue={g?.address ?? ""} /></Field>
        <PhotoField name="photoUrl" current={g?.photoUrl} personName={g ? `${g.firstName} ${g.lastName}` : "New guard"} />
      </FormSection>
      <FormSection title="Phone and attendance" description="How this guard clocks in and out. A guard without the guard app calls an operations gateway phone, or replies to SMS. A call is recorded as a call, never as their location.">
        <Field label="Phone type"><Select name="phoneType" defaultValue={g?.phoneType ?? "UNKNOWN"}><option value="BASIC">Basic / feature phone</option><option value="ANDROID">Android smartphone</option><option value="OTHER">Other</option><option value="UNKNOWN">Not known</option></Select></Field>
        <Field label="Mobile network" hint="As the guard says. The number's prefix is not trusted: numbers move between networks."><Select name="mobileOperator" defaultValue={g?.mobileOperator ?? "UNKNOWN"}><option value="ECONET">Econet</option><option value="NETONE">NetOne</option><option value="TELECEL">Telecel</option><option value="OTHER">Other</option><option value="UNKNOWN">Not known</option></Select></Field>
        <Field label="Attends by" hint="What the guard is told to use. The chosen ways are switched on below; every enabled way still works."><Select name="preferredAttendance" defaultValue={g?.preferredAttendance ?? "SMS"}><option value="CALL">Calling the gateway phone</option><option value="SMS">SMS replies</option><option value="CALL_OR_SMS">Calls or SMS</option><option value="APP">The guard app (GPS)</option></Select></Field>
        <Field label="Gateway phone to call" hint="Calls to another gateway are flagged. Empty: the site's default, else any."><Select name="assignedGatewayId" defaultValue={g?.assignedGatewayId ?? ""}><option value="">Site default</option>{gateways.map((d) => <option key={d.id} value={d.id}>{d.deviceName} · {d.phoneNumber}</option>)}</Select></Field>
        <Field label="Other numbers the guard may use" className="sm:col-span-2" hint="Separate with commas. A number shared with another guard is refused: it would identify neither."><Input name="alternatePhones" defaultValue={(g?.alternatePhones ?? []).join(", ")} placeholder="0773 000 111" /></Field>
        <Checkbox name="callAttendanceEnabled" defaultChecked={g ? g.callAttendanceEnabled : true} label="Clock in and out by calling" hint="Calls to an operations gateway phone count, under the call attendance policy in Settings." />
        <Checkbox name="smsAttendanceEnabled" defaultChecked={g ? g.smsAttendanceEnabled : true} label="Confirm by SMS" hint="The guard may be texted to reply YES when a call alone is not enough." />
        <Checkbox name="welfareExempt" defaultChecked={g?.welfareExempt ?? false} label="No scheduled welfare checks" hint="The site's welfare schedule skips this guard. The mid-shift check still applies at sites without a schedule." />
        <Checkbox name="phoneVerified" defaultChecked={Boolean(g?.phoneVerifiedAt)} label="Number verified" hint={g?.phoneVerifiedAt ? "Cleared automatically if the number changes." : "Tick after a test call or SMS from this number."} />
        <Checkbox name="networkLocationEligible" defaultChecked={g?.networkLocationEligible ?? false} label="Network location checks allowed" hint="Only with an authorised mobile-network service, during shifts. Needs consent." />
        <Checkbox name="networkLocationConsent" defaultChecked={Boolean(g?.networkLocationConsentAt)} label="Consent to network location recorded" hint="The guard agreed, in writing, to location checks by their network during shifts." />
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
