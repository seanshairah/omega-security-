import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createShift } from "@/actions/shifts";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import { ShiftTimePicker } from "@/components/shift-time-picker";
import { dateInputValue } from "@/lib/time";
import { GeofenceOverrideSection } from "@/components/map/site-picker";
import { ShiftSiteSelect } from "@/components/shift-site-select";

export const metadata = { title: "New shift" };

export default async function NewShiftPage({ searchParams }: { searchParams: Promise<{ guardId?: string; locationId?: string; date?: string }> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const [guards, locations, supervisors] = await Promise.all([
    db.guard.findMany({ where: { active: true, employmentStatus: "ACTIVE" }, orderBy: { lastName: "asc" } }),
    db.location.findMany({ where: { active: true }, include: { client: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="w-full">
      <PageHeader title="New shift" description="Assign a guard to a site for one shift. Overnight shifts end the next day automatically." />
      <Card><CardBody>
        <ActionForm action={createShift} submitLabel="Create shift">
          <FormSection title="Who and where" description="The guard receives all automated checks on their registered phone.">
            <Field label="Guard" required><Select name="guardId" defaultValue={sp.guardId ?? ""} required><option value="" disabled>Select a guard</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName} · {g.guardNo}</option>)}</Select></Field>
            <ShiftSiteSelect sites={locations.map((l) => ({ id: l.id, name: l.name, clientName: l.client.name, latitude: l.latitude, longitude: l.longitude, radiusM: l.geofenceRadiusM, source: l.coordinatesSource, configVersion: l.configVersion }))} defaultValue={sp.locationId} canEditSites={can.manageLocations(user)} />
            <Field label="Supervisor" hint="Defaults to the site's supervisor."><Select name="supervisorId" defaultValue=""><option value="">Site supervisor</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </FormSection>
          <FormSection title="When" description="Pick a preset or set custom times. The duration and welfare-check midpoint are calculated.">
            <Field label="Date" required><Input type="date" name="date" defaultValue={sp.date ?? dateInputValue(new Date())} required /></Field>
            <div className="sm:col-span-2"><ShiftTimePicker /></div>
          </FormSection>
          <FormSection title="Geofence for this shift" description="By default the guard's phone is judged against the site's own geofence. Override it only when this shift's post is somewhere else.">
            <GeofenceOverrideSection initial={{ enabled: false, lat: null, lng: null, radiusM: null, note: null }} mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY} siteRadius={150} />
          </FormSection>
          <FormSection title="Instructions" description="Shown on the shift record. Site instructions are included automatically.">
            <Field label="Shift instructions" className="sm:col-span-2"><Textarea name="instructions" placeholder="Anything specific to this shift" /></Field>
            <Field label="Internal notes" className="sm:col-span-2"><Textarea name="notes" className="min-h-16" placeholder="Not shown to the guard" /></Field>
          </FormSection>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
