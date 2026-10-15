import type { GatewayDevice, Location, Client } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import type { ActionState } from "@/actions/_helpers";

type A = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function GatewayForm({ action, gateway, locations, submitLabel }: { action: A; gateway?: GatewayDevice | null; locations: (Location & { client: Client })[]; submitLabel: string }) {
  const g = gateway;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Gateway phone" description="An Android phone with a SIM that guards call. The app on it reports call events; it never records audio.">
        <Field label="Gateway name" required hint="Shown on the dashboard and on the phone."><Input name="deviceName" defaultValue={g?.deviceName ?? ""} placeholder="Control Room Phone 01" required /></Field>
        <Field label="SIM phone number" required hint="The number guards dial."><Input name="phoneNumber" defaultValue={g?.phoneNumber ?? ""} placeholder="+263 77 123 4567" required /></Field>
        <Field label="Location" hint="Calls from unknown numbers are filed under this site."><Select name="locationId" defaultValue={g?.locationId ?? ""}><option value="">Head office / unassigned</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.client.name}</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={g?.notes ?? ""} placeholder="Where the phone sits, who looks after it" /></Field>
      </FormSection>
    </ActionForm>
  );
}
