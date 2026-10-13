import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { EmergencyBanner } from "@/components/layout/emergency-banner";
import { activeProviderName } from "@/lib/sms";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [attention, incidents, unread, critical] = await Promise.all([
    db.shift.count({ where: { status: { in: ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"] } } }),
    db.incident.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    unreadCount(),
    db.shift.count({ where: { status: "CRITICAL" } }),
  ]);
  const provider = activeProviderName();
  const systemStatus = critical > 0
    ? { tone: "critical" as const, label: `${critical} emergency${critical > 1 ? " alerts" : " alert"}` }
    : attention > 0
      ? { tone: "warn" as const, label: `${attention} need${attention === 1 ? "s" : ""} attention` }
      : { tone: "ok" as const, label: provider === "simulated" ? "All systems operational · SMS simulated" : "All systems operational" };

  return (
    <div className="flex min-h-screen">
      <Sidebar counts={{ attention, incidents }} role={user.role} />
      <div className="min-w-0 flex-1 px-4 py-4 md:px-5">
        <Topbar user={user} unread={unread} systemStatus={systemStatus} />
        <EmergencyBanner />
        <main className="fade-in">{children}</main>
      </div>
    </div>
  );
}
