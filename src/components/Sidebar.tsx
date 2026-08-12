"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  MessageSquare,
  DollarSign,
  Activity,
  Package,
  Warehouse,
  Truck,
  ShoppingCart,
  Megaphone,
  FileText,
  BookOpen,
  Settings as SettingsIcon,
  Pin,
  Boxes,
  ClipboardCheck,
  Printer,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFbsPrinterIndicator, type FbsPrintAgent } from "@/lib/fbs-printer-status";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
  systemAdmin?: boolean;
};

const NAV_GROUPS: NavItem[][] = [
  [
    { href: "/analytics", label: "Аналитика", icon: BarChart3 },
    { href: "/reviews", label: "Отзывы", icon: MessageSquare },
    { href: "/finance", label: "Финансы", icon: DollarSign },
    { href: "/shipment", label: "Расчёт отгрузки", icon: Package },
    { href: "/logistics", label: "Расчёт логистики", icon: Truck },
    { href: "/api/advertising/open", label: "Реклама", icon: Megaphone, external: true },
    { href: "/warehouse", label: "Склад", icon: Warehouse },
    { href: "/fbs-stock", label: "FBS Управление остатками", icon: Boxes },
    { href: "/fbs", label: "FBS Сборка", icon: ClipboardCheck },
    { href: "/printer", label: "Принтер", icon: Printer },
    { href: "/supplies", label: "Поставки", icon: Package },
    { href: "/supply-reports", label: "Отчёты поставок", icon: FileText },
    { href: "/purchases", label: "Закупки", icon: ShoppingCart },
  ],
  [
    { href: "/monitor", label: "Мониторинг", icon: Activity, systemAdmin: true },
    { href: "/changelog", label: "Журнал", icon: FileText, systemAdmin: true },
    { href: "/docs", label: "База знаний", icon: BookOpen, systemAdmin: true },
    { href: "/settings", label: "Настройки", icon: SettingsIcon },
  ],
];

export function Sidebar({
  pinned,
  onTogglePinned,
  isSystemAdmin,
}: {
  pinned: boolean;
  onTogglePinned: () => void;
  isSystemAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [suppressHoverUntilLeave, setSuppressHoverUntilLeave] = useState(false);
  const [logisticsAlerts, setLogisticsAlerts] = useState(0);
  const [printAgents, setPrintAgents] = useState<FbsPrintAgent[] | null>(null);
  const expanded = pinned || hovered || open;

  useEffect(() => {
    let cancelled = false;

    fetch("/api/logistics/alerts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setLogisticsAlerts(Number(data.measurementOverCardCount) || 0);
      })
      .catch(() => {
        if (!cancelled) setLogisticsAlerts(0);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
  }, []);

  const printerIndicator = getFbsPrinterIndicator(printAgents);
  const printerColor = printerIndicator.tone === "ready" ? "text-emerald-500" : printerIndicator.tone === "warning" ? "text-amber-500" : printerIndicator.tone === "error" ? "text-red-500" : "text-[var(--text-muted)]";
  const printerDot = printerIndicator.tone === "ready" ? "bg-emerald-500" : printerIndicator.tone === "warning" ? "bg-amber-500" : printerIndicator.tone === "error" ? "bg-red-500" : "bg-slate-400";

  return (
    <>
      {/* Mobile burger */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed top-4 left-4 z-[70] flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-base leading-none md:hidden"
          aria-label="Открыть меню"
        >
          ☰
        </button>
      )}

      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-[50] md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={() => {
          if (!suppressHoverUntilLeave) setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setSuppressHoverUntilLeave(false);
        }}
        className={cn(
          "fixed left-0 top-0 h-screen bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col z-[60] transition-all duration-200",
          expanded ? "w-60 shadow-xl shadow-black/10 md:shadow-none" : "w-16",
          open ? "translate-x-0 w-60" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn("border-b border-[var(--border)] transition-all", expanded ? "p-4" : "h-14 p-2")}>
          <div className={cn("flex h-10 items-center", expanded ? "justify-between gap-2" : "justify-center")}>
            {expanded && (
              <Link
                href="/analytics"
                onClick={() => setOpen(false)}
                className="flex min-w-0 flex-1 items-center justify-start rounded-lg px-1 text-2xl font-bold tracking-normal transition-all"
                aria-label="MPHub"
              >
                <span className="text-[var(--text-muted)]">MP</span>
                <span className="text-[var(--accent)]">Hub</span>
              </Link>
            )}
            {open && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-base leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)] md:hidden"
                aria-label="Закрыть меню"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (pinned) {
                  setHovered(false);
                  setSuppressHoverUntilLeave(true);
                }
                onTogglePinned();
              }}
              className={cn(
                "hidden h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors md:flex",
                pinned
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
              )}
              title={pinned ? "Открепить меню" : "Закрепить меню"}
              aria-label={pinned ? "Открепить меню" : "Закрепить меню"}
              aria-pressed={pinned}
            >
              <Pin size={15} className={cn("transition-transform", pinned && "rotate-45")} aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={groupIndex}>
              {groupIndex > 0 && (
                <div
                  className={cn(
                    "my-3 border-t border-[var(--border)]/80",
                    expanded ? "mx-5" : "mx-4"
                  )}
                />
              )}
              {group.filter((item) => !item.systemAdmin || isSystemAdmin).map((item) => {
                const isActive = !item.external && (pathname === item.href || pathname.startsWith(item.href + "/"));
                const className = cn(
                  "flex items-center text-base transition-colors",
                  expanded ? "px-5 py-3" : "justify-center px-3 py-3",
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
                );
                const content = (
                  <>
                    <span className={cn("relative shrink-0", expanded && "mr-2")}>
                      <item.icon size={18} className={cn("shrink-0", item.href === "/printer" && printerColor)} />
                      {item.href === "/printer" && <span className={cn("absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-card)]", printerDot)} title={printerIndicator.label} />}
                      {item.href === "/logistics" && logisticsAlerts > 0 && !expanded && (
                        <span
                          className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center bg-[var(--danger)] text-[9px] font-bold leading-none text-white"
                          style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)", paddingTop: 4 }}
                          title={`Проблемные замеры WB: ${logisticsAlerts}`}
                        >
                          {logisticsAlerts}
                        </span>
                      )}
                    </span>
                    {expanded && (
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="whitespace-nowrap">{item.label}</span>
                        {item.href === "/logistics" && logisticsAlerts > 0 && (
                          <span
                            className="flex h-5 w-5 items-center justify-center bg-[var(--danger)] text-[10px] font-bold leading-none text-white"
                            style={{ clipPath: "polygon(50% 0, 100% 100%, 0 100%)", paddingTop: 5 }}
                            title={`Проблемные замеры WB: ${logisticsAlerts}`}
                            aria-label={`Проблемные замеры WB: ${logisticsAlerts}`}
                          >
                            {logisticsAlerts}
                          </span>
                        )}
                      </span>
                    )}
                  </>
                );
                if (item.external) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      title={expanded ? undefined : item.label}
                      className={className}
                    >
                      {content}
                    </a>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    title={expanded ? undefined : item.label}
                    className={className}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
