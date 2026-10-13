import { requireUser, can } from "@/lib/auth/rbac";
import { getSettings, SETTING_DEFS } from "@/lib/settings";
import { activeProviderName, PROVIDER_NAMES } from "@/lib/sms";
import { sendaiAccountStatus } from "@/lib/sms/providers/sendai";
import { updateSettings } from "@/actions/admin";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { Status } from "@/components/ui/status";

export const metadata = { title: "Settings" };
const GROUPS: { key: string; title: string; description: string }[] = [
  { key: "arrival", title: "Arrival check", description: "When the arrival SMS goes out and how long the system waits before reminding and escalating." },
  { key: "welfare", title: "Welfare check", description: "Where in the shift the welfare check fires and how long before a missed check is recorded." },
  { key: "completion", title: "End of shift", description: "How long to wait for a completion reply before closing the shift as unconfirmed." },
  { key: "handover", title: "Handover", description: "When both guards are told about the handover." },
  { key: "recurrence", title: "Recurring shifts", description: "How far ahead recurring patterns are turned into shifts." },
  { key: "general", title: "Company", description: "Names used in the portal and in messages." },
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
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Settings" description="Automation timings and SMS gateway. Timings apply to every shift from the next tick." />
      <Card>
        <CardHeader title="SMS gateway" description="Set through environment variables so secrets never live in the database." action={<Status tone={provider === "simulated" ? "neutral" : sendai?.ok && usable ? "ok" : sendai?.ok ? "warn" : "critical"}>{provider === "simulated" ? "Simulated" : sendai?.ok ? (usable ? "Connected" : "Connected · not ready to send") : "Not connected"}</Status>} />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Meta label="Provider">{provider}</Meta>
            <Meta label="Sender ID">{senderId || "—"}</Meta>
            <Meta label="Webhook URL"><code className="text-[12px]">/api/sms/webhook/{provider}</code></Meta>
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
              <p className="mt-3 text-[12px] text-ink-3">Inbound SMS must be enabled on the Sendai account; point its callback and delivery webhook at the URL above with the signing secret in SMS_WEBHOOK_SECRET.</p>
            </div>
          )}
        </CardBody>
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
                      <Field key={d.key} label={d.label} hint={d.description}><Input name={d.key} type={d.type === "number" ? "number" : "text"} min={0} defaultValue={values[d.key]} /></Field>
                    ))}
                  </div>
                </div>
              ))}
            </ActionForm>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{SETTING_DEFS.map((d) => <Meta key={d.key} label={d.label}>{values[d.key]}{d.type === "number" && d.key.includes("Minutes") ? " min" : d.key.includes("Percent") ? "%" : d.key.includes("Days") ? " days" : ""}</Meta>)}</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
