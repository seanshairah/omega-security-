"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";
import { Textarea } from "./form";

type Props = {
  label: string;
  title: string;
  body: string;
  confirmLabel?: string;
  variant?: "secondary" | "danger" | "primary" | "ghost";
  size?: "sm" | "md";
  withNote?: string; // placeholder for a note field
  action: (note: string) => Promise<unknown>;
  className?: string;
};

/** Button that opens a small confirmation panel before running a server action. */
export function ConfirmButton({ label, title, body, confirmLabel = "Confirm", variant = "secondary", size = "sm", withNote, action, className }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>{label}</Button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-float)] fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="h-[3px] bg-accent" />
            <div className="p-5">
              <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-[13px] text-ink-2">{body}</p>
              {withNote && <Textarea className="mt-3 min-h-20" placeholder={withNote} value={note} onChange={(e) => setNote(e.target.value)} />}
              {err && <p className="mt-3 text-[13px] text-critical">{err}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
                <Button type="button" variant={variant === "danger" ? "danger" : "primary"} size="sm" disabled={pending} onClick={() => start(async () => { try { await action(note); setOpen(false); router.refresh(); } catch (e) { setErr((e as Error).message); } })}>{pending ? "Working…" : confirmLabel}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
