import { requireUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { LIVE_STATUSES } from "@/lib/services/shifts";
import { activeProviderName } from "@/lib/sms";
import { sendaiIdentities } from "@/lib/sms/providers/sendai";
import { PageHeader } from "@/components/ui/page";
import { Compose } from "@/components/compose";

export const metadata = { title: "Compose message" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ guardId?: string }> }) {
  await requireUser("ADMIN");
  const { guardId } = await searchParams;
  const [guards, locations, live] = await Promise.all([
    db.guard.findMany({ where: { active: true }, orderBy: [{ watched: "desc" }, { lastName: "asc" }] }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.shift.findMany({ where: { status: { in: LIVE_STATUSES } }, include: { location: true } }),
  ]);
  const liveByGuard = new Map(live.map((s) => [s.guardId, s]));
  const provider = activeProviderName();
  const ids = provider === "sendai" ? await sendaiIdentities() : [];
  const has = (c: string) => ids.some((i) => i.channel === c && i.status === "active" && i.verification === "verified");
  const channels = provider === "simulated"
    ? (["SMS", "WHATSAPP", "EMAIL"] as const).map((channel) => ({ channel, ready: true, note: "Simulated provider: nothing is really sent." }))
    : [
        { channel: "SMS" as const, ready: has("sms"), note: "No verified SMS sender ID on the Sendai account yet. Messages will be logged as failed until one is approved." },
        { channel: "WHATSAPP" as const, ready: has("whatsapp"), note: "WhatsApp needs a verified WhatsApp sender identity on the Sendai account and a verified account email. Until then sends fail with the gateway's reason." },
        { channel: "EMAIL" as const, ready: has("email"), note: "Email needs a verified email sender identity on the Sendai account. Guards also need an email address on their record." },
      ];
  return (
    <div>
      <PageHeader title="Compose message" description="Send a custom SMS, WhatsApp or email to one guard, a group, or everyone on post. Every message is logged." />
      <Compose
        guards={guards.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`, phone: g.phone, email: g.email, photoUrl: g.photoUrl, watched: g.watched, status: liveByGuard.get(g.id)?.status ?? null, location: liveByGuard.get(g.id)?.location.name ?? null }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        channels={channels}
        initialGuardId={guardId}
      />
    </div>
  );
}
