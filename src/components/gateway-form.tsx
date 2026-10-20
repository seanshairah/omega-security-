import type { GatewayDevice, Location, Client, Guard } from "@prisma/client";
import { ModeFields } from "@/components/gateway-mode-fields";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import type { ActionState } from "@/actions/_helpers";

type A = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function GatewayForm({ action, gateway, locations, guards, submitLabel }: { action: A; gateway?: GatewayDevice | null; locations: (Location & { client: Client })[]; guards: Pick<Guard, "id" | "firstName" | "lastName" | "guardNo">[]; submitLabel: string }) {
  const g = gateway;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Device mode" description="An operations gateway is the phone guards call. A guard device is the guard's own phone, which also reports whether the guard is inside the assigned site during a shift.">
        <ModeFields mode={g?.mode ?? "OPERATIONS_GATEWAY"} guardId={g?.guardId ?? ""} guards={guards} />
      </FormSection>
      <FormSection title="Phone" description="The app reports call metadata and, for guard devices, location events. It never records audio.">
        <Field label="Gateway name" required hint="Shown on the dashboard and on the phone."><Input name="deviceName" defaultValue={g?.deviceName ?? ""} placeholder="Control Room Phone 01" required /></Field>
        <Field label="SIM phone number" required hint="Operations gateway: the number guards dial. Guard device: the guard's own number."><Input name="phoneNumber" defaultValue={g?.phoneNumber ?? ""} placeholder="+263 77 123 4567" required /></Field>
        <Field label="Location" hint="Operations gateway: where the phone sits; unknown callers are filed here. Guard device: leave blank, the shift decides."><Select name="locationId" defaultValue={g?.locationId ?? ""}><option value="">Head office / unassigned</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.client.name}</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={g?.notes ?? ""} placeholder="Where the phone sits, who looks after it" /></Field>
      </FormSection>
    </ActionForm>
  );
}
