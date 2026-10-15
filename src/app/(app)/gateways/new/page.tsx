import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createGatewayAction } from "@/actions/gateways";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { GatewayForm } from "@/components/gateway-form";

export const metadata = { title: "Register gateway" };
export default async function NewGatewayPage() {
  await requireUser("ADMIN");
  const locations = await db.location.findMany({ where: { active: true }, include: { client: true }, orderBy: { name: "asc" } });
  return <div className="max-w-4xl"><PageHeader title="Register a gateway phone" description="You get an activation code to type into the Security Gateway app on the phone." /><Card><CardBody><GatewayForm action={createGatewayAction} locations={locations} submitLabel="Register and get activation code" /></CardBody></Card></div>;
}
