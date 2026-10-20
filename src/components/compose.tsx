"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import type { MessageChannel } from "@prisma/client";
import { sendMessages, type Audience } from "@/actions/messages";
import type { SendOutcome } from "@/lib/messaging";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

type G = { id: string; name: string; phone: string; email: string | null; photoUrl: string | null; watched: boolean; status: string | null; location: string | null };
type L = { id: string; name: string };
type Props = { guards: G[]; locations: L[]; channels: { channel: MessageChannel; ready: boolean; note: string }[]; initialGuardId?: string };

const QUICK = [
  { label: "Confirm you are on post", body: "CONTROL ROOM: Please confirm you are on post. Reply YES if on site, NO if not." },
  { label: "Radio check", body: "CONTROL ROOM: Radio check. Reply 1 if all is well, 2 if you need assistance." },
  { label: "Relief delayed", body: "NOTICE: Your relief is delayed. Remain on post until handover is confirmed. Reply YES to acknowledge." },
  { label: "Report to office", body: "Please report to the Omega Protection Services office tomorrow at 08:00. Reply YES to confirm." },
];

export function Compose({ guards, locations, channels, initialGuardId }: Props) {
  const [channel, setChannel] = useState<MessageChannel>("SMS");
  const [mode, setMode] = useState<Audience["kind"]>(initialGuardId ? "guards" : "guards");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialGuardId ? [initialGuardId] : []));
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [results, setResults] = useState<SendOutcome[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => guards.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || g.phone.includes(q.replace(/\s/g, ""))), [guards, q]);
  const audience: Audience = mode === "guards" ? { kind: "guards", ids: [...selected] } : mode === "location" ? { kind: "location", locationId } : { kind: mode } as Audience;
  const count = mode === "guards" ? selected.size : mode === "onDuty" ? guards.filter((g) => g.status === "ON_DUTY" || g.status === "ASSISTANCE" || g.status === "INCIDENT" || g.status === "CRITICAL").length : mode === "live" ? guards.filter((g) => g.status).length : mode === "watched" ? guards.filter((g) => g.watched).length : mode === "allGuards" ? guards.length : null;
  const ch = channels.find((c) => c.channel === channel)!;
  const segments = Math.max(1, Math.ceil(body.length / (body.length > 160 ? 153 : 160)));
  const canSend = body.trim().length > 0 && (mode !== "guards" || selected.size > 0) && (channel !== "EMAIL" || subject.trim().length > 0) && !pending;

  const send = () => start(async () => {
    setErr(null); setResults(null);
    const r = await sendMessages({ channel, audience, body, subject });
    if (!r.ok) return setErr(r.error ?? "Failed");
    setResults(r.results ?? []);
  });

  const icon = { SMS: "sms", WHATSAPP: "forum", EMAIL: "mail" } as const;

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader title="Recipients" description="Pick people, or a group that is worked out when you send." />
        <CardBody className="space-y-3">
          <Select value={mode} onChange={(e) => setMode(e.target.value as Audience["kind"])}>
            <option value="guards">Specific guards</option>
            <option value="onDuty">Everyone on post now</option>
            <option value="live">Everyone with a live shift (incl. late / not confirmed)</option>
            <option value="location">Everyone at a location</option>
            <option value="watched">Watched guards</option>
            <option value="allGuards">All active guards</option>
            <option value="staff">Admins and supervisors</option>
          </Select>
          {mode === "location" && <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
          {mode === "guards" && (
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" />
              <div className="flex items-center justify-between text-[12px] text-ink-3"><span>{selected.size} selected</span><span className="flex gap-2"><button className="underline" onClick={() => setSelected(new Set(filtered.map((g) => g.id)))}>Select shown</button><button className="underline" onClick={() => setSelected(new Set())}>Clear</button></span></div>
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto rounded-[10px] border border-line scroll-thin">
                {filtered.map((g) => (
                  <li key={g.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2", selected.has(g.id) && "bg-accent-soft/50")}>
                      <input type="checkbox" className="accent-[#4f9f3a]" checked={selected.has(g.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n; })} />
                      <Avatar src={g.photoUrl} name={g.name} size={28} />
                      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{g.name}{g.watched ? <span className="ml-1.5 text-[10px] uppercase tracking-[0.06em] text-warn">watched</span> : null}</span><span className="block truncate text-[12px] text-ink-3">{g.location ? `${g.location} · ${g.status?.toLowerCase().replace("_", " ")}` : channel === "EMAIL" ? g.email ?? "no email" : g.phone}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {count !== null && mode !== "guards" && <p className="text-[13px] text-ink-2">{count} recipient{count === 1 ? "" : "s"} right now.</p>}
        </CardBody>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader title="Message" action={
            <div className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
              {channels.map((c) => { const I = icon[c.channel]; return <button key={c.channel} onClick={() => setChannel(c.channel)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium", channel === c.channel ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink")}><Icon name={I} size={14} filled />{c.channel === "SMS" ? "SMS" : c.channel === "WHATSAPP" ? "WhatsApp" : "Email"}</button>; })}
            </div>
          } />
          <CardBody className="space-y-3">
            {!ch.ready && <p className="rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-[#8a5e05]">{ch.note}</p>}
            {channel === "EMAIL" && <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "EMAIL" ? 10 : 6} maxLength={channel === "SMS" ? 480 : 4000} placeholder={channel === "SMS" ? "Keep it short. Guards reply with the keywords you give them." : "Type your message"} className="w-full resize-y rounded-[10px] border border-line px-3.5 py-3 text-[14px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-ink-3 tnum">{body.length} characters{channel === "SMS" ? ` · ${segments} SMS segment${segments === 1 ? "" : "s"} each` : ""}</span>
              <Button variant="primary" disabled={!canSend} onClick={send}><Icon name="send" size={14} filled /> {pending ? "Sending…" : `Send ${channel === "SMS" ? "SMS" : channel === "WHATSAPP" ? "WhatsApp" : "email"}`}</Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
              {QUICK.map((qm) => <button key={qm.label} onClick={() => setBody(qm.body)} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:bg-surface-2">{qm.label}</button>)}
            </div>
            {err && <p className="text-[13px] text-critical">{err}</p>}
          </CardBody>
        </Card>
        {results && (
          <Card>
            <CardHeader title={`Sent to ${results.filter((r) => r.ok).length} of ${results.length}`} description={results.some((r) => !r.ok) ? "Failures are listed with the gateway's reason." : "Every message was accepted by the gateway."} />
            <CardBody className="pt-3">
              <ul className="divide-y divide-line">{results.map((r, i) => <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]"><span>{r.name} <span className="text-ink-3 tnum">{r.to}</span></span>{r.ok ? <Status tone="ok">Sent</Status> : <span className="max-w-[60%] truncate text-critical" title={r.error}>{r.error}</span>}</li>)}</ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
