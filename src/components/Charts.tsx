"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  type PieLabelRenderProps,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"];

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
}

function ChartCard({ title, children }: ChartCardProps) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 h-full">
      <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function SizeBarChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <ChartCard title="Заказы по размерам">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 13 }} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 13 }} />
          <Tooltip
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
            labelStyle={{ color: "var(--text)" }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} name="Заказы" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const REGION_SHORT: Record<string, string> = {
  "Центральный федеральный округ": "ЦФО",
  "Южный федеральный округ": "ЮФО",
  "Северо-Западный федеральный округ": "СЗФО",
  "Дальневосточный федеральный округ": "ДФО",
  "Северо-Кавказский федеральный округ": "СКФО",
  "Приволжский федеральный округ": "ПФО",
  "Уральский федеральный округ": "УФО",
  "Сибирский федеральный округ": "СФО",
};

function shortRegion(name: string): string {
  return REGION_SHORT[name] || name.split(" ")[0];
}

export function RegionPieChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  return (
    <ChartCard title="Заказы по регионам">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            label={(props: PieLabelRenderProps) => `${shortRegion(String(props.name || ""))} ${((props.percent || 0) * 100).toFixed(0)}%`}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function OrdersLineChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      date: date.substring(8, 10) + "." + date.substring(5, 7),
      count,
    }));

  // Show only last 30 points for readability
  const displayData = chartData.slice(-30);

  return (
    <ChartCard title="Заказы по дням (последние 30 дней)">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={displayData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 13 }} />
          <Tooltip
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
            labelStyle={{ color: "var(--text)" }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            name="Заказы"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DeficitBarChart({
  data,
}: {
  data: { size: string; plan: number; fact: number }[];
}) {
  return (
    <ChartCard title="План vs Факт по размерам">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="size" tick={{ fill: "var(--text-muted)", fontSize: 13 }} />
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 13 }} />
          <Tooltip
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
          />
          <Legend />
          <Bar dataKey="plan" fill="var(--accent)" radius={[4, 4, 0, 0]} name="План" />
          <Bar dataKey="fact" fill="var(--success)" radius={[4, 4, 0, 0]} name="Факт" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
