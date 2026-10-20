import { NextResponse } from "next/server";
import { authenticateGateway } from "@/lib/gateway/auth";
import { apiUser } from "@/lib/auth/rbac";
import { currentRelease, distributable } from "@/lib/app-release";

export const dynamic = "force-dynamic";

/**
 * GET /api/app/version
 *
 * What release the portal is offering. A phone calls this to learn whether it is out of date;
 * the portal uses it to show what would be handed out.
 *
 * Authenticated either way. The response names the signing certificate, and an unauthenticated
 * reader has no business knowing which build a company's guards run.
 */
export async function GET(req: Request) {
  const device = await authenticateGateway(req);
  if (!device.device) {
    const { status } = await apiUser("ADMIN");
    if (status !== 200) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const release = await currentRelease();
  const d = distributable(release);
  if (!release) {
    return NextResponse.json({ available: false, reason: d.ok ? null : d.reason }, { status: 200 });
  }
  return NextResponse.json({
    available: d.ok,
    // Present even when it cannot be handed out, so the portal can say exactly what is wrong
    // instead of looking as though no build exists.
    reason: d.ok ? null : d.reason,
    detail: d.ok ? null : ("detail" in d ? d.detail : null),
    versionName: release.versionName,
    versionCode: release.versionCode,
    applicationId: release.applicationId,
    minSdk: release.minSdk,
    sizeBytes: release.sizeBytes,
    sha256: release.sha256,
    builtAt: release.builtAt,
    downloadUrl: d.ok ? "/api/app/download" : null,
  });
}
