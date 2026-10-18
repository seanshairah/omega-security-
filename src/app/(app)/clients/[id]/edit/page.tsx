import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateClient } from "@/actions/locations";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ClientForm } from "@/components/client-location-forms";

export const metadata = { title: "Edit client" };
export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();
  return <div className="w-full"><PageHeader title={`Edit ${client.name}`} /><Card><CardBody><ClientForm action={updateClient.bind(null, id)} client={client} submitLabel="Save changes" /></CardBody></Card></div>;
}
