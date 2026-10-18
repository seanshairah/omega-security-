import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus, gatewayInclude, GATEWAY_STATUS_META, ACTIVATION_CODE_HOURS, guardDeviceConfig } from "@/lib/gateway/service";
import { configApplied } from "@/lib/site-config";
import { callInclude, callMetrics } from "@/lib/gateway/calls";
import { regenerateGatewayCode, setGatewayDisabledAction, revokeGatewayAction } from "@/actions/gateways";
import { PageHeader, Meta } from "@/components/ui/page";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { ButtonGroup, LinkButton } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { CallList } from "@/components/calls/call-list";
import { AutoRefresh } from "@/components/auto-refresh";
import { fmtDateTime, ago } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { fmtCallDuration } from "@/lib/gateway/call-state";
import { COMPANY } from "@/components/layout/brand";
import { DevicePanel } from "@/components/location/location-panel";
import { LocationEventList } from "@/components/location/location-events";
import { GuardLocationPanel } from "@/components/location/guard-location-panel";
import { SiteMap } from "@/components/map/site-map";
import { freshness } from "@/lib/geofence";

export const metadata = { title: "Gateway" };

export default async function GatewayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [g, offlineMinutes, calls, metrics] = await Promise.all([
    db.gatewayDevice.findUnique({ where: { id }, include: gatewayInclude }),
    getSettingNumber("gateway.offlineMinutes"),
    db.callLog.findMany({ where: { gatewayDeviceId: id }, include: callInclude, orderBy: { startedAt: "desc" }, take: 50 }),
    callMetrics({ gatewayId: id }),
  ]);
  const locEvents = g?.mode === "GUARD" ? await db.locationEvent.findMany({ where: { gatewayDeviceId: id }, include: { shift: { select: { id: true, startAt: true, endAt: true } }, location: { select: { id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true } } }, orderBy: { occurredAt: "desc" }, take: 40 }) : [];
  const lastSite = locEvents.find((e) => e.location?.latitude != null)?.location ?? null;
  if (!g) notFound();
  const currentConfigVersion = g.mode === "GUARD" ? (await guardDeviceConfig(g)).configVersion : null;
  const status = effectiveStatus(g, offlineMinutes);
  const manage = can.manageLocations(user);
  const serverUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? `https://${COMPANY.domain}`;
  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title={g.deviceName} description={`${g.mode === "GUARD" ? `Guard device · ${g.guard ? `${g.guard.firstName} ${g.guard.lastName}` : "no guard linked"}` : "Operations gateway"} · ${formatPhone(g.phoneNumber)} · ${g.location ? `${g.location.name}, ${g.location.client.name}` : g.mode === "GUARD" ? "site by shift" : "Head office"}`} actions={manage && (
        <ButtonGroup>
          <LinkButton href={`/calls?gatewayId=${g.id}`}>View calls</LinkButton>
          {g.status !== "REVOKED" && <LinkButton href={`/gateways/${g.id}/edit`}>Edit</LinkButton>}
          {g.status !== "REVOKED" && (g.status === "DISABLED"
            ? <ConfirmButton size="md" label="Enable" title={`Enable ${g.deviceName}?`} body="The phone can send heartbeats and call events again." confirmLabel="Enable" action={async () => { "use server"; await setGatewayDisabledAction(g.id, false); }} />
            : <ConfirmButton size="md" label="Disable" title={`Disable ${g.deviceName}?`} body="Events from the phone are rejected until you enable it again. The token is kept." confirmLabel="Disable" action={async () => { "use server"; await setGatewayDisabledAction(g.id, true); }} />)}
          {g.status !== "REVOKED" && <ConfirmButton size="md" label="Revoke" variant="danger" title={`Revoke ${g.deviceName}?`} body="Permanent. The phone's token is deleted and it can never send events again. Use this if the phone is lost or stolen." withNote="Reason (optional)" confirmLabel="Revoke" action={async (note) => { "use server"; await revokeGatewayAction(g.id, note); }} />}
        </ButtonGroup>
      )} />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          {g.activationStatus === "PENDING" && g.status !== "REVOKED" && (
            <Card className="border-accent/40">
              <CardHeader title="Activate this phone" description={`Install the Security Gateway app, enter the server and this code. Codes last ${ACTIVATION_CODE_HOURS} hours.`} action={manage && <ConfirmButton label="New code" title="Generate a new activation code?" body="The old code stops working." confirmLabel="Generate" action={async () => { "use server"; await regenerateGatewayCode(g.id); }} />} />
              <CardBody>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Meta label="Server"><code className="break-all text-[13px]">{serverUrl}</code></Meta>
                  <Meta label="Activation code"><span className="font-mono text-[28px] font-semibold tracking-[0.2em] text-ink">{g.activationCode ?? "—"}</span>{g.activationExpiresAt && <span className="block text-[12px] text-ink-3">expires {fmtDateTime(g.activationExpiresAt)}{g.activationExpiresAt < new Date() ? " · expired, generate a new one" : ""}</span>}</Meta>
                </div>
                <p className="mt-3 text-[12.5px] text-ink-3">Step by step: <Link href="/docs/android-installation" className="underline">Android installation guide</Link> (docs/ANDROID_INSTALLATION.md in the repository).</p>
              </CardBody>
            </Card>
          )}
          {g.mode === "GUARD" && (
            <Card>
              <CardHeader title="Location" description="Latest fix and recent location events from this phone. GPS is approximate: every fix carries its accuracy, and a stale fix is never shown as current." action={g.lastLocationAt ? <Status tone={freshness(g.lastLocationAt).tone}>{freshness(g.lastLocationAt).label}</Status> : undefined} />
              <CardBody>
                {g.guardId && <div className="mb-4 border-b border-dashed border-line pb-4"><GuardLocationPanel guardId={g.guardId} canRequest={can.manageGuards(user)} canEditSites={can.manageLocations(user)} compact /></div>}
                {(g.lastLatitude != null && g.lastLongitude != null) || lastSite ? <SiteMap site={lastSite?.latitude != null && lastSite?.longitude != null ? { lat: lastSite.latitude, lng: lastSite.longitude, radiusM: lastSite.geofenceRadiusM, name: lastSite.name } : null} points={[...(g.lastLatitude != null && g.lastLongitude != null ? [{ lat: g.lastLatitude, lng: g.lastLongitude, label: `Latest fix · ${g.lastLocationState ?? "unknown"}`, kind: "latest" as const, at: fmtDateTime(g.lastLocationAt), freshness: freshness(g.lastLocationAt).label }] : []), ...locEvents.filter((e) => e.latitude != null && (e.eventType === "LOCATION_EXIT" || e.eventType === "LOCATION_RETURNED")).slice(0, 10).map((e) => ({ lat: e.latitude!, lng: e.longitude!, label: e.eventType === "LOCATION_EXIT" ? "Exit" : "Return", kind: (e.eventType === "LOCATION_EXIT" ? "exit" : "return") as "exit" | "return", at: fmtDateTime(e.occurredAt), freshness: e.syncStatus === "SYNCED_LATE" ? "SYNCED LATE" : undefined }))]} height={260} /> : <p className="text-[13px] text-ink-3">No location reported yet.</p>}
              </CardBody>
              <LocationEventList events={locEvents} showShift emptyTitle="No location events from this phone yet" />
            </Card>
          )}
          <Card>
            <CardHeader title={g.mode === "GUARD" ? "Calls from this phone" : "Calls through this gateway"} description={`${metrics.total} total · ${metrics.missed} missed · ${metrics.unknown} unknown callers · average ${fmtCallDuration(metrics.avgDurationSeconds)}`} action={<Link href={`/calls?gatewayId=${g.id}`} className="text-[13px] font-medium text-accent-strong hover:underline">All calls →</Link>} />
            <CallList calls={calls} showGateway={false} emptyTitle="No calls through this gateway yet" />
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card><CardBody className="pt-5">
            <div className="flex items-center justify-between"><span className="text-[15px] font-semibold text-ink">Gateway status</span><Status tone={GATEWAY_STATUS_META[status].tone} pulse={status === "ONLINE"}>{GATEWAY_STATUS_META[status].label}</Status></div>
            {g.mode === "GUARD" && <div className="mt-5 border-b border-dashed border-line pb-4"><DevicePanel device={g} offlineMinutes={offlineMinutes} /></div>}
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Meta label="Activation">{g.activationStatus === "ACTIVE" ? `Active since ${fmtDateTime(g.activatedAt)}` : g.activationStatus === "PENDING" ? "Pending" : "Revoked"}</Meta>
              <Meta label="Last seen">{g.lastSeenAt ? `${ago(g.lastSeenAt)} · ${fmtDateTime(g.lastSeenAt)}` : "Never"}</Meta>
              <Meta label="Battery">{g.batteryLevel != null ? `${g.batteryLevel}%` : "—"}</Meta>
              <Meta label="Network">{g.networkType ?? "—"}</Meta>
              <Meta label="Phone model">{g.deviceModel ?? "—"}</Meta>
              <Meta label="Android">{g.androidVersion ?? "—"}</Meta>
              <Meta label="App version">{g.appVersion ?? "—"}</Meta>
              {g.mode === "GUARD" && <Meta label="Shift config on phone" className="col-span-2">{currentConfigVersion ? (configApplied(currentConfigVersion, g.configVersionApplied) ? <Status tone="ok">v{g.configVersionApplied} applied{g.configAppliedAt ? ` · ${ago(g.configAppliedAt)}` : ""}</Status> : <Status tone="warn">phone has {g.configVersionApplied ? `v${g.configVersionApplied}` : "no config yet"} · current is v{currentConfigVersion} · applied on the next heartbeat</Status>) : <span className="text-ink-3">No shift to monitor{g.configVersionApplied ? ` · phone last applied v${g.configVersionApplied}` : ""}</span>}</Meta>}
              <Meta label="Last IP">{g.lastIp ?? "—"}</Meta>
              <Meta label="Last call">{g.lastCallAt ? fmtDateTime(g.lastCallAt) : "—"}</Meta>
              <Meta label="Registered">{fmtDateTime(g.createdAt)}</Meta>
              {g.revokedAt && <Meta label="Revoked" className="col-span-2"><span className="text-critical">{fmtDateTime(g.revokedAt)}</span></Meta>}
              {g.disabledAt && g.status === "DISABLED" && <Meta label="Disabled" className="col-span-2">{fmtDateTime(g.disabledAt)}</Meta>}
            </div>
            {g.notes && <p className="mt-4 border-t border-dashed border-line pt-3 text-[13px] text-ink-2">{g.notes}</p>}
          </CardBody></Card>
          <Card>
            <CardHeader title="Test connection" description="On the phone, open Settings → Test connection. A successful test updates “Last seen” above within a few seconds." />
            <CardBody><p className="text-[13px] text-ink-2">The phone sends a heartbeat every <span className="tnum">{Math.max(30, await getSettingNumber("gateway.heartbeatSeconds"))}</span> s and is marked offline after <span className="tnum">{offlineMinutes}</span> min of silence. Both are set under Settings → Call gateway.</p></CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
