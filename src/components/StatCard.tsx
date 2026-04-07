"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  color?: "default" | "success" | "warning" | "danger" | "danger-outline";
  tooltipItems?: string[];
}

const colorMap: Record<string, string> = {
  default: "border-[var(--border)]",
  success: "border-[var(--success)]/30",
  warning: "border-[var(--warning)]/30",
  danger: "border-[var(--danger)]/30",
  "danger-outline": "border-[var(--border)]",
};

const valueColorMap: Record<string, string> = {
  default: "text-white",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
  "danger-outline": "text-white",
};

export function StatCard({ title, value, subtitle, color = "default", tooltipItems }: StatCardProps) {
  const [show, setShow] = useState(false);
  const hasTooltip = tooltipItems && tooltipItems.length > 0;

  return (
    <div
      className={cn("bg-[var(--bg-card)] rounded-xl border p-5 relative", colorMap[color], hasTooltip && "cursor-default")}
      onMouseEnter={() => hasTooltip && setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => hasTooltip && setShow(prev => !prev)}
    >
      <p className="text-sm text-[var(--text-muted)] uppercase tracking-wide font-medium">{title}</p>
      <p className={cn("text-3xl font-bold mt-2", valueColorMap[color])} style={{fontVariantNumeric: 'tabular-nums'}}>{value}</p>
      {subtitle && <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>}

      {show && hasTooltip && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg p-3 min-w-48">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{title}</p>
          <div className="space-y-1">
            {tooltipItems.map((name, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", {
                  "bg-[var(--success)]": color === "success",
                  "bg-[var(--warning)]": color === "warning",
                  "bg-[var(--danger)]": color === "danger",
                  "bg-[var(--text-muted)]": color === "default" || color === "danger-outline",
                })} />
                <span className="text-white">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
