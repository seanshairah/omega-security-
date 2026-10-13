import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateGuard } from "@/actions/guards";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { GuardForm } from "@/components/guard-form";

export const metadata = { title: "Edit guard" };

export default async function EditGuardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("ADMIN");
  const { id } = await params;
  const [guard, locations, supervisors] = await Promise.all([db.guard.findUnique({ where: { id } }), db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  if (!guard) notFound();
  const action = updateGuard.bind(null, id);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${guard.firstName} ${guard.lastName}`} description={guard.guardNo} />
      <Card><CardBody><GuardForm action={action} guard={guard} locations={locations} supervisors={supervisors} submitLabel="Save changes" /></CardBody></Card>
    </div>
  );
}
