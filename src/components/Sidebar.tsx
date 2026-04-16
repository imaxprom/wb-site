"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  MessageSquare,
  DollarSign,
  Activity,
  Package,
  FileText,
  BookOpen,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/analytics", label: "Аналитика", icon: BarChart3 },
  { href: "/reviews", label: "Отзывы", icon: MessageSquare },
  { href: "/finance", label: "Финансы", icon: DollarSign },
  { href: "/monitor", label: "Мониторинг", icon: Activity },
  { href: "/shipment", label: "Расчёт отгрузки", icon: Package },
  { href: "/changelog", label: "Журнал", icon: FileText },
  { href: "/docs", label: "База знаний", icon: BookOpen },
  { href: "/settings", label: "Настройки", icon: SettingsIcon },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile burger */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-30 md:hidden bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2 text-xl"
      >
        {open ? "✕" : "☰"}
      </button>

      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-screen bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col z-20 transition-all duration-200",
          collapsed ? "w-16" : "w-60",
          open ? "translate-x-0 w-60" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn("border-b border-[var(--border)] transition-all", collapsed ? "p-2" : "p-4")}>
          <img
            src="/logo-mphub.jpg"
            alt="MpHub"
            className={cn("rounded-lg transition-all", collapsed ? "w-10 h-10 object-cover mx-auto" : "w-full h-auto")}
          />
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center text-base transition-colors",
                  collapsed ? "justify-center px-3 py-3" : "px-5 py-3",
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
                )}
              >
                <item.icon size={18} className={cn("shrink-0", !collapsed && "mr-2")} />
                {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={onToggle}
          className="hidden md:flex items-center justify-center border-t border-[var(--border)] py-2 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] transition-colors"
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </aside>
    </>
  );
}
