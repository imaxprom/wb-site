"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/reviews", label: "Отзывы" },
  { href: "/reviews/replies", label: "Автоответы" },
  { href: "/reviews/complaints", label: "Автожалобы" },
  { href: "/reviews/connection", label: "Подключение WB" },
  { href: "/reviews/accounts", label: "Аккаунты" },
];

export function ReviewsSectionNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-1 border border-[var(--border)] w-fit max-w-full overflow-x-auto">
      {ITEMS.map((item) => {
        const active = item.href === "/reviews" ? pathname === "/reviews" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
              active
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
