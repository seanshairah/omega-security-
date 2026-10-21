import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateLocation } from "@/actions/locations";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { LocationForm } from "@/components/client-location-forms";
import { guardDevicesForPicker, candidateFromRequest } from "@/lib/gateway/picker-devices";

export const metadata = { title: "Edit location" };
export default async function EditLocationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fromRequest?: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const { fromRequest } = await searchParams;
  const [location, clients, supervisors, guardDevices, gateways, candidate] = await Promise.all([db.location.findUnique({ where: { id } }), db.client.findMany({ orderBy: { name: "asc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }), guardDevicesForPicker(), db.gatewayDevice.findMany({ where: { mode: "OPERATIONS_GATEWAY", status: { notIn: ["REVOKED", "DISABLED"] } }, select: { id: true, deviceName: true }, orderBy: { deviceName: "asc" } }), fromRequest ? candidateFromRequest(fromRequest) : Promise.resolve(null)]);
  if (!location) notFound();
  return <div className="w-full"><PageHeader title={`Edit ${location.name}`} /><Card><CardBody><LocationForm action={updateLocation.bind(null, id)} location={location} clients={clients} supervisors={supervisors} submitLabel="Save changes" guardDevices={guardDevices} candidate={candidate} gateways={gateways} /></CardBody></Card></div>;
}
