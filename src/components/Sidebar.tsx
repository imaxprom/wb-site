"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/analytics", label: "Аналитика", icon: "📈" },
  { href: "/", label: "Дашборд", icon: "📊" },
  { href: "/products", label: "Товары", icon: "🏷️" },
  { href: "/shipment", label: "Расчёт отгрузки", icon: "📦" },
  { href: "/upload", label: "Загрузка данных", icon: "📁" },
  { href: "/settings", label: "Настройки", icon: "⚙️" },
];

export function Sidebar() {
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
          "fixed left-0 top-0 h-screen w-60 bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col z-20 transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="p-5 border-b border-[var(--border)]">
          <h1 className="text-lg font-bold text-white">WB Отгрузка</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Калькулятор отгрузки</p>
        </div>

        <nav className="flex-1 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-5 py-3 text-sm transition-colors",
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] border-r-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          IMSI · Бренд нижнего белья
        </div>
      </aside>
    </>
  );
}
