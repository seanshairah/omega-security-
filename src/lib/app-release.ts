import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The Android release the portal hands out.
 *
 * There is no Play Store: guards install the APK from this portal and update from it. That makes
 * the portal the distribution channel, and the signing key the only thing standing between a guard
 * and someone else's build. So the facts about the APK are extracted at build time by
 * scripts/dev/apk-manifest.mjs — the deployment host has no Android SDK — and read here.
 */
export type AppRelease = {
  file: string;
  applicationId: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  sizeBytes: number;
  sha256: string;
  signer: string;
  debugSigned: boolean;
  builtAt: string;
};

const MANIFEST = path.join(process.cwd(), "artifacts/android/release.json");
const APK_DIR = path.join(process.cwd(), "artifacts/android");

let cache: { at: number; value: AppRelease | null } | null = null;

export async function currentRelease(): Promise<AppRelease | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value: AppRelease | null = null;
  try {
    value = JSON.parse(await readFile(MANIFEST, "utf8")) as AppRelease;
  } catch {
    // No manifest shipped with this deployment. The portal still works; it simply has no APK to
    // offer, which is the honest state before the first signed build.
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function releaseBytes(file: string): Promise<Buffer> {
  // Only ever the file the manifest names, resolved inside the artifacts directory, so a crafted
  // name cannot walk out of it.
  const full = path.join(APK_DIR, path.basename(file));
  if (!full.startsWith(APK_DIR + path.sep)) throw new Error("bad release path");
  return readFile(full);
}

export type Distributable =
  | { ok: true; release: AppRelease }
  | { ok: false; reason: string; detail: string; release: AppRelease | null };

/**
 * Whether this build may be handed to a phone.
 *
 * The debug key is published with the Android SDK. An APK signed with it can be replaced by anyone
 * who can get an install in front of the guard, and a phone that accepted one would accept the
 * next. Refusing here is the difference between a configuration mistake and a fleet-wide one.
 * ALLOW_DEBUG_SIGNED_APK=true exists for a test handset and is never right in production.
 */
export function distributable(release: AppRelease | null): Distributable {
  if (!release) {
    return {
      ok: false,
      reason: "No release has been published",
      detail: "Build the release APK and run `npm run apk:manifest`, then deploy.",
      release: null,
    };
  }
  if (release.debugSigned && process.env.ALLOW_DEBUG_SIGNED_APK !== "true") {
    return {
      ok: false,
      reason: "This build is signed with the Android debug key",
      detail:
        "The debug key ships with the Android SDK, so anyone could sign an update that replaces the app. " +
        "Sign the release with the company keystore and publish again.",
      release,
    };
  }
  return { ok: true, release };
}

/** Phones report versionName; the comparison that matters is versionCode. */
export function isOutOfDate(reportedVersionName: string | null | undefined, release: AppRelease | null): boolean {
  if (!release || !reportedVersionName) return false;
  // A debug build carries a "-debug" suffix and its own applicationId, so it is a different app
  // rather than an older one. It is still worth flagging: it should not be in the field.
  return reportedVersionName.replace(/-debug$/, "") !== release.versionName;
}
