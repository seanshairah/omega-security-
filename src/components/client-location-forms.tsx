import type { Client, Location, User } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection, Checkbox } from "@/components/ui/form";
import { SitePicker } from "@/components/map/site-picker";
import type { ActionState } from "@/actions/_helpers";

type A = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function ClientForm({ action, client, submitLabel }: { action: A; client?: Client | null; submitLabel: string }) {
  const c = client;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Client" description="A client can have several sites. Reports can be filtered per client.">
        <Field label="Code" required hint="Short and unique, e.g. WGM."><Input name="code" defaultValue={c?.code} required /></Field>
        <Field label="Company name" required><Input name="name" defaultValue={c?.name} required /></Field>
        <Field label="Industry"><Input name="industry" defaultValue={c?.industry ?? ""} placeholder="Retail, Mining, Education…" /></Field>
        <Field label="Address"><Input name="address" defaultValue={c?.address ?? ""} /></Field>
      </FormSection>
      <FormSection title="Contact">
        <Field label="Contact person"><Input name="contactName" defaultValue={c?.contactName ?? ""} /></Field>
        <Field label="Contact phone"><Input name="contactPhone" defaultValue={c?.contactPhone ?? ""} /></Field>
        <Field label="Contact email"><Input name="contactEmail" type="email" defaultValue={c?.contactEmail ?? ""} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={c?.notes ?? ""} /></Field>
      </FormSection>
    </ActionForm>
  );
}

const SITE_TYPES = ["Shopping mall", "Warehouse", "Mine", "Construction site", "School", "Office building", "Residential property", "Factory", "Farm", "Other"];

export function LocationForm({ action, location, clients, supervisors, submitLabel, defaultClientId }: { action: A; location?: Location | null; clients: Client[]; supervisors: User[]; submitLabel: string; defaultClientId?: string }) {
  const l = location;
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormSection title="Site" description="Used in every SMS to the guard, so keep the name short and recognisable.">
        <Field label="Site code" required><Input name="code" defaultValue={l?.code} placeholder="ABC-01" required /></Field>
        <Field label="Site name" required><Input name="name" defaultValue={l?.name} placeholder="ABC Warehouse" required /></Field>
        <Field label="Client" required><Select name="clientId" defaultValue={l?.clientId ?? defaultClientId ?? ""} required><option value="" disabled>Select a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Site type"><Select name="siteType" defaultValue={l?.siteType ?? ""}><option value="">—</option>{SITE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <Field label="Physical address" required className="sm:col-span-2"><Input name="address" defaultValue={l?.address} required /></Field>
      </FormSection>
      <FormSection title="Position and geofence" description="Needed for GPS verification from guard phones. Search for the site, click the map or drag the pin to its centre, and set how far from the centre still counts as on site. Coordinates can also be typed. Saving a changed fence raises the site's config version so guard phones pick it up.">
        <SitePicker names={{ lat: "latitude", lng: "longitude", radius: "geofenceRadiusM", source: "coordinatesSource", placeId: "placeId" }} initial={{ lat: l?.latitude ?? null, lng: l?.longitude ?? null, radiusM: l?.geofenceRadiusM ?? 150, source: l?.coordinatesSource ?? null, placeId: l?.placeId ?? null }} mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} height={480} />
        {l && <p className="sm:col-span-2 text-[12px] text-ink-3 tnum">Config version {l.configVersion}{l.coordinatesUpdatedAt ? ` · fence last changed ${l.coordinatesUpdatedAt.toLocaleString("en-GB", { timeZone: "Africa/Harare" })}` : ""}.</p>}
      </FormSection>
      <FormSection title="Cover" description="How many guards each shift needs and the usual pattern.">
        <Field label="Required guards" required><Input type="number" name="requiredGuards" min={1} max={50} defaultValue={l?.requiredGuards ?? 1} required /></Field>
        <Field label="Shift pattern"><Select name="shiftPattern" defaultValue={l?.shiftPattern ?? "NIGHT_12"}><option value="DAY_8">Day · 8 h</option><option value="NIGHT_8">Night · 8 h</option><option value="DAY_12">Day · 12 h</option><option value="NIGHT_12">Night · 12 h</option><option value="CUSTOM">Custom</option></Select></Field>
        <Field label="Supervisor"><Select name="supervisorId" defaultValue={l?.supervisorId ?? ""}><option value="">Unassigned</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      </FormSection>
      <FormSection title="Site contact and instructions">
        <Field label="Site contact person"><Input name="contactName" defaultValue={l?.contactName ?? ""} /></Field>
        <Field label="Site contact phone"><Input name="contactPhone" defaultValue={l?.contactPhone ?? ""} /></Field>
        <Field label="Special instructions" className="sm:col-span-2"><Textarea name="specialInstructions" defaultValue={l?.specialInstructions ?? ""} placeholder="Patrol routes, keys, radio channels, who to call" /></Field>
      </FormSection>
      <FormSection title="Client site-status updates" description="Text the client as the shift progresses. Uses the number below, else the site contact, else the client's contact phone.">
        <Checkbox name="clientUpdates" label="Send SMS updates to the client for this site" hint="Off by default. Each message is logged under Message logs." defaultChecked={l?.clientUpdates ?? false} className="sm:col-span-2" />
        <Field label="Client update number" hint="Leave blank to use the site or client contact phone." className="sm:col-span-2"><Input name="clientUpdatePhone" defaultValue={l?.clientUpdatePhone ?? ""} placeholder="+263 7…" /></Field>
        <Checkbox name="notifyClientArrival" label="Guard has arrived" hint="When the guard confirms arrival." defaultChecked={l?.notifyClientArrival ?? true} />
        <Checkbox name="notifyClientWelfare" label="Everything going well" hint="When the mid-shift welfare check comes back fine." defaultChecked={l?.notifyClientWelfare ?? true} />
        <Checkbox name="notifyClientCompletion" label="Shift ended" hint="When the shift is completed or closed." defaultChecked={l?.notifyClientCompletion ?? true} />
      </FormSection>
    </ActionForm>
  );
}
