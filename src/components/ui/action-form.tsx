"use client";

import { useActionState } from "react";
import { FormError } from "./form";
import { Button } from "./button";
import type { ActionState } from "@/actions/_helpers";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

/** A form bound to a server action, showing the first error and a pending state on submit. */
export function ActionForm({ action, children, submitLabel = "Save", className, successMessage, secondary }: { action: Action; children: React.ReactNode; submitLabel?: string; className?: string; successMessage?: string; secondary?: React.ReactNode }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
        <div className="min-w-0 flex-1">
          <FormError message={state?.error} />
          {state?.ok && successMessage && <p className="text-[13px] text-ok">{successMessage}</p>}
        </div>
        <div className="flex items-center gap-2">
          {secondary}
          <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        </div>
      </div>
    </form>
  );
}
