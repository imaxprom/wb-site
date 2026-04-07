"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ChartData {
  date: string;
  total_reviews: number;
  negative_reviews: number;
  complaints: number;
}

interface ReviewsChartProps {
  data: ChartData[];
  onPeriodChange: (period: string) => void;
  currentPeriod: string;
}

const PERIODS = [
  { value: "month", label: "Месяц" },
  { value: "half", label: "Полгода" },
  { value: "year", label: "Год" },
];

function PeriodTabs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 bg-[var(--bg)] rounded-lg p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            value === p.value
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function formatDateTick(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function ReviewsDynamicsChart({ data, onPeriodChange, currentPeriod }: ReviewsChartProps) {
  const showDots = data.length <= 45;
  const tickInterval = data.length <= 15 ? 0 : data.length <= 35 ? 2 : Math.floor(data.length / 12);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Динамика отзывов
        </h3>
        <PeriodTabs value={currentPeriod} onChange={onPeriodChange} />
      </div>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[280px] text-[var(--text-muted)] text-sm">
          Нет данных за выбранный период
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              interval={tickInterval}
            />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 13,
              }}
              labelFormatter={(label) => formatDateTick(String(label))}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }}
            />
            <Line
              type="natural"
              dataKey="total_reviews"
              name="Всего отзывов"
              stroke="var(--text)"
              strokeWidth={2}
              dot={showDots ? { r: 2.5, fill: "var(--text)" } : false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="natural"
              dataKey="negative_reviews"
              name="Негативные"
              stroke="var(--danger)"
              strokeWidth={2}
              dot={showDots ? { r: 2.5, fill: "var(--danger)" } : false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

interface ComplaintChartData {
  date: string;
  submitted: number;
  approved: number;
}

interface ComplaintsChartProps {
  data: ComplaintChartData[];
  onPeriodChange: (period: string) => void;
  currentPeriod: string;
}

export function ComplaintsDynamicsChart({ data, onPeriodChange, currentPeriod }: ComplaintsChartProps) {
  const hasData = data.length > 0 && data.some((d) => d.submitted > 0);
  const showDots = data.length <= 45;
  const tickInterval = data.length <= 15 ? 0 : data.length <= 35 ? 2 : Math.floor(data.length / 12);

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Динамика жалоб на отзывы
        </h3>
        <PeriodTabs value={currentPeriod} onChange={onPeriodChange} />
      </div>
      {!hasData ? (
        <div className="flex items-center justify-center h-[280px] text-[var(--text-muted)] text-sm">
          Нет данных о жалобах
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              interval={tickInterval}
            />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 13,
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const submitted = payload.find(p => p.dataKey === "submitted")?.value as number || 0;
                const approved = payload.find(p => p.dataKey === "approved")?.value as number || 0;
                const pct = submitted > 0 ? Math.round((approved / submitted) * 100) : 0;
                return (
                  <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    <p style={{ color: "var(--text)", marginBottom: 4 }}>{formatDateTick(String(label))}</p>
                    <p style={{ color: "var(--text)" }}>Всего жалоб: <b>{submitted}</b></p>
                    <p style={{ color: "#22c55e" }}>Одобрено: <b>{approved}</b></p>
                    <p style={{ color: "var(--text-muted)" }}>Процент одобрения: <b>{pct}%</b></p>
                  </div>
                );
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }}
            />
            <Line
              type="natural"
              dataKey="submitted"
              name="Подано"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={showDots ? { r: 2.5, fill: "#3b82f6" } : false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="natural"
              dataKey="approved"
              name="Одобрено"
              stroke="#22c55e"
              strokeWidth={2}
              dot={showDots ? { r: 2.5, fill: "#22c55e" } : false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
