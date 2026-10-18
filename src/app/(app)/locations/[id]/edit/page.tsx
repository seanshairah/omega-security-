import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateLocation } from "@/actions/locations";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { LocationForm } from "@/components/client-location-forms";

export const metadata = { title: "Edit location" };
export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const [location, clients, supervisors] = await Promise.all([db.location.findUnique({ where: { id } }), db.client.findMany({ orderBy: { name: "asc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  if (!location) notFound();
  return <div className="w-full"><PageHeader title={`Edit ${location.name}`} /><Card><CardBody><LocationForm action={updateLocation.bind(null, id)} location={location} clients={clients} supervisors={supervisors} submitLabel="Save changes" /></CardBody></Card></div>;
}
