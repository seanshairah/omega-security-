"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Enable or disable browser push notifications for this device. */
export function PushToggle({ publicKey, compact }: { publicKey: string | null; compact?: boolean }) {
  const [state, setState] = useState<"unsupported" | "unconfigured" | "off" | "on" | "denied" | "busy">("busy");
  useEffect(() => {
    if (!publicKey) return setState("unconfigured");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.register("/sw.js").then((r) => r.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off")).catch(() => setState("unsupported"));
  }, [publicKey]);

  const enable = async () => {
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey!) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      setState("on");
    } catch { setState("off"); }
  };
  const disable = async () => {
    setState("busy");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    setState("off");
  };

  if (state === "unconfigured") return compact ? null : <p className="text-[13px] text-ink-3">Push notifications are not configured on the server (VAPID keys missing).</p>;
  if (state === "unsupported") return compact ? null : <p className="text-[13px] text-ink-3">This browser does not support push notifications.</p>;
  if (state === "denied") return compact ? null : <p className="text-[13px] text-ink-3">Notifications are blocked for this site in the browser. Allow them in the address-bar site settings, then try again.</p>;
  if (state === "on") return <Button size={compact ? "sm" : "md"} variant="secondary" onClick={disable}><Icon name="notifications_off" size={14} filled /> Push on · turn off</Button>;
  return <Button size={compact ? "sm" : "md"} variant="primary" disabled={state === "busy"} onClick={enable}><Icon name="notifications_active" size={14} filled /> {state === "busy" ? "Working…" : "Enable push notifications"}</Button>;
}
