"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { sendManualSms } from "@/actions/sms";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";

const QUICK = [
  { label: "Remind unconfirmed", body: "REMINDER: Please reply YES if you have arrived at your post, or NO if you have not." },
  { label: "Radio check", body: "CONTROL ROOM: Please confirm you are on post and all is in order. Reply 1 if well, 2 if you need assistance." },
  { label: "Shift change notice", body: "NOTICE: Your relief may be late. Remain on post until handover is confirmed. Reply YES to acknowledge." },
];

export function SendMessage({ guards }: { guards: { id: string; name: string; status: string }[] }) {
  const [body, setBody] = useState("");
  const [guardId, setGuardId] = useState(guards[0]?.id ?? "");
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <p className="text-[13px] text-ink-2">Send a one-off SMS to a guard. It is logged and attributed to you.</p>
      <div className="mt-3 rounded-[12px] border border-line focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message" rows={4} maxLength={320} className="w-full resize-none rounded-t-[12px] bg-transparent px-3.5 py-3 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none" />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <Select value={guardId} onChange={(e) => setGuardId(e.target.value)} className="h-8 w-auto max-w-[220px] border-0 bg-surface-2 text-[13px]">
            {guards.length === 0 && <option value="">No guards yet</option>}
            {guards.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.status}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-3 tnum">{body.length}/320</span>
            <button disabled={!body.trim() || !guardId || pending} onClick={() => start(async () => { const r = await sendManualSms({ guardId, body }); setResult(r.ok ? "Sent." : r.error ?? "Failed."); if (r.ok) setBody(""); })} className={cn("flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent text-white hover:bg-accent-strong disabled:opacity-40")} aria-label="Send"><Icon name="send" size={15} filled /></button>
          </div>
        </div>
      </div>
      {result && <p className="mt-2 text-[12.5px] text-ink-2">{result}</p>}
      <p className="mt-4 text-[13px] font-medium text-ink">Quick messages</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q.label} onClick={() => setBody(q.body)} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:bg-surface-2">{q.label}</button>
        ))}
      </div>
    </div>
  );
}
