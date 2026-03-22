"use client";

import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  color?: "default" | "success" | "warning" | "danger";
}

const colorMap = {
  default: "border-[var(--border)]",
  success: "border-[var(--success)]/30",
  warning: "border-[var(--warning)]/30",
  danger: "border-[var(--danger)]/30",
};

const valueColorMap = {
  default: "text-white",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
};

export function StatCard({ title, value, subtitle, color = "default" }: StatCardProps) {
  return (
    <div className={cn("bg-[var(--bg-card)] rounded-xl border p-5", colorMap[color])}>
      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-medium">{title}</p>
      <p className={cn("text-2xl font-bold mt-2", valueColorMap[color])}>{value}</p>
      {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
    </div>
  );
}
