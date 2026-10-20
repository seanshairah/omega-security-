"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button, buttonClass } from "@/components/ui/button";
import { Status, type Tone } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/time";
import type { CallRequestView, GatewayOption } from "@/lib/gateway/call-requests";

/**
 * "Call guard": asks an operations gateway phone to call the guard, and shows what actually
 * happened. One component, used wherever a guard can be called, so every page tells the same
 * truth: a delivered request is not a call, and only the phone's call record says it connected.
 */
export function CallGuardButton({ guardId, guardName, shiftId, incidentId, size = "md", variant = "secondary", label = "Call guard", className }: {
  guardId: string; guardName: string; shiftId?: string | null; incidentId?: string | null;
  size?: "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size, className)}>
        <Icon name="call" size={size === "sm" ? 15 : 16} filled /> {label}
      </button>
      {open && <CallPanel guardId={guardId} guardName={guardName} shiftId={shiftId ?? null} incidentId={incidentId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

type Loaded = { gateways: GatewayOption[]; latest: CallRequestView | null };

function CallPanel({ guardId, guardName, shiftId, incidentId, onClose }: { guardId: string; guardName: string; shiftId: string | null; incidentId: string | null; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [gatewayId, setGatewayId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [request, setRequest] = useState<CallRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a double click, or a retry after a dropped response, is one call.
  const key = useRef<string>(newKey());
  const alive = useRef(true);
  // Set on every mount, not only the first: React's dev double-mount runs the cleanup once in between.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/guards/${guardId}/call-requests`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!alive.current) return;
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      setData({ gateways: j.gateways, latest: j.latest });
      setGatewayId((j.gateways as GatewayOption[]).find((g) => g.eligible)?.id ?? "");
      if (j.latest?.open) setRequest(j.latest);
    })();
  }, [guardId]);

  // Poll while the call is in progress.
  useEffect(() => {
    if (!request?.open) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/call-requests/${request.id}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (alive.current && res.ok) setRequest(j.request);
    }, 2000);
    return () => clearTimeout(t);
  }, [request]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const call = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/guards/${guardId}/call-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gatewayDeviceId: gatewayId || null, shiftId, incidentId, reason: reason || null, idempotencyKey: key.current }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      setRequest(j.request);
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); }
    finally { if (alive.current) setBusy(false); }
  }, [guardId, gatewayId, shiftId, incidentId, reason]);

  const cancel = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    const res = await fetch(`/api/call-requests/${request.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (alive.current) { if (res.ok) setRequest(j.request); else setError(j.error ?? `HTTP ${res.status}`); setBusy(false); }
  }, [request]);

  const again = () => { key.current = newKey(); setRequest(null); setError(null); };
  const eligible = data?.gateways.filter((g) => g.eligible) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="call-panel-title" className="w-full max-w-[420px] rounded-t-[14px] border border-line bg-surface shadow-xl sm:rounded-[14px]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="call-panel-title" className="min-w-0 truncate text-[15px] font-semibold text-ink">Call {guardName}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><Icon name="close" size={18} /></button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {!data && !error && <p className="text-[13px] text-ink-3">Checking which phones can place the call…</p>}

          {data && !request && (
            <>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">From</span>
                <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[14px] text-ink sm:h-9" disabled={!eligible.length}>
                  {data.gateways.map((g) => (
                    <option key={g.id} value={g.id} disabled={!g.eligible}>
                      {g.deviceName}{g.siteName ? ` · ${g.siteName}` : ""}{g.isDefault ? " (site default)" : ""}{g.eligible ? "" : ` — ${g.reason}`}
                    </option>
                  ))}
                  {!data.gateways.length && <option value="">No operations gateway phone registered</option>}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink-2">Reason <span className="font-normal text-ink-3">(shown to the operator)</span></span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={140} placeholder="e.g. Missed check-in" className="h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[14px] text-ink placeholder:text-ink-3 sm:h-9" />
              </label>
              <p className="flex gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                <Icon name="info" size={15} className="mt-0.5 text-ink-3" />
                <span>The control-room phone shows the request, and the operator taps once to dial. Nothing rings until they do.</span>
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={onClose}>Close</Button>
                <Button variant="primary" onClick={call} disabled={busy || !eligible.length}>
                  <Icon name="call" size={16} filled /> {busy ? "Sending…" : "Call"}
                </Button>
              </div>
            </>
          )}

          {request && <CallProgress request={request} />}
          {request && (
            <div className="flex justify-end gap-2 pt-1">
              {request.open && ["QUEUED", "DELIVERED", "AWAITING_CONFIRMATION"].includes(request.status) && <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel request</Button>}
              {!request.open && <Button variant="secondary" onClick={again}>Call again</Button>}
              <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
          )}

          {error && <p role="alert" className="rounded-[10px] bg-critical-soft px-3 py-2.5 text-[13px] text-[#b3301a]">{error}</p>}
        </div>
      </div>
    </div>
  );
}

const STEPS: { key: keyof CallRequestView; label: string; icon: IconName }[] = [
  { key: "requestedAt", label: "Requested", icon: "schedule_send" },
  { key: "deliveredAt", label: "Delivered to the phone", icon: "mobile_arrow_down" },
  { key: "shownAt", label: "Shown to the operator", icon: "touch_app" },
  { key: "dialedAt", label: "Dialling", icon: "phone_forwarded" },
  { key: "connectedAt", label: "Answered", icon: "call" },
  { key: "endedAt", label: "Ended", icon: "call_end" },
];

/** A compact timeline: each step the phone has actually reported, with its time. */
export function CallProgress({ request }: { request: CallRequestView }) {
  const tone = request.tone as Tone;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Status tone={tone} pulse={request.open}>{request.label}</Status>
        <span className="truncate text-[12px] text-ink-3">via {request.gateway}</span>
      </div>
      <p className="mt-1 text-[13px] text-ink-2">{request.detail}</p>
      <ol className="mt-3 space-y-1.5 border-l border-line pl-3">
        {STEPS.map((s) => {
          const at = request[s.key] as string | null;
          if (!at) return null;
          const label = s.key === "endedAt" ? (request.status === "COMPLETED" ? `Ended${request.durationSeconds != null ? ` after ${fmtSeconds(request.durationSeconds)}` : ""}` : request.label) : s.label;
          return (
            <li key={s.key} className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Icon name={s.icon} size={14} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className={cn("tabular-nums text-ink-3")}>{fmtTime(at)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function fmtSeconds(s: number) { return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; }
function newKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
