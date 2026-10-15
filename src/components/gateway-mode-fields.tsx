"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/form";

export function ModeFields({ mode: initial, guardId, guards }: { mode: "OPERATIONS_GATEWAY" | "GUARD"; guardId: string; guards: { id: string; firstName: string; lastName: string; guardNo: string }[] }) {
  const [mode, setMode] = useState(initial);
  return (
    <>
      <Field label="Mode" required><Select name="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="OPERATIONS_GATEWAY">Operations gateway (control-room phone)</option><option value="GUARD">Guard device (the guard&apos;s phone)</option></Select></Field>
      {mode === "GUARD" && <Field label="Guard" required hint="The guard becomes an Android guard once the phone is activated."><Select name="guardId" defaultValue={guardId} required><option value="">Choose a guard</option>{guards.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName} · {g.guardNo}</option>)}</Select></Field>}
    </>
  );
}
