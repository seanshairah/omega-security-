"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientNotificationType, MessageChannel } from "@prisma/client";
import { Icon } from "@/components/ui/icon";
import { Button, buttonClass } from "@/components/ui/button";
import { Select, Textarea, Input } from "@/components/ui/form";
import { Status, type Tone } from "@/components/ui/status";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { CHANNEL_NAME, containsCoordinates } from "@/lib/client-notifications/policy";
import type { NotificationView } from "@/lib/client-notifications/service";

/**
 * "Notify client": one composer, used wherever a client can be told something, so every page sends
 * the same way. The client and site come from the shift, guard, incident or site it is opened on;
 * the recipient is picked from the numbers and emails already on the site or client record.
 */
export function NotifyClientButton({ shiftId, guardId, incidentId, locationId, size = "md", variant = "secondary", label = "Notify client", className }: {
  shiftId?: string | null; guardId?: string | null; incidentId?: string | null; locationId?: string | null;
  size?: "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size, className)}>
        <Icon name="outgoing_mail" size={size === "sm" ? 15 : 16} /> {label}
      </button>
      {open && <Composer target={{ shiftId: shiftId ?? null, guardId: guardId ?? null, incidentId: incidentId ?? null, locationId: locationId ?? null }} onClose={() => setOpen(false)} />}
    </>
  );
}

type TypeDraft = { type: ClientNotificationType; label: string; sensitive: boolean; mode: "SEND" | "DRAFT"; body: string; subject: string };
type Recipient = { channel: MessageChannel; address: string; label: string; available: boolean };
type Context = {
  client: { id: string; name: string }; site: { id: string; name: string };
  guard: { id: string; name: string } | null; incident: { id: string; incidentNo: string } | null;
  shift: { id: string; startAt: string; endAt: string; status: string } | null;
  recipients: Recipient[]; types: TypeDraft[]; suggested: ClientNotificationType;
};
type Target = { shiftId: string | null; guardId: string | null; incidentId: string | null; locationId: string | null };

