import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { updateUser } from "@/actions/admin";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { UserForm } from "@/components/user-form";
export const metadata = { title: "Edit user" };
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("SUPER_ADMIN");
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) notFound();
  return <div className="w-full"><PageHeader title={`Edit ${user.name}`} /><Card><CardBody><UserForm action={updateUser.bind(null, id)} user={user} submitLabel="Save changes" /></CardBody></Card></div>;
}
