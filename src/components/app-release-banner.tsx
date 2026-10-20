import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { AppRelease, Distributable } from "@/lib/app-release";

/**
 * What the portal is currently handing out, and whether it can.
 *
 * There is no Play Store. An administrator installs this APK on each phone and sends guards back
 * here to update, so this strip is the whole release channel. It states the version, offers the
 * download, and refuses loudly rather than quietly when the build is not fit to distribute.
 */
export function AppReleaseBanner({ release, dist, outdated }: { release: AppRelease | null; dist: Distributable; outdated: number }) {
  if (!dist.ok) {
    const critical = Boolean(release?.debugSigned);
    return (
      <div className={cn("mb-4 flex items-start gap-3 rounded-[12px] border px-4 py-3", critical ? "border-critical/30 bg-critical-soft" : "border-line bg-surface-2")}>
        <Icon name={critical ? "error" : "info"} size={18} filled className={cn("mt-0.5 shrink-0", critical ? "text-critical" : "text-ink-3")} />
        <div className="min-w-0">
          <p className={cn("text-[13.5px] font-medium", critical ? "text-critical" : "text-ink")}>{dist.reason}</p>
          <p className="mt-0.5 text-[13px] text-ink-2">{dist.detail}</p>
          {release && (
            <p className="mt-1 text-[12px] text-ink-3">
              Built {new Date(release.builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · v{release.versionName} · signed by {release.signer}
            </p>
          )}
        </div>
      </div>
    );
  }

  const r = dist.release;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-line bg-surface-2 px-4 py-3">
      <Icon name="mobile" size={18} filled className="shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">Security Gateway v{r.versionName}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          {(r.sizeBytes / 1_048_576).toFixed(1)} MB · Android {r.minSdk}+ ·{" "}
          {outdated > 0 ? `${outdated} ${outdated === 1 ? "phone is" : "phones are"} not on this version` : "every reporting phone is on this version"}
        </p>
      </div>
      <a href="/api/app/download" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
        <Icon name="download" size={15} filled /> Download APK
      </a>
    </div>
  );
}
