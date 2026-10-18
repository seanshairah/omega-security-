import { requireUser } from "@/lib/auth/rbac";
import { createClient } from "@/actions/locations";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { ClientForm } from "@/components/client-location-forms";

export const metadata = { title: "Add client" };
export default async function NewClientPage() {
  await requireUser("ADMIN");
  return <div className="w-full"><PageHeader title="Add client" /><Card><CardBody><ClientForm action={createClient} submitLabel="Add client" /></CardBody></Card></div>;
}
