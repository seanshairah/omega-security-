"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { HouseIcon, ShieldCheckIcon, BroadcastIcon, EyeIcon, PaperPlaneTiltIcon, CalendarBlankIcon, ClipboardTextIcon, WarningOctagonIcon, UsersThreeIcon, BuildingsIcon, MapPinIcon, ChatTextIcon, ArticleIcon, ChartBarIcon, UserGearIcon, GearSixIcon, ListMagnifyingGlassIcon, CaretUpIcon, CaretDownIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, DeviceMobileIcon, XIcon } from "@phosphor-icons/react";
import { BrandMark, COMPANY } from "./brand";
import { cn } from "@/lib/cn";
import { Count } from "@/components/ui/status";

type Item = { href: string; label: string; icon: React.ElementType; count?: number; urgent?: boolean };
type Group = { label: string; icon: React.ElementType; items: Item[] };

export type SidebarCounts = { attention: number; incidents: number; watched: number };

export function Sidebar({ counts, role, onClose }: { counts: SidebarCounts; role: string; onClose?: () => void }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ Operations: true, Workforce: true, Communications: true });

  const groups: Group[] = [
    { label: "Operations", icon: ShieldCheckIcon, items: [
      { href: "/dashboard", label: "Overview", icon: HouseIcon },
      { href: "/operations", label: "Active operations", icon: BroadcastIcon, count: counts.attention, urgent: counts.attention > 0 },
      { href: "/monitoring", label: "Monitoring", icon: EyeIcon, count: counts.watched },
      { href: "/shifts", label: "Shifts", icon: CalendarBlankIcon },
      { href: "/attendance", label: "Attendance", icon: ClipboardTextIcon },
      { href: "/incidents", label: "Incidents", icon: WarningOctagonIcon, count: counts.incidents },
    ] },
    { label: "Workforce", icon: UsersThreeIcon, items: [
      { href: "/guards", label: "Guards", icon: UsersThreeIcon },
      { href: "/clients", label: "Clients", icon: BuildingsIcon },
      { href: "/locations", label: "Locations", icon: MapPinIcon },
    ] },
    { label: "Communications", icon: ChatTextIcon, items: [
      { href: "/messages/new", label: "Compose", icon: PaperPlaneTiltIcon },
      { href: "/sms", label: "Message logs", icon: ChatTextIcon },
      { href: "/sms/templates", label: "Templates", icon: ArticleIcon },
    ] },
  ];
  const singles: Item[] = [
    { href: "/reports", label: "Reports", icon: ChartBarIcon },
    ...(role === "SUPER_ADMIN" ? [{ href: "/users", label: "Users", icon: UserGearIcon }, { href: "/audit", label: "Audit log", icon: ListMagnifyingGlassIcon }] : []),
    { href: "/settings", label: "Settings", icon: GearSixIcon },
  ];
  const isActive = (href: string) => (href === "/sms" ? path === "/sms" : path === href || path.startsWith(href + "/"));

  return (
    <aside className={cn("sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200", collapsed ? "w-[68px]" : "w-[264px] lg:w-[248px]")}>
      <div className={cn("flex h-16 items-center border-b border-line", collapsed ? "justify-center px-0" : "justify-between px-5")}>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={32} />
          {!collapsed && <span className="min-w-0"><span className="block text-[14px] font-semibold leading-[1.15] line-clamp-2 tracking-[-0.01em] text-ink">{COMPANY.name}</span><span className="block text-[11px] leading-tight text-ink-3">{COMPANY.portal}</span></span>}
        </Link>
        {!collapsed && (
          <>
            <button onClick={() => setCollapsed(true)} className="hidden rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink lg:block" aria-label="Collapse sidebar"><CaretDoubleLeftIcon size={16} weight="fill" /></button>
            <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Close menu"><XIcon size={18} weight="bold" /></button>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 scroll-thin">
        {!collapsed && (
          <form action="/guards" className="mb-3 lg:hidden">
            <input name="q" placeholder="Search guards" className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none" />
          </form>
        )}
        <Link href="/dashboard" className={cn("mb-1 flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] font-medium", path === "/dashboard" ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink", collapsed && "justify-center px-0")} title="Home">
          <HouseIcon size={18} weight="fill" className="shrink-0" />
          {!collapsed && "Home"}
        </Link>
        {groups.map((g) => (
          <div key={g.label} className="mb-1">
            <button onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))} className={cn("flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink", collapsed && "justify-center px-0")} title={g.label}>
              <g.icon size={18} weight="fill" className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{g.label}</span>}
              {!collapsed && (open[g.label] ? <CaretUpIcon size={12} weight="fill" /> : <CaretDownIcon size={12} weight="fill" />)}
            </button>
            {(open[g.label] || collapsed) && (
              <ul className={cn(collapsed ? "mt-1 space-y-1" : "ml-[19px] mt-0.5 space-y-0.5 border-l border-line pl-2")}>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} title={it.label} className={cn("flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px]", isActive(it.href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink", collapsed && "justify-center px-0")}>
                      {collapsed ? <it.icon size={17} weight="fill" /> : <span className="flex-1 truncate">{it.label}</span>}
                      {!collapsed && it.count ? <Count value={it.count} urgent={it.urgent} /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <div className="my-3 border-t border-line" />
        <ul className="space-y-0.5">
          {singles.map((it) => (
            <li key={it.href}>
              <Link href={it.href} title={it.label} className={cn("flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] font-medium", isActive(it.href) ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink", collapsed && "justify-center px-0")}>
                <it.icon size={18} weight="fill" className="shrink-0" />
                {!collapsed && it.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className={cn("p-3", collapsed && "px-2")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Link href="/simulator" title="SMS simulator" className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent text-white"><DeviceMobileIcon size={18} weight="fill" /></Link>
            <button onClick={() => setCollapsed(false)} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Expand sidebar"><CaretDoubleRightIcon size={16} weight="fill" /></button>
          </div>
        ) : (
          <div className="rounded-[14px] p-4 text-white" style={{ background: "linear-gradient(160deg, #78c653 0%, #5aa83e 100%)" }}>
            <p className="flex items-center gap-2 text-[14px] font-semibold leading-tight"><DeviceMobileIcon size={16} weight="fill" /> Demo mode</p>
            <p className="mt-1 text-[12px] leading-snug text-white/90">Simulate guard replies without sending real SMS.</p>
            <Link href="/simulator" className="mt-3 flex h-8 items-center justify-center rounded-[8px] bg-white text-[13px] font-semibold text-accent-strong hover:bg-white/90">Open simulator</Link>
          </div>
        )}
      </div>
    </aside>
  );
}
