import type { User } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, FormSection } from "@/components/ui/form";
import type { ActionState } from "@/actions/_helpers";

export function UserForm({ action, user, submitLabel }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; user?: User | null; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Account">
        <Field label="Full name" required><Input name="name" defaultValue={user?.name} required /></Field>
        <Field label="Email" required><Input type="email" name="email" defaultValue={user?.email} required /></Field>
        <Field label="Job title"><Input name="title" defaultValue={user?.title ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={user?.phone ?? ""} /></Field>
      </FormSection>
      <FormSection title="Access" description="Super admins manage users and settings. Admins run operations. Supervisors can view their sites and handle incidents.">
        <Field label="Role" required><Select name="role" defaultValue={user?.role ?? "ADMIN"}><option value="SUPER_ADMIN">Super admin</option><option value="ADMIN">Operations admin</option><option value="SUPERVISOR">Supervisor</option></Select></Field>
        <Field label={user ? "New password" : "Password"} required={!user} hint={user ? "Leave blank to keep the current password." : "At least 8 characters."}><Input type="password" name="password" autoComplete="new-password" required={!user} /></Field>
      </FormSection>
    </ActionForm>
  );
}
