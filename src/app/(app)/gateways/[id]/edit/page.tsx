import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateGatewayAction } from "@/actions/gateways";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { GatewayForm } from "@/components/gateway-form";

export const metadata = { title: "Edit gateway" };
export default async function EditGatewayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const [gateway, locations, guards] = await Promise.all([db.gatewayDevice.findUnique({ where: { id } }), db.location.findMany({ where: { active: true }, include: { client: true }, orderBy: { name: "asc" } }), db.guard.findMany({ where: { active: true }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, guardNo: true } })]);
  if (!gateway) notFound();
  return <div className="max-w-4xl"><PageHeader title={`Edit ${gateway.deviceName}`} description="Reassigning the location changes where unknown callers are filed. The phone keeps its token." /><Card><CardBody><GatewayForm action={updateGatewayAction.bind(null, id)} gateway={gateway} locations={locations} guards={guards} submitLabel="Save changes" /></CardBody></Card></div>;
}
