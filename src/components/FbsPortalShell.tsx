"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Boxes, ChevronLeft, ClipboardCheck, LogOut, Pin, Printer, Settings, Users, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFbsPrinterIndicator, type FbsPrintAgent } from "@/lib/fbs-printer-status";

type PortalPayload = {
  activeOrganizationId: number;
  user: { id: number; email: string; name: string; isAdmin: boolean };
  organizations: Array<{
    id: number; displayName: string; legalName: string; inn: string | null;
    canAssembly: boolean; canStock: boolean;
  }>;
};

export function FbsPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [printAgents, setPrintAgents] = useState<FbsPrintAgent[] | null>(null);
  const expanded = pinned || hovered || mobileOpen;

  useEffect(() => {
    fetch("/api/fbs-portal/organizations", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((result) => { if (result) setPayload(result); })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    function organizationRenamed(event: Event) {
      const detail = (event as CustomEvent<{ organizationId?: number; displayName?: string }>).detail;
      if (!detail?.organizationId || !detail.displayName) return;
      setPayload((current) => current ? {
        ...current,
        organizations: current.organizations.map((organization) => organization.id === detail.organizationId
          ? { ...organization, displayName: detail.displayName as string }
          : organization),
      } : current);
    }
    window.addEventListener("fbs-organization-renamed", organizationRenamed);
    return () => window.removeEventListener("fbs-organization-renamed", organizationRenamed);
  }, []);

  const active = useMemo(() => payload?.organizations.find((organization) => organization.id === payload.activeOrganizationId) || payload?.organizations[0], [payload]);
  useEffect(() => {
    if (!active?.canAssembly) {
      setPrintAgents(null);
      return;
    }
    let cancelled = false;
    const refresh = () => fetch("/api/fbs?printerStatus=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!cancelled && result) setPrintAgents(Array.isArray(result.printAgents) ? result.printAgents : []);
      })
      .catch(() => undefined);
    const statusChanged = (event: Event) => {
      const agents = (event as CustomEvent<FbsPrintAgent[]>).detail;
      if (Array.isArray(agents)) setPrintAgents(agents);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener("fbs-printer-status-changed", statusChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("fbs-printer-status-changed", statusChanged);
    };
  }, [active?.canAssembly, active?.id]);

  const printerIndicator = getFbsPrinterIndicator(printAgents);
  const printerColor = printerIndicator.tone === "ready"
    ? "text-emerald-500"
    : printerIndicator.tone === "warning"
      ? "text-amber-500"
      : printerIndicator.tone === "error"
        ? "text-red-500"
        : "text-[var(--text-muted)]";
  const printerDot = printerIndicator.tone === "ready"
    ? "bg-emerald-500"
    : printerIndicator.tone === "warning"
      ? "bg-amber-500"
      : printerIndicator.tone === "error"
        ? "bg-red-500"
        : "bg-slate-400";
  const primaryItems = [
    ...(active?.canAssembly ? [{ href: "/fbs", label: "FBS Сборка", icon: ClipboardCheck }] : []),
    ...(active?.canStock ? [{ href: "/fbs-stock", label: "FBS Управление остатками", icon: Boxes }] : []),
    ...(active?.canAssembly ? [{ href: "/printer", label: "Принтер", icon: Printer }] : []),
  ];
  const adminItems = [
    ...(payload?.user.isAdmin ? [{ href: "/users", label: "Сотрудники", icon: Users }] : []),
    ...(payload?.user.isAdmin ? [{ href: "/settings", label: "Настройки", icon: Settings }] : []),
  ];

  async function switchOrganization(organizationId: number) {
    if (organizationId === payload?.activeOrganizationId) return;
    const response = await fetch("/api/fbs-portal/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    if (!response.ok) return;
    const target = payload?.organizations.find((organization) => organization.id === organizationId);
    const staysInAdminSection = pathname === "/users" || pathname === "/settings";
    const staysOnPrinter = pathname === "/printer" && target?.canAssembly;
    const nextPath = staysInAdminSection || staysOnPrinter ? pathname : target?.canAssembly ? "/fbs" : "/fbs-stock";
    window.location.assign(nextPath);
  }

  async function logout() {
    await fetch("/api/fbs-portal/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  return <div className="min-h-screen bg-[var(--bg)]">
    {!mobileOpen && <button type="button" onClick={() => setMobileOpen(true)} className="fixed left-4 top-4 z-[80] flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-card)] md:hidden" aria-label="Открыть меню">☰</button>}
    {mobileOpen && <button type="button" className="fixed inset-0 z-[50] bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню" />}
    <aside onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className={cn("fixed inset-y-0 left-0 z-[70] flex flex-col border-r border-[var(--border)] bg-[var(--bg-card)] transition-all duration-200", expanded ? "w-64" : "w-16", mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")}>
      <div className={cn("flex h-16 items-center border-b border-[var(--border)]", expanded ? "justify-between px-4" : "justify-center px-2")}>
        {expanded ? <Link href="/fbs" className="flex items-center gap-2 text-xl font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white"><Warehouse size={20} /></span><span>FBS Склад</span></Link> : <Warehouse className="text-[var(--accent)]" size={23} />}
        {expanded && <button type="button" onClick={() => setPinned((value) => !value)} className={cn("hidden h-8 w-8 items-center justify-center rounded-lg md:flex", pinned ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-muted)]")} aria-label={pinned ? "Свернуть меню" : "Закрепить меню"}>{pinned ? <Pin size={16} className="rotate-45" /> : <ChevronLeft size={18} />}</button>}
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {primaryItems.map((item) => {
          const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const printerItem = item.href === "/printer";
          return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} title={expanded ? undefined : printerItem ? `${item.label}: ${printerIndicator.label}` : item.label} className={cn("flex items-center py-3 text-base transition-colors", expanded ? "gap-3 px-5" : "justify-center px-3", selected ? "border-r-2 border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]")}><span className="relative shrink-0"><item.icon size={21} className={cn("shrink-0", printerItem && printerColor)} />{printerItem && <span className={cn("absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-card)]", printerDot)} aria-hidden="true" />}</span>{expanded && <span className="flex min-w-0 flex-1 items-center justify-between gap-2"><span>{item.label}</span>{printerItem && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", printerDot)} title={printerIndicator.label} />}</span>}</Link>;
        })}
      </nav>
      {adminItems.length > 0 && <nav className="shrink-0 pb-2">
        {adminItems.map((item) => {
          const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} title={expanded ? undefined : item.label} className={cn("flex items-center py-3 text-base transition-colors", expanded ? "gap-3 px-5" : "justify-center px-3", selected ? "border-r-2 border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]")}><item.icon size={21} className="shrink-0" />{expanded && <span>{item.label}</span>}</Link>;
        })}
      </nav>}
      <div className="border-t border-[var(--border)] p-3">
        <button type="button" onClick={() => void logout()} title={expanded ? undefined : "Выйти"} className={cn("flex w-full items-center rounded-xl py-2.5 text-red-500 hover:bg-red-500/10", expanded ? "gap-3 px-3" : "justify-center")}><LogOut size={20} />{expanded && <span className="font-medium">Выйти</span>}</button>
      </div>
    </aside>
    <header className={cn("fixed right-0 top-0 z-40 flex min-h-16 items-center justify-end gap-3 border-b border-[var(--border)] bg-[var(--bg-card)]/95 px-4 backdrop-blur transition-all md:px-6", pinned ? "left-0 md:left-64" : "left-0 md:left-16")}>
      {payload && <>
        <select value={payload.activeOrganizationId} onChange={(event) => void switchOrganization(Number(event.target.value))} className="max-w-[360px] rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 font-medium">
          {payload.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.displayName}</option>)}
        </select>
      </>}
    </header>
    <main className={cn("min-w-0 pt-20 transition-all", pinned ? "md:ml-64" : "md:ml-16")}>{children}</main>
  </div>;
}
