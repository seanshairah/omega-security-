import { requireUser, ROLE_LABEL } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { setUserActive } from "@/actions/admin";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser("SUPER_ADMIN");
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <div>
      <PageHeader title="Users" description="Administrators and supervisors who can sign in. Guards do not have accounts; they use SMS." actions={<LinkButton href="/users/new" variant="primary">Add user</LinkButton>} />
      <Card>
        <Table>
          <THead><tr><th>User</th><th>Role</th><th>Phone</th><th>Last sign-in</th><th>Status</th><th></th></tr></THead>
          <TBody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><div className="flex items-center gap-3"><Avatar src={u.avatarUrl} name={u.name} size={32} /><div><div className="font-medium text-ink">{u.name}{u.id === me.id && <span className="ml-2 text-[11px] uppercase tracking-[0.06em] text-ink-3">you</span>}</div><div className="text-[12px] text-ink-3">{u.email}{u.title ? ` · ${u.title}` : ""}</div></div></div></td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td className="tnum text-ink-2">{u.phone ?? "—"}</td>
                <td className="tnum text-ink-2">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</td>
                <td>{u.active ? <Status tone="ok">Active</Status> : <Status tone="muted">Deactivated</Status>}</td>
                <td className="text-right"><span className="inline-flex gap-1"><LinkButton href={`/users/${u.id}/edit`} size="sm">Edit</LinkButton>{u.id !== me.id && (u.active ? <ConfirmButton label="Deactivate" variant="danger" title={`Deactivate ${u.name}?`} body="They will be signed out and cannot sign in again until reactivated." confirmLabel="Deactivate" action={async () => { "use server"; await setUserActive(u.id, false); }} /> : <ConfirmButton label="Reactivate" title={`Reactivate ${u.name}?`} body="" confirmLabel="Reactivate" action={async () => { "use server"; await setUserActive(u.id, true); }} />)}</span></td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
