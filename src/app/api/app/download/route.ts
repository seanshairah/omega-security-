import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/gateway/auth";
import { apiUser } from "@/lib/auth/rbac";
import { currentRelease, distributable, releaseBytes } from "@/lib/app-release";

export const dynamic = "force-dynamic";

/**
 * GET /api/app/download
 *
 * Serves the signed release APK. This is the only distribution channel: there is no Play Store, so
 * a guard installs from here and updates from here.
 *
 * Two deliberate refusals. Unauthenticated callers get nothing, because the APK carries the
 * activation flow and should not be a public download. And a build signed with the Android debug
 * key is refused outright — that key ships with the SDK, so handing it out would let anyone
 * replace the app on every phone that accepted it.
 */
export async function GET(req: Request) {
  const device = await authenticateGateway(req);
  if (!device.device) {
    const { status } = await apiUser("ADMIN");
    if (status !== 200) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const release = await currentRelease();
  const d = distributable(release);
  if (!d.ok) {
    return NextResponse.json({ error: d.reason, detail: d.detail }, { status: 409 });
  }

  // The APK reaches the serverless bundle only through outputFileTracingIncludes in
  // next.config.ts: nothing imports it, so nothing traces it automatically. If that ever stops
  // working the file is simply absent at runtime, and an unhandled read error would surface as an
  // opaque 500 that looks like any other outage. Name it instead.
  let bytes: Buffer;
  try {
    bytes = await releaseBytes(d.release.file);
  } catch {
    return NextResponse.json({
      error: "The release APK is not present in this deployment",
      detail: `${d.release.file} is described by artifacts/android/release.json but was not bundled. ` +
        "Check outputFileTracingIncludes in next.config.ts, and that the APK is committed.",
    }, { status: 503 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="omega-guard-${d.release.versionName}.apk"`,
      // The sha256 lets the phone, or an administrator, confirm the bytes arrived whole.
      "X-APK-SHA256": d.release.sha256,
      "X-APK-Version": d.release.versionName,
      "X-APK-Version-Code": String(d.release.versionCode),
      // Each release is immutable, and the URL is the same for every version, so it must not be
      // cached: a phone asking after an update has to get the new bytes, not yesterday's.
      "Cache-Control": "no-store",
    },
  });
}
