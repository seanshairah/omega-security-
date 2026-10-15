import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createGuard } from "@/actions/guards";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { GuardForm } from "@/components/guard-form";

export const metadata = { title: "Add guard" };

export default async function NewGuardPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { phone } = await searchParams;
  await requireUser("ADMIN");
  const [locations, supervisors] = await Promise.all([db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }), db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } })]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Add guard" description="A guard number is assigned automatically." />
      <Card><CardBody><GuardForm action={createGuard} locations={locations} supervisors={supervisors} submitLabel="Add guard" guard={phone ? ({ phone } as never) : undefined} /></CardBody></Card>
    </div>
  );
}