function Composer({ target, onClose }: { target: Target; onClose: () => void }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [type, setType] = useState<ClientNotificationType | "">("");
  const [recipientKey, setRecipientKey] = useState("");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [edited, setEdited] = useState(false);
  const [result, setResult] = useState<NotificationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());
  const alive = useRef(true);
  // Set on every mount, not only the first: React's dev double-mount runs the cleanup once in between.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const qs = new URLSearchParams(Object.entries(target).filter(([, v]) => v) as [string, string][]).toString();
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/client-notifications/context?${qs}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!alive.current) return;
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      const c = j as Context;
      setCtx(c);
      const first = c.types.find((t) => t.type === c.suggested) ?? c.types[0];
      setType(first.type); setMessage(first.body); setSubject(first.subject);
      const r = c.recipients.find((x) => x.available);
      if (r) setRecipientKey(`${r.channel}|${r.address}`);
    })();
  }, [qs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Follow the message until the provider reports delivery or failure, for up to a minute.
  const polls = useRef(0);
  useEffect(() => {
    if (!result || result.settled || result.status === "PENDING_APPROVAL" || polls.current >= 20) return;
    const t = setTimeout(async () => {
      polls.current++;
      const res = await fetch(`/api/client-notifications/${result.id}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (alive.current && res.ok) setResult(j.notification);
    }, 3000);
    return () => clearTimeout(t);
  }, [result]);

  const current = ctx?.types.find((t) => t.type === type) ?? null;
  const recipient = ctx?.recipients.find((r) => `${r.channel}|${r.address}` === recipientKey) ?? null;
  const pickType = (t: ClientNotificationType) => {
    setType(t);
    const d = ctx?.types.find((x) => x.type === t);
    if (d && !edited) { setMessage(d.body); setSubject(d.subject); }
  };
  const useTemplate = () => { if (current) { setMessage(current.body); setSubject(current.subject); setEdited(false); } };
  const hasCoords = useMemo(() => containsCoordinates(message), [message]);
  const segments = Math.max(1, Math.ceil(message.length / 153));

  const send = useCallback(async () => {
    if (!recipient || !type) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/client-notifications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...target, type, channel: recipient.channel, recipient: recipient.address, message, subject: recipient.channel === "EMAIL" ? subject : null, idempotencyKey: key.current }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      polls.current = 0;
      setResult(j.notification);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [recipient, type, target, message, subject, router]);

  const again = () => { key.current = newKey(); setResult(null); setError(null); };
  const usable = ctx?.recipients.filter((r) => r.available) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="notify-title" className="flex max-h-[92dvh] w-full max-w-[520px] flex-col rounded-t-[14px] border border-line bg-surface shadow-xl sm:rounded-[14px]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="notify-title" className="min-w-0 truncate text-[15px] font-semibold text-ink">Notify client</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><Icon name="close" size={18} /></button>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4">
          {!ctx && !error && <p className="text-[13px] text-ink-3">Finding the client for this site…</p>}

          {ctx && (
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px]">
              <dt className="text-ink-3">Client</dt><dd className="min-w-0 truncate font-medium text-ink">{ctx.client.name}</dd>
              <dt className="text-ink-3">Site</dt><dd className="min-w-0 truncate text-ink">{ctx.site.name}</dd>
              {ctx.guard && <><dt className="text-ink-3">Guard</dt><dd className="min-w-0 truncate text-ink">{ctx.guard.name}</dd></>}
              {ctx.shift && <><dt className="text-ink-3">Shift</dt><dd className="text-ink tabular-nums">{fmtTime(ctx.shift.startAt)}–{fmtTime(ctx.shift.endAt)}</dd></>}
              {ctx.incident && <><dt className="text-ink-3">Incident</dt><dd className="text-ink">{ctx.incident.incidentNo}</dd></>}
            </dl>
          )}

          {ctx && !result && (
            <>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">About</span>
                <Select value={type} onChange={(e) => pickType(e.target.value as ClientNotificationType)}>
                  {ctx.types.map((t) => <option key={t.type} value={t.type}>{t.label}{t.mode === "DRAFT" ? " (needs approval)" : ""}</option>)}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">To</span>
                <Select value={recipientKey} onChange={(e) => setRecipientKey(e.target.value)} disabled={!usable.length}>
                  {ctx.recipients.map((r) => (
                    <option key={`${r.channel}|${r.address}`} value={`${r.channel}|${r.address}`} disabled={!r.available}>
                      {CHANNEL_NAME[r.channel]} · {r.address} · {r.label}{r.available ? "" : " (not available)"}
                    </option>
                  ))}
                  {!ctx.recipients.length && <option value="">No client number or email on record</option>}
                </Select>
                {!ctx.recipients.length && <span className="mt-1 block text-[12px] text-ink-3">Add a client-update number or email to the site, then try again.</span>}
              </label>
              {recipient?.channel === "EMAIL" && (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-ink-2">Subject</span>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
                </label>
              )}
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-[12px] font-medium text-ink-2">
                  <span>Message</span>
                  <span className="font-normal text-ink-3 tabular-nums">{message.length} chars{recipient?.channel === "SMS" ? ` · ${segments} SMS` : ""}</span>
                </span>
                <Textarea value={message} onChange={(e) => { setMessage(e.target.value); setEdited(true); }} maxLength={900} className="min-h-28" />
                {edited && <button type="button" onClick={useTemplate} className="mt-1 text-[12px] font-medium text-accent hover:underline">Use the template text</button>}
              </label>
              {hasCoords && (
                <p className="flex gap-2 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                  <Icon name="warning" size={15} className="mt-0.5 text-warn" />
                  <span>This looks like map coordinates. Client messages describe the post, not where a phone is. Only the super admin can send coordinates.</span>
                </p>
              )}
              <p className="flex gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                <Icon name="info" size={15} className="mt-0.5 text-ink-3" />
                <span>
                  {current?.mode === "DRAFT"
                    ? `Saved for approval. Nothing is sent until ${current.sensitive ? "the super admin" : "an operations admin"} approves it.`
                    : `Sends now${recipient ? ` by ${CHANNEL_NAME[recipient.channel]}` : ""}. "Sent" means the provider accepted it; "Delivered" appears only when the provider reports it.`}
                </span>
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={send} disabled={busy || !recipient || message.trim().length < 10}>
                  <Icon name={current?.mode === "DRAFT" ? "drafts" : "send"} size={16} /> {busy ? "Sending…" : current?.mode === "DRAFT" ? "Save for approval" : "Send"}
                </Button>
              </div>
            </>
          )}

          {result && <NotificationResult n={result} following={!result.settled && result.status !== "PENDING_APPROVAL" && polls.current < 20} />}
          {result && (
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={again}>Send another</Button>
              <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
          )}

          {error && <p role="alert" className="rounded-[10px] bg-critical-soft px-3 py-2.5 text-[13px] text-[#b3301a]">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function NotificationResult({ n, following }: { n: NotificationView; following: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Status tone={n.tone as Tone} pulse={following}>{n.statusLabel}</Status>
        <span className="truncate text-[12px] text-ink-3">{CHANNEL_NAME[n.channel]} · {n.recipient}</span>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        {n.status === "PENDING_APPROVAL" && "Saved. Nothing has been sent. It is listed under the client's messages for approval."}
        {n.status === "QUEUED" && "Handing it to the provider."}
        {n.status === "SENT" && (following ? "The provider accepted it. Waiting for a delivery report." : "The provider accepted it. No delivery report yet; some networks never send one.")}
        {n.status === "DELIVERED" && "The provider reported it delivered."}
        {n.status === "FAILED" && `Not delivered: ${n.failureReason ?? "unknown error"}.`}
      </p>
      <p className="mt-2 whitespace-pre-wrap rounded-[10px] border border-line px-3 py-2 text-[13px] text-ink">{n.message}</p>
    </div>
  );
}

/** The history of messages to a client or site, newest first, with approve and discard on drafts. */
export function ClientNotificationList({ items, role, showSite = true, empty = "No messages to this client yet." }: { items: NotificationView[]; role: "SUPER_ADMIN" | "ADMIN" | "SUPERVISOR"; showSite?: boolean; empty?: string }) {
  if (!items.length) return <p className="px-4 py-6 text-center text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => <NotificationRow key={n.id} n={n} role={role} showSite={showSite} />)}
    </ul>
  );
}

function NotificationRow({ n, role, showSite }: { n: NotificationView; role: string; showSite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(n.status === "PENDING_APPROVAL");
  const [text, setText] = useState(n.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayApprove = n.status === "PENDING_APPROVAL" && (role === "SUPER_ADMIN" || (role === "ADMIN" && !n.sensitive));

  const act = async (what: "approve" | "discard") => {
    setBusy(true); setError(null);
    const res = await fetch(`/api/client-notifications/${n.id}/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(what === "approve" ? { message: text } : {}) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
    router.refresh();
  };

  const by = n.sentBy ? n.sentBy : n.rule ? "Automatic rule" : "System";
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left" aria-expanded={open}>
        <Icon name={n.channel === "EMAIL" ? "mail" : "sms"} size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13.5px] font-medium text-ink">{n.typeLabel}</span>
            <Status tone={n.tone as Tone}>{n.statusLabel}</Status>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">
            {fmtDateTime(n.sentAt ?? n.createdAt)} · {n.recipient}{showSite && n.site ? ` · ${n.site.name}` : ""}{n.guard ? ` · ${n.guard.name}` : ""} · {by}{n.approvedBy && n.status !== "DISCARDED" ? `, approved by ${n.approvedBy}` : ""}
          </span>
        </span>
        <Icon name={open ? "keyboard_arrow_up" : "keyboard_arrow_down"} size={18} className="shrink-0 text-ink-3" />
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-7">
          {mayApprove ? (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={900} className="min-h-24 text-[13px]" />
          ) : (
            <p className="whitespace-pre-wrap rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-ink">{n.message}</p>
          )}
          {n.failureReason && <p className="text-[12.5px] text-[#b3301a]">Not delivered: {n.failureReason}</p>}
          <p className="text-[12px] text-ink-3">
            {n.incident ? <>Incident <a className="text-accent hover:underline" href={`/incidents/${n.incident.id}`}>{n.incident.incidentNo}</a> · </> : null}
            {n.shiftId ? <><a className="text-accent hover:underline" href={`/shifts/${n.shiftId}`}>Shift</a> · </> : null}
            {n.rule ? `Rule ${n.rule.replace(/^auto:/, "").toLowerCase().replace(/_/g, " ")}` : "Written by hand"}
          </p>
          {n.status === "PENDING_APPROVAL" && !mayApprove && <p className="text-[12.5px] text-ink-2">Waiting for {n.sensitive ? "the super admin" : "an operations admin"} to approve. Nothing has been sent.</p>}
          {mayApprove && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => act("discard")} disabled={busy}>Discard</Button>
              <Button variant="primary" size="sm" onClick={() => act("approve")} disabled={busy || text.trim().length < 10}><Icon name="send" size={15} /> {busy ? "Sending…" : "Approve and send"}</Button>
            </div>
          )}
          {error && <p role="alert" className="text-[12.5px] text-[#b3301a]">{error}</p>}
        </div>
      )}
    </li>
  );
}

function newKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
