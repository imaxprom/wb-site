"use client";

import { useState, useEffect, useMemo } from "react";

interface ChangeItem {
  section: string;
  type: string;
  title: string;
  description: string;
}

interface ChangeDay {
  date: string;
  items: ChangeItem[];
}

interface BacklogItem {
  priority: string;
  section: string;
  title: string;
  description: string;
  addedDate: string;
}

interface ChangelogData {
  changes: ChangeDay[];
  backlog: BacklogItem[];
}

const SECTIONS: Record<string, { label: string; color: string }> = {
  finance: { label: "Финансы", color: "var(--accent)" },
  shipment: { label: "Отгрузка", color: "var(--warning)" },
  monitor: { label: "Мониторинг", color: "var(--success)" },
  general: { label: "Общее", color: "var(--text-muted)" },
};

const TYPES: Record<string, { icon: string; label: string }> = {
  feature: { icon: "🟢", label: "Новое" },
  fix: { icon: "🔧", label: "Исправление" },
  change: { icon: "🔄", label: "Изменение" },
  milestone: { icon: "🏆", label: "Веха" },
};

const PRIORITIES: Record<string, { icon: string; color: string; label: string }> = {
  high: { icon: "🔴", color: "var(--danger)", label: "Высокий" },
  medium: { icon: "🟡", color: "var(--warning)", label: "Средний" },
  low: { icon: "🟢", color: "var(--success)", label: "На будущее" },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return `${day}.${month}.${year}, ${weekdays[d.getDay()]}`;
}

export default function ChangelogPage() {
  const [data, setData] = useState<ChangelogData | null>(null);
  const [tab, setTab] = useState<"changes" | "backlog">("changes");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/data/changelog.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const sections = useMemo(() => {
    if (!data) return [];
    const all = new Set<string>();
    for (const day of data.changes) {
      for (const item of day.items) all.add(item.section);
    }
    for (const item of data.backlog) all.add(item.section);
    return Array.from(all);
  }, [data]);

  const filteredChanges = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.changes;
    return data.changes
      .map((day) => ({
        ...day,
        items: day.items.filter((i) => i.section === filter),
      }))
      .filter((day) => day.items.length > 0);
  }, [data, filter]);

  const filteredBacklog = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.backlog;
    return data.backlog.filter((i) => i.section === filter);
  }, [data, filter]);

  const groupedBacklog = useMemo(() => {
    const groups: Record<string, BacklogItem[]> = { high: [], medium: [], low: [] };
    for (const item of filteredBacklog) {
      (groups[item.priority] || groups.low).push(item);
    }
    return groups;
  }, [filteredBacklog]);

  // Stats
  const totalChanges = data?.changes.reduce((s, d) => s + d.items.length, 0) || 0;
  const totalBacklog = data?.backlog.length || 0;

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[var(--text-muted)]">Загрузка журнала...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">📋 Журнал проекта</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          История изменений и план доработок MpHub
        </p>
      </div>

      {/* Tabs + Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setTab("changes")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === "changes"
                ? "bg-[var(--bg-card-hover)] text-white"
                : "text-[var(--text-muted)] hover:text-white"
            }`}
          >
            Изменения ({totalChanges})
          </button>
          <button
            onClick={() => setTab("backlog")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)] ${
              tab === "backlog"
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-white"
            }`}
          >
            Доработки ({totalBacklog})
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === "all"
                ? "border-white/30 text-white bg-white/5"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            Все
          </button>
          {sections.map((s) => {
            const sec = SECTIONS[s] || { label: s, color: "var(--text-muted)" };
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filter === s
                    ? "text-white bg-white/5"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
                style={filter === s ? { borderColor: sec.color, color: sec.color } : { borderColor: "var(--border)" }}
              >
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Changes */}
      {tab === "changes" && (
        <div className="space-y-6">
          {filteredChanges.map((day) => (
            <div key={day.date}>
              <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                {formatDate(day.date)}
              </h2>
              <div className="space-y-2 pl-4 border-l-2 border-[var(--border)]">
                {day.items.map((item, i) => {
                  const sec = SECTIONS[item.section] || { label: item.section, color: "var(--text-muted)" };
                  const typ = TYPES[item.type] || { icon: "📝", label: item.type };
                  return (
                    <div
                      key={i}
                      className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-3 flex gap-3 items-start"
                    >
                      <span className="text-base mt-0.5 shrink-0">{typ.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
                            style={{ color: sec.color, background: `color-mix(in srgb, ${sec.color} 12%, transparent)` }}
                          >
                            {sec.label}
                          </span>
                          <h3 className="text-sm text-white font-medium">{item.title}</h3>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Backlog */}
      {tab === "backlog" && (
        <div className="space-y-5">
          {(["high", "medium", "low"] as const).map((prio) => {
            const items = groupedBacklog[prio] || [];
            if (items.length === 0) return null;
            const p = PRIORITIES[prio];
            return (
              <div key={prio}>
                <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: p.color }}>
                  {p.icon} {p.label}
                </h2>
                <div className="space-y-2">
                  {items.map((item, i) => {
                    const sec = SECTIONS[item.section] || { label: item.section, color: "var(--text-muted)" };
                    return (
                      <div
                        key={i}
                        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-3 flex gap-3 items-start"
                      >
                        <span className="text-base mt-0.5 shrink-0">{p.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
                              style={{ color: sec.color, background: `color-mix(in srgb, ${sec.color} 12%, transparent)` }}
                            >
                              {sec.label}
                            </span>
                            <h3 className="text-sm text-white font-medium">{item.title}</h3>
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{item.description}</p>
                          <p className="text-[10px] text-[var(--text-muted)] mt-1">Добавлено: {formatDate(item.addedDate)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
