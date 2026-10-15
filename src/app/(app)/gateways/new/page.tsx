import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createGatewayAction } from "@/actions/gateways";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { GatewayForm } from "@/components/gateway-form";

export const metadata = { title: "Register gateway" };
export default async function NewGatewayPage() {
  await requireUser("ADMIN");
  const [locations, guards] = await Promise.all([db.location.findMany({ where: { active: true }, include: { client: true }, orderBy: { name: "asc" } }), db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, guardNo: true } })]);
  return <div className="max-w-4xl"><PageHeader title="Register a device" description="An operations gateway phone or a guard's own phone. You get an activation code to type into the Security Gateway app." /><Card><CardBody><GatewayForm action={createGatewayAction} locations={locations} guards={guards} submitLabel="Register and get activation code" /></CardBody></Card></div>;
}
