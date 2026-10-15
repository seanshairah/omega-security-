"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkCallerAction } from "@/actions/gateways";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function LinkCaller({ callId, guards, phone }: { callId: string; guards: { id: string; firstName: string; lastName: string }[]; phone: string }) {
  const [guardId, setGuardId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block min-w-0 flex-1 text-[13px] font-medium text-ink">Associate with an existing guard<Select value={guardId} onChange={(e) => setGuardId(e.target.value)} className="mt-1"><option value="">Choose a guard</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}</Select></label>
      <Button variant="primary" disabled={!guardId || pending} onClick={() => start(async () => { try { await linkCallerAction(callId, guardId); router.refresh(); } catch (e) { setErr((e as Error).message); } })}>{pending ? "Linking…" : "Link calls"}</Button>
      {err && <p className="w-full text-[13px] text-critical">{err}</p>}
      <p className="w-full text-[12px] text-ink-3">This links the calls only. To make {phone} ring through as the guard in future, update the phone number on the guard&apos;s profile.</p>
    </div>
  );
}
