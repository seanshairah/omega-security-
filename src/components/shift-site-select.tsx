"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Select } from "@/components/ui/form";
import { Status } from "@/components/ui/status";
import { COORDINATES_SOURCE_META } from "@/lib/site-config";
import type { CoordinatesSource } from "@prisma/client";

export type ShiftSiteOption = { id: string; name: string; clientName: string; latitude: number | null; longitude: number | null; radiusM: number; source: CoordinatesSource | null; configVersion: number };

/**
 * Site selector for a new shift. Shows the chosen site's coordinates, radius and provenance so the
 * admin can see what the guard phone will be judged against, and warns when the site has none.
 * It never changes the site: fixing coordinates happens on the site form (link).
 */
export function ShiftSiteSelect({ sites, defaultValue, canEditSites }: { sites: ShiftSiteOption[]; defaultValue?: string; canEditSites: boolean }) {
  const [id, setId] = useState(defaultValue ?? "");
  const s = sites.find((x) => x.id === id) ?? null;
  const meta = s?.source ? COORDINATES_SOURCE_META[s.source] : null;
  return (
    <>
      <Field label="Location" required>
        <Select name="locationId" value={id} onChange={(e) => setId(e.target.value)} required><option value="" disabled>Select a site</option>{sites.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.clientName}</option>)}</Select>
      </Field>
      {s && (
        <div className="sm:col-span-2 rounded-[8px] border border-dashed border-line bg-surface-2 px-3 py-2 text-[12.5px]" data-testid="shift-site-coords">
          {s.latitude != null && s.longitude != null ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">Site geofence</span>
              <span className="tnum text-ink-2">{s.latitude.toFixed(6)}, {s.longitude.toFixed(6)} · radius {s.radiusM} m · config v{s.configVersion}</span>
              {meta && <Status tone={meta.tone}>{meta.label}</Status>}
              {s.source === "TEST" && <span className="text-warn">TEST coordinates: not verified; GPS results at this site are not reliable.</span>}
              <span className="text-ink-3">The guard phone is judged against this fence unless an override is set below. The site itself is not changed by this form.</span>
              {canEditSites && <Link href={`/locations/${s.id}/edit`} className="text-accent-strong hover:underline">Edit site coordinates →</Link>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Status tone="warn">No coordinates for this site</Status>
              <span className="text-ink-2">GPS verification is off for shifts here; SMS checks continue. Configure the site&apos;s position before relying on guard-phone verification.</span>
              {canEditSites && <Link href={`/locations/${s.id}/edit`} className="text-accent-strong hover:underline">Configure site location →</Link>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
