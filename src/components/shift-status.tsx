import type { ShiftStatus } from "@prisma/client";
import { Status } from "@/components/ui/status";
import { STATUS_META } from "@/lib/services/shifts";

export function ShiftStatusLabel({ status, className }: { status: ShiftStatus; className?: string }) {
  const m = STATUS_META[status];
  return <Status tone={m.tone} pulse={status === "CRITICAL"} className={className}>{m.label}</Status>;
}
