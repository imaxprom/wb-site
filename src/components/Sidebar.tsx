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
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_GROUPS = [
  [
    { href: "/analytics", label: "Аналитика", icon: BarChart3 },
    { href: "/reviews", label: "Отзывы", icon: MessageSquare },
    { href: "/finance", label: "Финансы", icon: DollarSign },
    { href: "/shipment", label: "Расчёт отгрузки", icon: Package },
    { href: "/logistics", label: "Расчёт логистики", icon: Truck },
    { href: "https://ads.imaxprom.site", label: "Реклама", icon: Megaphone, external: true },
    { href: "/warehouse", label: "Склад", icon: Warehouse },
    { href: "/supplies", label: "Поставки", icon: Package },
    { href: "/purchases", label: "Закупки", icon: ShoppingCart },
  ],
  [
    { href: "/monitor", label: "Мониторинг", icon: Activity },
    { href: "/changelog", label: "Журнал", icon: FileText },
    { href: "/docs", label: "База знаний", icon: BookOpen },
    { href: "/settings", label: "Настройки", icon: SettingsIcon },
  ],
];

export function Sidebar({ pinned, onTogglePinned }: { pinned: boolean; onTogglePinned: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [suppressHoverUntilLeave, setSuppressHoverUntilLeave] = useState(false);
  const [logisticsAlerts, setLogisticsAlerts] = useState(0);
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

  return (
    <>
      {/* Mobile burger */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-[70] md:hidden bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2 text-xl"
      >
        {open ? "✕" : "☰"}
      </button>

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
        <div className={cn("relative border-b border-[var(--border)] transition-all", expanded ? "p-4" : "h-14 p-2")}>
          {expanded && (
            <Link
              href="/analytics"
              onClick={() => setOpen(false)}
              className="flex h-10 items-center justify-start rounded-lg px-1 text-2xl font-bold tracking-normal transition-all"
              aria-label="MPHub"
            >
              <span className="text-[var(--text-muted)]">MP</span>
              <span className="text-[var(--accent)]">Hub</span>
            </Link>
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
              "absolute right-2 top-2 z-10 hidden h-8 w-8 items-center justify-center rounded-lg border transition-colors md:flex",
              pinned
                ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
            )}
            title={pinned ? "Открепить меню" : "Закрепить меню"}
            aria-label={pinned ? "Открепить меню" : "Закрепить меню"}
            aria-pressed={pinned}
          >
            <Pin size={16} className={cn("transition-transform", pinned && "rotate-45")} aria-hidden="true" />
          </button>
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
              {group.map((item) => {
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
                      <item.icon size={18} className="shrink-0" />
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
