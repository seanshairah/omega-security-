"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MagnifyingGlassIcon, ArrowsClockwiseIcon, BellIcon, CaretRightIcon, SignOutIcon, ListIcon } from "@phosphor-icons/react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

const NAMES: Record<string, string> = {
  dashboard: "Overview", operations: "Active operations", alerts: "Guard alerts", shifts: "Shifts", attendance: "Attendance", incidents: "Incidents",
  guards: "Guards", clients: "Clients", locations: "Locations", sms: "SMS logs", templates: "Templates", reports: "Reports",
  users: "Users", settings: "Settings", audit: "Audit log", simulator: "Simulator", notifications: "Notifications", new: "New", edit: "Edit", recurring: "Recurring", monitoring: "Monitoring", messages: "Messages",
};
const SECTION: Record<string, string> = {
  dashboard: "Operations", operations: "Operations", shifts: "Operations", attendance: "Operations", incidents: "Operations",
  guards: "Workforce", clients: "Workforce", locations: "Workforce", sms: "Communications", simulator: "Communications", messages: "Communications", monitoring: "Operations",
};

export function Topbar({ user, unread, systemStatus, onMenu }: { user: { name: string; avatarUrl: string | null; title: string | null }; unread: number; systemStatus: { tone: "ok" | "warn" | "critical"; label: string }; onMenu?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const segs = path.split("/").filter(Boolean);
  const section = SECTION[segs[0]] ?? "Omega";
  const crumbs = segs.map((s, i) => ({ label: NAMES[s] ?? (s.length > 12 ? "Detail" : s), href: "/" + segs.slice(0, i + 1).join("/") }));
  const dot = { ok: "bg-ok", warn: "bg-warn", critical: "bg-critical" }[systemStatus.tone];

  return (
    <header className="mb-3 flex h-14 items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 sm:mb-4 sm:gap-4 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-[14px]">
        <button onClick={onMenu} className="-ml-1 mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Open menu"><ListIcon size={20} weight="bold" /></button>
        <span className="hidden text-ink-2 sm:inline">{section}</span>
        {crumbs.map((c, i) => (
          <span key={c.href} className={cn("items-center gap-2", i === crumbs.length - 1 ? "flex" : "hidden sm:flex")}>
            <CaretRightIcon size={12} weight="fill" className="hidden text-ink-3 sm:block" />
            {i === crumbs.length - 1 ? <span className="truncate font-medium text-ink">{c.label}</span> : <Link href={c.href} className="text-ink-2 hover:text-ink">{c.label}</Link>}
          </span>
        ))}
        <span className={cn("ml-2 hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-ink-2 xl:inline-flex")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
          {systemStatus.label}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <form action="/guards" className="relative hidden md:block">
          <MagnifyingGlassIcon size={16} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input name="q" placeholder="Search guards" className="h-9 w-56 rounded-[var(--radius-control)] border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </form>
        <button onClick={() => start(() => router.refresh())} className={cn("hidden h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink-2 hover:bg-surface-2 hover:text-ink sm:flex", pending && "animate-spin")} aria-label="Refresh"><ArrowsClockwiseIcon size={16} weight="bold" /></button>
        <Link href="/notifications" className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-line text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Notifications">
          <BellIcon size={16} weight="fill" />
          {unread > 0 && <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white tnum">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex items-center rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-accent" aria-label="Account menu">
            <Avatar src={user.avatarUrl} name={user.name} size={36} />
          </button>
          {menu && (
            <div className="absolute right-0 top-11 z-20 w-56 rounded-[12px] border border-line bg-surface p-1 shadow-[var(--shadow-float)] fade-in">
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium text-ink">{user.name}</p>
                <p className="text-[12px] text-ink-2">{user.title}</p>
              </div>
              <div className="my-1 border-t border-line" />
              <form action="/api/auth/logout" method="post">
                <button className="flex h-8 w-full items-center gap-2 rounded-[8px] px-3 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"><SignOutIcon size={15} weight="fill" /> Sign out</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
