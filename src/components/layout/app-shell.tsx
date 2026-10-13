"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar, type SidebarCounts } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/cn";

type Props = {
  counts: SidebarCounts;
  role: string;
  user: { name: string; avatarUrl: string | null; title: string | null };
  unread: number;
  systemStatus: { tone: "ok" | "warn" | "critical"; label: string };
  banner: React.ReactNode;
  children: React.ReactNode;
};

/** Sidebar is fixed on desktop and a slide-in drawer below the lg breakpoint. */
export function AppShell({ counts, role, user, unread, systemStatus, banner, children }: Props) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="flex min-h-screen">
      {open && <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className={cn("fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <Sidebar counts={counts} role={role} onClose={() => setOpen(false)} />
      </div>
      <div className="min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4 md:px-5">
        <Topbar user={user} unread={unread} systemStatus={systemStatus} onMenu={() => setOpen(true)} />
        {banner}
        <main className="fade-in">{children}</main>
      </div>
    </div>
  );
}
