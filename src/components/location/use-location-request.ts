"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationRequestView } from "@/lib/gateway/location-requests";
import { isOpen } from "@/lib/location-request-state";

export type RequestView = LocationRequestView & { requestedBy?: string | null; deviceName?: string | null };

/**
 * Drives one "request the guard phone's position" cycle from the browser: create (or reuse) the
 * request, poll it every few seconds while it is open, stop when it reaches a terminal state or
 * the component goes away. Nothing here reads the browser's own location: the position always
 * comes from the server, which got it from the phone.
 */
export function useLocationRequest(guardId: string | null, opts: { pollMs?: number } = {}) {
  const [request, setRequest] = useState<RequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const pollMs = opts.pollMs ?? 4000;

  const stopPolling = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);

  const refresh = useCallback(async (id?: string) => {
    const rid = id ?? request?.id;
    if (!guardId || !rid) return null;
    const res = await fetch(`/api/guards/${guardId}/location-requests/${rid}`, { cache: "no-store" });
    if (!alive.current) return null;
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`); return null; }
    const r = (await res.json()).request as RequestView;
    setRequest(r);
    return r;
  }, [guardId, request?.id]);

  // Poll while open.
  useEffect(() => {
    stopPolling();
    if (!request || !isOpen(request.status)) return;
    timer.current = setTimeout(() => { void refresh(request.id); }, pollMs);
    return stopPolling;
  }, [request, refresh, pollMs, stopPolling]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; stopPolling(); }; }, [stopPolling]);

  const start = useCallback(async (body: { purpose?: "CHECK" | "SITE_SETUP" | "WELFARE"; locationId?: string | null; maxAccuracyM?: number } = {}) => {
    if (!guardId) return null;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/guards/${guardId}/location-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return null; }
      setRequest(j.request as RequestView);
      return j.request as RequestView;
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); return null; }
    finally { if (alive.current) setBusy(false); }
  }, [guardId]);

  const cancel = useCallback(async () => {
    if (!guardId || !request || !isOpen(request.status)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/guards/${guardId}/location-requests/${request.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) setRequest(j.request as RequestView); else setError(j.error ?? `HTTP ${res.status}`);
    } finally { if (alive.current) setBusy(false); }
  }, [guardId, request]);

  const reset = useCallback(() => { stopPolling(); setRequest(null); setError(null); }, [stopPolling]);

  return { request, busy, error, start, cancel, refresh, reset, setRequest };
}
