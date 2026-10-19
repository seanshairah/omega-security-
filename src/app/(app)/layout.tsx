import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { AppShell } from "@/components/layout/app-shell";
import { EmergencyBanner } from "@/components/layout/emergency-banner";
import { activeProviderName } from "@/lib/sms";
import { simulatorEnabled } from "@/lib/env-check";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [attention, incidents, unread, critical, watched, alerts] = await Promise.all([
    db.shift.count({ where: { status: { in: ["LATE", "NOT_CONFIRMED", "ASSISTANCE", "INCIDENT", "CRITICAL"] } } }),
    db.incident.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    unreadCount(),
    db.shift.count({ where: { status: "CRITICAL" } }),
    db.guard.count({ where: { watched: true } }),
    db.guardAlert.count({ where: { status: "OPEN" } }),
  ]);
  const provider = activeProviderName();
  const systemStatus = critical > 0
    ? { tone: "critical" as const, label: `${critical} emergency${critical > 1 ? " alerts" : " alert"}` }
    : attention > 0
      ? { tone: "warn" as const, label: `${attention} need${attention === 1 ? "s" : ""} attention` }
      : { tone: "ok" as const, label: provider === "simulated" ? "All systems operational · SMS simulated" : "All systems operational" };

  return (
    <AppShell counts={{ attention, incidents, watched, alerts }} role={user.role} user={user} unread={unread} systemStatus={systemStatus} banner={<EmergencyBanner />} simulator={simulatorEnabled()}>
      {children}
    </AppShell>
  );
}
