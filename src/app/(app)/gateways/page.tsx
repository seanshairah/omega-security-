import Link from "next/link";
import { requireUser, can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getSettingNumber } from "@/lib/settings";
import { effectiveStatus, gatewayInclude, GATEWAY_STATUS_META } from "@/lib/gateway/service";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, Empty } from "@/components/ui/table";
import { Rows, CardRow } from "@/components/ui/rows";
import { Status } from "@/components/ui/status";
import { LinkButton } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import { fmtShort, ago } from "@/lib/time";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Gateway devices" };

export default async function GatewaysPage() {
  const user = await requireUser();
  const [gateways, offlineMinutes] = await Promise.all([
    db.gatewayDevice.findMany({ include: { ...gatewayInclude, callLogs: { orderBy: { startedAt: "desc" }, take: 1, include: { guard: { select: { firstName: true, lastName: true } } } } }, orderBy: [{ status: "asc" }, { deviceName: "asc" }] }),
    getSettingNumber("gateway.offlineMinutes"),
  ]);
  const rows = gateways.map((g) => ({ g, status: effectiveStatus(g, offlineMinutes), last: g.callLogs[0] }));
  const online = rows.filter((r) => r.status === "ONLINE").length;
  return (
    <div>
      <AutoRefresh seconds={30} />
      <PageHeader title="Gateway devices" description={`Android phones that guards call. ${online} of ${rows.length} online. A phone is offline after ${offlineMinutes} min without a heartbeat.`} actions={can.manageLocations(user) && <LinkButton href="/gateways/new" variant="primary">Register gateway</LinkButton>} />
      <Card>
        <Rows
          table={
            <Table>
              <THead><tr><th>Device</th><th>Phone</th><th>Location</th><th>Status</th><th>Last seen</th><th>Battery</th><th>Network</th><th>Last call</th><th></th></tr></THead>
              <TBody>
                {rows.length === 0 && <Empty colSpan={9} title="No gateway phones yet" body="Register one, install the Security Gateway app on an Android phone and enter the activation code." action={can.manageLocations(user) ? <LinkButton href="/gateways/new" variant="primary" size="sm">Register gateway</LinkButton> : undefined} />}
                {rows.map(({ g, status, last }) => (
                  <tr key={g.id}>
                    <td><Link href={`/gateways/${g.id}`} className="font-medium text-ink hover:underline">{g.deviceName}</Link><span className="block text-[12px] text-ink-3">{g.activationStatus === "PENDING" ? "Awaiting activation" : g.deviceModel ?? "—"}{g.appVersion ? ` · v${g.appVersion}` : ""}</span></td>
                    <td className="tnum">{formatPhone(g.phoneNumber)}</td>
                    <td className="text-ink-2">{g.location ? <Link href={`/locations/${g.location.id}`} className="hover:underline">{g.location.name}</Link> : "Head office"}</td>
                    <td><Status tone={GATEWAY_STATUS_META[status].tone} pulse={status === "ONLINE"}>{GATEWAY_STATUS_META[status].label}</Status></td>
                    <td className="tnum text-ink-2">{g.lastSeenAt ? ago(g.lastSeenAt) : "Never"}</td>
                    <td className="tnum">{g.batteryLevel != null ? <span className={g.batteryLevel < 20 ? "text-critical" : ""}>{g.batteryLevel}%</span> : "—"}</td>
                    <td className="text-ink-2">{g.networkType ?? "—"}</td>
                    <td className="text-ink-2">{last ? <Link href={`/calls/${last.id}`} className="hover:underline">{last.guard ? `${last.guard.firstName} ${last.guard.lastName}` : "Unknown"} · {fmtShort(last.startedAt)}</Link> : "—"}</td>
                    <td className="text-right"><LinkButton href={`/gateways/${g.id}`} size="sm">View</LinkButton></td>
                  </tr>
                ))}
              </TBody>
            </Table>
          }
          cards={
            <div>
              {rows.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-3">No gateway phones yet.</p>}
              {rows.map(({ g, status, last }) => <CardRow key={g.id} href={`/gateways/${g.id}`} title={g.deviceName} subtitle={`${formatPhone(g.phoneNumber)} · ${g.location?.name ?? "Head office"}`} right={<Status tone={GATEWAY_STATUS_META[status].tone}>{GATEWAY_STATUS_META[status].label}</Status>} meta={[{ label: "Last seen", value: g.lastSeenAt ? ago(g.lastSeenAt) : "Never" }, { label: "Battery", value: g.batteryLevel != null ? `${g.batteryLevel}%` : "—" }, { label: "Network", value: g.networkType ?? "—" }, { label: "Last call", value: last ? `${last.guard ? `${last.guard.firstName} ${last.guard.lastName}` : "Unknown"} · ${fmtShort(last.startedAt)}` : "—" }]} />)}
            </div>
          }
        />
      </Card>
      <p className="mt-3 text-[12px] text-ink-3">A call to a gateway proves that the number reached the phone. It does not prove the guard is physically on site; attendance still comes from the SMS confirmations.</p>
    </div>
  );
}
