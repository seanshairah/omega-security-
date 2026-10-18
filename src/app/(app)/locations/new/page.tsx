import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createLocation } from "@/actions/locations";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { LocationForm } from "@/components/client-location-forms";
import { guardDevicesForPicker } from "@/lib/gateway/picker-devices";

export const metadata = { title: "Add location" };
export default async function NewLocationPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  await requireUser("ADMIN");
  const { clientId } = await searchParams;
  const [clients, supervisors, guardDevices] = await Promise.all([db.client.findMany({ where: { active: true }, orderBy: { name: "asc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }), guardDevicesForPicker()]);
  return <div className="w-full"><PageHeader title="Add location" /><Card><CardBody><LocationForm action={createLocation} clients={clients} supervisors={supervisors} submitLabel="Add location" defaultClientId={clientId} guardDevices={guardDevices} /></CardBody></Card></div>;
}
