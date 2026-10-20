import { requireUser, can } from "@/lib/auth/rbac";
import { getSettings, SETTING_DEFS } from "@/lib/settings";
import { activeProviderName, PROVIDER_NAMES } from "@/lib/sms";
import { sendaiAccountStatus } from "@/lib/sms/providers/sendai";
import { updateSettings } from "@/actions/admin";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Status } from "@/components/ui/status";
import { PushToggle } from "@/components/push-toggle";
import { pushConfigured } from "@/lib/push";

export const metadata = { title: "Settings" };
const GROUPS: { key: string; title: string; description: string }[] = [
  { key: "arrival", title: "Arrival check", description: "When the arrival SMS goes out and how long the system waits before reminding and escalating." },
  { key: "welfare", title: "Welfare check", description: "Where in the shift the welfare check fires and how long before a missed check is recorded." },
  { key: "completion", title: "End of shift", description: "How long to wait for a completion reply before closing the shift as unconfirmed." },
  { key: "handover", title: "Handover", description: "When both guards are told about the handover." },
  { key: "recurrence", title: "Recurring shifts", description: "How far ahead recurring patterns are turned into shifts." },
  { key: "general", title: "Company", description: "Names used in the portal and in messages." },
  { key: "checkin", title: "Call check-in", description: "The guard rings in at the start of a shift and the system asks their phone for a fresh GPS fix. Attendance is recorded only when the fix places them on site. A call on its own is never attendance." },
  { key: "geofence", title: "GPS and geofencing", description: "Guard devices check their position on this schedule during shifts. The phone applies the same rules offline; changes reach it with the next heartbeat." },
  { key: "gateway", title: "Call gateway", description: "Android gateway phones: how often they report in, when they count as offline, how long calls are kept, and which call alerts are raised." },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const values = await getSettings();
  const provider = activeProviderName();
  const sendai = provider === "sendai" ? await sendaiAccountStatus() : null;
  const editable = can.configureSystem(user);
  const senderId = process.env.SMS_SENDER_ID ?? "";
  const usable = sendai?.senderIds.find((s) => s.address === senderId && s.status === "active" && s.verification === "verified");

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Automation timings and SMS gateway. Timings apply to every shift from the next tick." />
      <Card>
        <CardHeader title="SMS gateway" description="Set through environment variables so secrets never live in the database." action={<Status tone={provider === "simulated" ? "neutral" : sendai?.ok && usable ? "ok" : sendai?.ok ? "warn" : "critical"}>{provider === "simulated" ? "Simulated" : sendai?.ok ? (usable ? "Connected" : "Connected · not ready to send") : "Not connected"}</Status>} />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Provider">{provider}</Meta>
            <Meta label="Sender ID">{senderId || "—"}</Meta>
            <Meta label="Webhook URL"><code className="break-all text-[12px]">/api/sms/webhook/{provider}</code></Meta>
            <Meta label="Supported">{PROVIDER_NAMES.join(", ")}</Meta>
          </div>
          {sendai && (
            <div className="mt-4 border-t border-dashed border-line pt-4">
              {!sendai.ok && <p className="text-[13px] text-critical">{sendai.error}</p>}
              {sendai.ok && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Balances</div>
                    <ul className="mt-1 text-[13px]">{sendai.balances.map((b) => <li key={b.currency} className="tnum">{b.currency} {b.amount.toFixed(2)}{b.amount <= 0 && <span className="ml-2 text-critical">top up to send</span>}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Sender identities</div>
                    {sendai.senderIds.length === 0 ? <p className="mt-1 text-[13px] text-critical">None registered. Register a sender ID (e.g. {senderId || "OMEGASEC"}) in the Sendai dashboard; approval takes about 30 minutes.</p> : <ul className="mt-1 text-[13px]">{sendai.senderIds.map((s) => <li key={s.address}><Status tone={s.status === "active" && s.verification === "verified" ? "ok" : "warn"}>{s.address} · {s.verification}</Status></li>)}</ul>}
                  </div>
                </div>
              )}
              {sendai.ok && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">WhatsApp sender</div>{sendai.identities.filter((i) => i.channel === "whatsapp").length === 0 ? <p className="mt-1 text-[13px] text-ink-2">None. Register a WhatsApp number in the Sendai dashboard to send WhatsApp from Compose.</p> : <ul className="mt-1 text-[13px]">{sendai.identities.filter((i) => i.channel === "whatsapp").map((i) => <li key={i.id}><Status tone={i.verification === "verified" ? "ok" : "warn"}>{i.address} · {i.verification}</Status></li>)}</ul>}</div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Email sender</div>{sendai.identities.filter((i) => i.channel === "email").length === 0 ? <p className="mt-1 text-[13px] text-ink-2">None. Register a sender email in the Sendai dashboard to send email from Compose.</p> : <ul className="mt-1 text-[13px]">{sendai.identities.filter((i) => i.channel === "email").map((i) => <li key={i.id}><Status tone={i.verification === "verified" ? "ok" : "warn"}>{i.address} · {i.verification}</Status></li>)}</ul>}</div>
                </div>
              )}
              <p className="mt-3 text-[12px] text-ink-3">Inbound SMS must be enabled on the Sendai account; point its callback and delivery webhook at the URL above with the signing secret in SMS_WEBHOOK_SECRET.</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Push notifications" description="Warnings, emergencies and anything about a watched guard are pushed to every browser that has turned this on." action={<Status tone={pushConfigured() ? "ok" : "neutral"}>{pushConfigured() ? "Configured" : "Not configured"}</Status>} />
        <CardBody><PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? null} /><p className="mt-2 text-[12px] text-ink-3">Each person enables it on each device they use. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY on the server to turn the feature on.</p></CardBody>
      </Card>

      <Card>
        <CardHeader title="Automation" description="Change a value and save. The engine reads settings every minute." />
        <CardBody>
          {editable ? (
            <ActionForm action={updateSettings} submitLabel="Save settings" successMessage="Settings saved.">
              {GROUPS.map((g) => (
                <div key={g.key} className="grid gap-4 border-t border-dashed border-line py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
                  <div><h3 className="text-[14px] font-semibold text-ink">{g.title}</h3><p className="mt-1 text-[13px] text-ink-2">{g.description}</p></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {SETTING_DEFS.filter((d) => d.group === g.key).map((d) => (
                      <Field key={d.key} label={d.label} hint={d.description}>{d.type === "boolean" ? <Select name={d.key} defaultValue={values[d.key]}><option value="true">Yes</option><option value="false">No</option></Select> : <Input name={d.key} type={d.type === "number" ? "number" : "text"} min={0} defaultValue={values[d.key]} />}</Field>
                    ))}
                  </div>
                </div>
              ))}
            </ActionForm>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{SETTING_DEFS.map((d) => <Meta key={d.key} label={d.label}>{d.type === "boolean" ? (values[d.key] === "true" ? "Yes" : "No") : values[d.key]}{d.type === "number" && d.key.includes("Minutes") ? " min" : d.key.includes("Seconds") ? " s" : d.key.includes("Percent") ? "%" : d.key.includes("Days") ? " days" : ""}</Meta>)}</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
