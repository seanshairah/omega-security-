import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { TEMPLATE_DEFS, renderTemplate } from "@/lib/sms/templates";
import { updateTemplate, resetTemplate } from "@/actions/admin";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Message templates" };
const SAMPLE = { guard_name: "John Moyo", location: "ABC Warehouse", start_time: "18:00", end_time: "06:00", supervisor_name: "Tawanda Mhlanga", date: "13 Oct 2026", company: "Omega Protection Services", other_guard: "Peter Ncube", client_name: "ABC Logistics", site: "ABC Warehouse", time: "18:04", control_phone: "+263 772 100 100", incident_no: "INC-0042" };

export default async function TemplatesPage() {
  const user = await requireUser();
  const rows = await db.messageTemplate.findMany();
  const map = new Map(rows.map((r) => [r.key, r]));
  const editable = can.configureSystem(user);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Message templates" description="What guards receive at each step. Variables in double braces are filled in from the shift." />
      <div className="mb-4 rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">Variables: {["guard_name", "location", "start_time", "end_time", "supervisor_name", "date", "company", "other_guard"].map((v) => <code key={v} className="mr-2 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink">{`{{${v}}}`}</code>)}</div>
      <div className="min-w-0 space-y-4">
        {TEMPLATE_DEFS.map((t) => {
          const body = map.get(t.key)?.body ?? t.body;
          const changed = body !== t.body;
          return (
            <Card key={t.key}>
              <CardHeader title={t.name} description={t.description} action={changed && editable ? <form action={async () => { "use server"; await resetTemplate(t.key); }}><Button type="submit" size="sm" variant="ghost">Reset to default</Button></form> : undefined} />
              <CardBody>
                {editable ? (
                  <ActionForm action={updateTemplate.bind(null, t.key)} submitLabel="Save" successMessage="Saved." className="[&>div:last-child]:mt-3 [&>div:last-child]:border-0 [&>div:last-child]:pt-0">
                    <Textarea name="body" defaultValue={body} className="min-h-20 font-mono text-[13px]" />
                    <p className="mt-2 text-[12px] text-ink-3">Preview: <span className="text-ink-2">{renderTemplate(body, SAMPLE)}</span> · {body.length} characters{body.length > 160 ? ` · ${Math.ceil(body.length / 153)} SMS segments` : ""}</p>
                  </ActionForm>
                ) : <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-ink">{renderTemplate(body, SAMPLE)}</p>}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
