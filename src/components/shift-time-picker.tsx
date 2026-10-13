"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";

const PRESETS = [
  { label: "Day · 8 h", start: "06:00", end: "14:00" },
  { label: "Afternoon · 8 h", start: "14:00", end: "22:00" },
  { label: "Night · 8 h", start: "22:00", end: "06:00" },
  { label: "Day · 12 h", start: "06:00", end: "18:00" },
  { label: "Night · 12 h", start: "18:00", end: "06:00" },
];

function minutes(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number), [eh, em] = end.split(":").map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 24 * 60;
  return m;
}
function fmt(m: number) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
function add(start: string, m: number) { const [h, mi] = start.split(":").map(Number); const t = (h * 60 + mi + m) % (24 * 60); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; }

export function ShiftTimePicker({ defaultStart = "18:00", defaultEnd = "06:00" }: { defaultStart?: string; defaultEnd?: string }) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const dur = minutes(start, end);
  const overnight = end <= start;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => { setStart(p.start); setEnd(p.end); }} className={cn("h-8 rounded-[8px] border px-3 text-[12.5px] font-medium", start === p.start && end === p.end ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2 hover:text-ink")}>{p.label}</button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start time" required><Input type="time" name="startTime" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
        <Field label="End time" required hint={overnight ? "Ends the following day" : undefined}><Input type="time" name="endTime" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">Duration</div>
          <div className="flex h-9 items-center rounded-[8px] bg-surface-2 px-3 text-sm text-ink tnum">{fmt(dur)} <span className="ml-2 text-ink-3">· welfare check at {add(start, dur / 2)}</span></div>
        </div>
      </div>
    </div>
  );
}
