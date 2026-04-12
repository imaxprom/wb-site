"use client";

import { useState, useEffect } from "react";

interface Check {
  id: string;
  name: string;
  status: "ok" | "warn" | "error";
  value: string;
  detail?: string;
}

interface HealthData {
  overall: "ok" | "warn" | "error";
  message: string;
  checks: Check[];
  timestamp: string;
}

const STATUS_ICON: Record<string, string> = { ok: "🟢", warn: "🟡", error: "🔴" };
const OVERALL_BG: Record<string, string> = {
  ok: "border-[var(--success)]/30 bg-[var(--success)]/5",
  warn: "border-[var(--warning)]/30 bg-[var(--warning)]/5",
  error: "border-[var(--danger)]/30 bg-[var(--danger)]/5",
};

export function DataHealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/monitor/data-health")
      .then(r => r.ok ? r.json() as Promise<HealthData> : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 animate-pulse">
        <div className="h-6 bg-[var(--bg)] rounded w-48 mb-3" />
        <div className="h-4 bg-[var(--bg)] rounded w-32" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--danger)]/30 rounded-xl p-5">
        <h3 className="font-medium text-[var(--danger)]">Здоровье данных — ошибка загрузки</h3>
      </div>
    );
  }

  const errors = data.checks.filter(c => c.status === "error");
  const warns = data.checks.filter(c => c.status === "warn");
  const oks = data.checks.filter(c => c.status === "ok");

  return (
    <div className={`border rounded-xl p-5 ${OVERALL_BG[data.overall]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{STATUS_ICON[data.overall]}</span>
          <div>
            <h3 className="font-bold text-base">{data.message}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {oks.length} ок · {warns.length} предупр. · {errors.length} ошибок
              <span className="ml-2">
                {new Date(data.timestamp).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          {expanded ? "Свернуть" : "Подробнее"}
        </button>
      </div>

      {/* Compact: только ошибки и предупреждения */}
      {!expanded && errors.length > 0 && (
        <div className="space-y-1 mt-2">
          {errors.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <span>🔴</span>
              <span className="text-[var(--danger)] font-medium">{c.name}</span>
              <span className="text-[var(--text-muted)]">{c.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Expanded: все проверки */}
      {expanded && (
        <div className="mt-3 space-y-1">
          {data.checks.map(c => (
            <div key={c.id} className="flex items-start gap-2 text-sm py-1 border-b border-[var(--border)]/30 last:border-0">
              <span className="mt-0.5">{STATUS_ICON[c.status]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{c.name}</span>
                  <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">{c.value}</span>
                </div>
                {c.detail && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{c.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
