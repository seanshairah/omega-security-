import { requireUser } from "@/lib/auth/rbac";
import { createUser } from "@/actions/admin";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { UserForm } from "@/components/user-form";
export const metadata = { title: "Add user" };
export default async function NewUserPage() {
  await requireUser("SUPER_ADMIN");
  return <div className="w-full"><PageHeader title="Add user" /><Card><CardBody><UserForm action={createUser} submitLabel="Add user" /></CardBody></Card></div>;
}
