import type { Client, Location, User } from "@prisma/client";
import { Explainer } from "@/components/ui/page";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection, Checkbox } from "@/components/ui/form";
import { SitePicker, type PickerGuardDevice, type PickerCandidate } from "@/components/map/site-picker";
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

export function LocationForm({ action, location, clients, supervisors, submitLabel, defaultClientId, guardDevices, candidate, gateways = [] }: { action: A; location?: Location | null; clients: Client[]; supervisors: User[]; submitLabel: string; defaultClientId?: string; guardDevices?: PickerGuardDevice[]; candidate?: PickerCandidate | null; gateways?: { id: string; deviceName: string }[] }) {
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
      <FormSection title="Position and geofence" description="Where the site centre is, and how far from it still counts as on site. Without coordinates, GPS verification stays off for this site.">
        <Explainer title="How a position gets here, and what happens when you save" className="sm:col-span-2">
          <p><strong>Map</strong> — search, click or drag the pin.</p>
          <p><strong>Use my current location</strong> — measures the device running this portal, so only trust it if you are standing at the site.</p>
          <p><strong>Request guard phone position</strong> — asks a registered guard phone at the site for a fresh GPS fix.</p>
          <p>Measured positions are shown for confirmation first; nothing is saved until you confirm. Saving a changed fence raises the site&apos;s config version, which is how guard phones pick it up.</p>
        </Explainer>
        <SitePicker names={{ lat: "latitude", lng: "longitude", radius: "geofenceRadiusM", source: "coordinatesSource", placeId: "placeId" }} initial={{ lat: l?.latitude ?? null, lng: l?.longitude ?? null, radiusM: l?.geofenceRadiusM ?? 150, source: l?.coordinatesSource ?? null, placeId: l?.placeId ?? null }} mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} height={480} guardDevices={guardDevices} locationId={l?.id ?? null} candidate={candidate ?? null} />
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
        <Checkbox name="notifyClientLate" label="Guard running late" hint="After the supervisor has been told, if the guard is still not verified on site." defaultChecked={l?.notifyClientLate ?? false} />
        <Checkbox name="notifyClientAbsent" label="Guard absent or check-in missed" hint="When the check-in escalates with no evidence the guard is on site." defaultChecked={l?.notifyClientAbsent ?? false} />
        <Checkbox name="notifyClientOutside" label="Guard outside the site (draft for approval)" hint="Never sent on its own: a supervisor reviews and approves the message first." defaultChecked={l?.notifyClientOutside ?? false} />
        <Checkbox name="notifyClientEmergency" label="Emergency (draft for approval)" hint="Internal escalation first; the client message waits for a supervisor's approval." defaultChecked={l?.notifyClientEmergency ?? false} />
        <Field label="Client update email" hint="Optional. Used when an update is sent by email instead of SMS." className="sm:col-span-2"><Input name="clientUpdateEmail" type="email" defaultValue={l?.clientUpdateEmail ?? ""} placeholder="security@client.co.zw" /></Field>
      </FormSection>
      <FormSection title="Welfare checks" description="Leave both times and interval empty for one welfare text in the middle of each shift. A connected call is not a response: only a key press, a reply, or a person confirming settles a check.">
        <Field label="Check at" hint="Local times, 24-hour, e.g. 00:00, 03:00. Overnight shifts get both."><Input name="welfareTimes" defaultValue={l?.welfareTimes ?? ""} placeholder="00:00, 03:00" /></Field>
        <Field label="Or every (minutes)" hint="From the shift start. 15 at least."><Input type="number" name="welfareIntervalMinutes" min={15} max={720} defaultValue={l?.welfareIntervalMinutes ?? ""} placeholder="120" /></Field>
        <Field label="Ask by">
          <Select name="welfareChannel" defaultValue={l?.welfareChannel ?? "SMS"}>
            <option value="SMS">SMS: the guard replies 1</option>
            <option value="GATEWAY_CALL">Call from the operations phone: the operator confirms</option>
            <option value="VOICE">Automated call: the guard presses 1, 2 or 3 (needs a voice provider)</option>
          </Select>
        </Field>
        <Field label="Tries before escalating" hint="Calls or texts, each one waiting for an answer."><Input type="number" name="welfareMaxAttempts" min={1} max={5} defaultValue={l?.welfareMaxAttempts ?? 2} /></Field>
        <Field label="Minutes between calls"><Input type="number" name="welfareRetryMinutes" min={2} max={60} defaultValue={l?.welfareRetryMinutes ?? 10} /></Field>
        <Checkbox name="welfareSmsFallback" label="Text the guard before escalating an unanswered call" hint="Skipped for guards with SMS confirmation turned off." defaultChecked={l?.welfareSmsFallback ?? true} />
      </FormSection>
      <FormSection title="Calling guards from the portal" description="The operations phone that rings guards at this site when someone presses Call guard. Any other eligible phone can still be chosen at the time.">
        <Field label="Default gateway phone" className="sm:col-span-2">
          <Select name="defaultGatewayId" defaultValue={l?.defaultGatewayId ?? ""}>
            <option value="">No default: use a phone registered at this site, else any available one</option>
            {gateways.map((g) => <option key={g.id} value={g.id}>{g.deviceName}</option>)}
          </Select>
        </Field>
      </FormSection>
    </ActionForm>
  );
}
