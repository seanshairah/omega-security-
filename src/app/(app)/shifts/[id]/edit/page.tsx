import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateShift } from "@/actions/shifts";
import { PageHeader, Explainer } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/form";
import { ShiftTimePicker } from "@/components/shift-time-picker";
import { Status } from "@/components/ui/status";
import { dateInputValue, timeInputValue } from "@/lib/time";
import { GeofenceOverrideSection } from "@/components/map/site-picker";
import { ShiftSiteSelect } from "@/components/shift-site-select";
import { editPolicy } from "@/lib/shift-edit";

export const metadata = { title: "Edit shift" };

export default async function EditShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const { id } = await params;
  const shift = await db.shift.findUnique({ where: { id }, include: { guard: true, location: true, attendance: true } });
  if (!shift) notFound();

  const policy = editPolicy({ status: shift.status, arrivalConfirmedAt: shift.attendance?.arrivalConfirmedAt ?? null, arrivalSmsSentAt: shift.arrivalSmsSentAt });
  const guardName = `${shift.guard.firstName} ${shift.guard.lastName}`;

  if (!policy.canEdit) {
    return (
      <div className="w-full">
        <PageHeader title="Edit shift" description={`${guardName} · ${shift.location.name}`} />
        <Card><CardBody>
          <Status tone="critical">Cannot be edited</Status>
          <p className="mt-2 text-[13px] text-ink-2">{policy.reason}</p>
          <Link href={`/shifts/${id}`} className="mt-3 inline-block text-[13px] font-medium text-accent-strong underline">Back to the shift</Link>
        </CardBody></Card>
      </div>
    );
  }

  const [guards, locations, supervisors] = await Promise.all([
    db.guard.findMany({ where: { OR: [{ active: true, employmentStatus: "ACTIVE" }, { id: shift.guardId }] }, orderBy: { lastName: "asc" } }),
    db.location.findMany({ where: { OR: [{ active: true }, { id: shift.locationId }] }, include: { client: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const locked = !policy.canMoveSchedule;

  return (
    <div className="w-full">
      <PageHeader title="Edit shift" description={`${guardName} · ${shift.location.name} · ${dateInputValue(shift.startAt)}`} />
      <Card><CardBody>
        {locked && (
          <div className="mb-4 rounded-[8px] border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-[#8a5e05]">
            <span className="font-semibold">Schedule locked.</span> {policy.reason}
          </div>
        )}
        <ActionForm action={updateShift.bind(null, id)} submitLabel="Save changes">
          <FormSection title="Who and where" description={locked ? "Fixed for this shift. The instructions, notes, supervisor and geofence below can still be corrected." : "The guard receives all automated checks on their registered phone."}>
            <Field label="Guard" required>
              <Select name="guardId" defaultValue={shift.guardId} required disabled={locked}>
                {guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName} · {g.guardNo}</option>)}
              </Select>
              {locked && <input type="hidden" name="guardId" value={shift.guardId} />}
            </Field>
            {locked ? (
              <Field label="Site"><Input value={shift.location.name} readOnly disabled /><input type="hidden" name="locationId" value={shift.locationId} /></Field>
            ) : (
              <ShiftSiteSelect sites={locations.map((l) => ({ id: l.id, name: l.name, clientName: l.client.name, latitude: l.latitude, longitude: l.longitude, radiusM: l.geofenceRadiusM, source: l.coordinatesSource, configVersion: l.configVersion }))} defaultValue={shift.locationId} canEditSites={can.manageLocations(user)} />
            )}
            <Field label="Supervisor" hint="Defaults to the site's supervisor.">
              <Select name="supervisorId" defaultValue={shift.supervisorId ?? ""}><option value="">Site supervisor</option>{supervisors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            </Field>
          </FormSection>

          <FormSection title="When" description={locked ? "Fixed once the shift has started or the guard has been checked." : "Overnight shifts end the next day automatically."}>
            <Field label="Date" required><Input type="date" name="date" defaultValue={dateInputValue(shift.startAt)} required disabled={locked} />{locked && <input type="hidden" name="date" value={dateInputValue(shift.startAt)} />}</Field>
            <div className="sm:col-span-2">
              {locked
                ? <><Field label="Times"><Input value={`${timeInputValue(shift.startAt)}–${timeInputValue(shift.endAt)}`} readOnly disabled /></Field><input type="hidden" name="startTime" value={timeInputValue(shift.startAt)} /><input type="hidden" name="endTime" value={timeInputValue(shift.endAt)} /></>
                : <ShiftTimePicker defaultStart={timeInputValue(shift.startAt)} defaultEnd={timeInputValue(shift.endAt)} />}
            </div>
          </FormSection>

          <FormSection title="Geofence for this shift" description="By default the guard's phone is judged against the site's own geofence. Override it only when this shift's post is somewhere else.">
            <Explainer title="What changing this does" className="sm:col-span-2">
              <p>Saving a changed geofence or schedule raises this shift&apos;s config version, which is how the guard&apos;s phone knows to re-download it. A phone that is offline picks the change up when it reconnects.</p>
            </Explainer>
            <GeofenceOverrideSection
              initial={{ enabled: shift.geofenceLatitude != null, lat: shift.geofenceLatitude, lng: shift.geofenceLongitude, radiusM: shift.geofenceRadiusM, note: shift.geofenceNote }}
              mapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
              siteRadius={shift.location.geofenceRadiusM}
              siteName={shift.location.name}
            />
          </FormSection>

          <FormSection title="Instructions" description="Shown on the shift record. Site instructions are included automatically.">
            <Field label="Shift instructions" className="sm:col-span-2"><Textarea name="instructions" defaultValue={shift.instructions ?? ""} placeholder="Anything specific to this shift" /></Field>
            <Field label="Internal notes" className="sm:col-span-2"><Textarea name="notes" className="min-h-16" defaultValue={shift.notes ?? ""} placeholder="Not shown to the guard" /></Field>
          </FormSection>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
