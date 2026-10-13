import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { markNotificationsRead } from "@/actions/admin";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUser();
  const rows = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const unread = rows.filter((n) => !n.readAt).length;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" description={`${unread} unread. Email, WhatsApp and push can be added as channels later.`} actions={unread > 0 && <form action={async () => { "use server"; await markNotificationsRead("all"); }}><Button type="submit">Mark all read</Button></form>} />
      <Card>
        <ul className="divide-y divide-line">
          {rows.length === 0 && <li className="px-5 py-10 text-center text-[13px] text-ink-3">Nothing yet.</li>}
          {rows.map((n) => {
            const href = n.incidentId ? `/incidents/${n.incidentId}` : n.shiftId ? `/shifts/${n.shiftId}` : n.guardId ? `/guards/${n.guardId}` : "/operations";
            return (
              <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3.5", !n.readAt && "bg-accent-soft/30")}>
                <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", n.severity === "CRITICAL" ? "bg-critical" : n.severity === "WARNING" ? "bg-warn" : "bg-ok")} />
                <div className="min-w-0 flex-1">
                  <Link href={href} className={cn("text-[14px] text-ink hover:underline", !n.readAt && "font-medium")}>{n.title}</Link>
                  <p className="text-[13px] text-ink-2">{n.body}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{ago(n.createdAt)}</p>
                </div>
                {n.readAt ? <Status tone="muted">Read</Status> : <form action={async () => { "use server"; await markNotificationsRead([n.id]); }}><button className="text-[12px] font-medium text-ink-2 underline hover:text-ink">Mark read</button></form>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
