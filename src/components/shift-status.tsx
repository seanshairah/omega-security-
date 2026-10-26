import type { ShiftStatus } from "@prisma/client";
import { Status } from "@/components/ui/status";
import { STATUS_META } from "@/lib/services/shifts";

/**
 * A shift still SCHEDULED after its start has started; the engine has just not reached it yet (or
 * is not running). Saying "Scheduled" then hides the one fact that matters: nobody has checked in.
 */
export function ShiftStatusLabel({ status, startAt, className }: { status: ShiftStatus; startAt?: Date; className?: string }) {
  if (status === "SCHEDULED" && startAt && startAt.getTime() <= Date.now()) {
    return <Status tone="warn" className={className}>Started · not checked in</Status>;
  }
  const m = STATUS_META[status];
  return <Status tone={m.tone} pulse={status === "CRITICAL"} className={className}>{m.label}</Status>;
}
