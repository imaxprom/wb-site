"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { StatCard } from "@/components/StatCard";
import DateRangePicker from "@/components/DateRangePicker";
import { formatNumber } from "@/lib/utils";
import ReconciliationTab from "@/components/ReconciliationTab";
import type {
  PnlApiResult, PnlData, DailyRow, FilterOptions,
  ArticleRow, AdCampaign, TaxSettings,
} from "@/types/finance";

async function loadTaxSettings(): Promise<TaxSettings> {
  try {
    const res = await fetch("/api/finance/tax-settings");
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return { usnRate: 1.0, ndsRate: 5.0 };
}
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  ComposedChart,
  Line,
  LineChart,
  AreaChart,
  Area,
  LabelList,
  ResponsiveContainer,
} from "recharts";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
const RUB = (v: number) => formatNumber(v) + " ₽";
const PCT = (v: number) => v.toFixed(1) + "%";
const QTY = (v: number) => formatNumber(v) + " шт";

const CAMPAIGN_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4",
  "#a78bfa", "#f472b6", "#fb923c", "#34d399", "#60a5fa",
];

function marginStatus(m: number) {
  if (m > 15) return "✅";
  if (m >= 10) return "⚠️";
  if (m >= 0) return "❌";
  return "💀";
}

function marginColor(m: number) {
  if (m > 15) return "text-[var(--success)]";
  if (m >= 10) return "text-[var(--warning)]";
  return "text-[var(--danger)]";
}

// ────────────────────────────────────────────────────────────
// Tab button component
// ────────────────────────────────────────────────────────────
function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium rounded-lg transition-colors border " +
        (active
          ? "bg-[var(--bg-card-hover)] text-white border-[var(--accent)]"
          : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]")
      }
    >
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Waterfall chart data builder
// ────────────────────────────────────────────────────────────
function buildWaterfall(pnl: PnlData) {
  const other = pnl.revenue - pnl.cogs - pnl.logistics - pnl.ad_spend - pnl.tax_total - pnl.net_profit;
  const steps = [
    { name: "Выручка", value: pnl.revenue, type: "income" },
    { name: "Себестоимость", value: pnl.cogs, type: "expense" },
    { name: "Логистика", value: pnl.logistics, type: "expense" },
    { name: "Реклама", value: pnl.ad_spend, type: "expense" },
    { name: "Налоги", value: pnl.tax_total, type: "expense" },
    { name: "Прочее", value: Math.max(other, 0), type: "expense" },
    { name: "Прибыль", value: pnl.net_profit, type: "profit" },
  ];

  let running = 0;
  return steps.map((s) => {
    if (s.type === "income") {
      running += s.value;
      return { name: s.name, base: 0, bar: s.value, type: s.type };
    } else if (s.type === "expense") {
      running -= s.value;
      return { name: s.name, base: running, bar: s.value, type: s.type };
    } else {
      return { name: s.name, base: 0, bar: s.value, type: s.type };
    }
  });
}

// ────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────
type Tab = "pnl" | "daily" | "articles" | "ads" | "reconciliation" | "forecast";

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("pnl");
  const [pnl, setPnl] = useState<PnlApiResult | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ suppliers: [], brands: [], subjects: [], articles: [], sizes: [] });
  const [loading, setLoading] = useState(true);

  // Filter state for "По дням" tab
  const [filterSupplier, setFilterSupplier] = useState<string>("");
  const [filterBrand, setFilterBrand] = useState<string>("");
  const [filterSubject, setFilterSubject] = useState<string>("");
  const [filterArticle, setFilterArticle] = useState<string>("");
  const [filterSize, setFilterSize] = useState<string>("");

  // Period filter
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  // Tax settings (loaded from API → SQLite)
  const [taxSettings, setTaxSettings] = useState<TaxSettings>({ usnRate: 1.0, ndsRate: 5.0 });

  // Article table state
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<keyof ArticleRow>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Load period data from API ──
  const loadPeriodData = useCallback(async (from: string, to: string, nmId?: number) => {
    setLoading(true);
    const nmParam = nmId ? `&nm_id=${nmId}` : "";
    const [pnlData, dailyData, articlesData, adsData] = await Promise.all([
      fetch(`/api/finance/pnl?from=${from}&to=${to}${nmParam}`).then((r) => r.json()),
      fetch(`/api/finance/daily?from=${from}&to=${to}${nmParam}`).then((r) => r.json()),
      fetch(`/api/finance/articles?from=${from}&to=${to}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/finance/ads?from=${from}&to=${to}`).then((r) => r.json()).catch(() => []),
    ]);
    setPnl(pnlData);
    setDaily(dailyData);
    setArticles(articlesData);
    setAds(adsData);
    setLoading(false);
  }, []);

  // ── Initialize period: 30 days ending yesterday ──
  useEffect(() => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - 1); // вчера
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 29); // 30 дней включительно
    setDateFrom(startDate.toISOString().slice(0, 10));
    setDateTo(endDate.toISOString().slice(0, 10));
  }, []);

  // ── Load filters, articles, ads once ──
  useEffect(() => {
    fetch("/api/finance/filters")
      .then((r) => r.json())
      .then((fo) => { if (fo && fo.suppliers) setFilterOptions(fo); })
      .catch(() => {});

    // Articles and ads loaded when period changes (see loadPeriodData effect)

    loadTaxSettings().then(setTaxSettings);
  }, []);

  // ── Reload when period or article filter changes ──
  useEffect(() => {
    if (dateFrom && dateTo) {
      const nmId = filterArticle ? Number(filterArticle) : undefined;
      loadPeriodData(dateFrom, dateTo, nmId);
    }
  }, [dateFrom, dateTo, filterArticle, loadPeriodData]);

  // ── daily from API is already filtered — use as-is ──
  const filteredDaily = daily;

  // ── Recalculate PnL: API provides aggregated values, we only add taxes ──
  const recalcPnl = useMemo((): PnlData | null => {
    if (!pnl) return null;
    const ppvz = pnl.ppvz;
    // НДС и УСН от retail_amount (Вайлдберриз реализовал Товар) — как в эталоне ЛК WB
    const ndsBase = pnl.retail_amount || ppvz;
    const nds = ndsBase * taxSettings.ndsRate / (100 + taxSettings.ndsRate);
    const usn = (ndsBase - nds) * (taxSettings.usnRate / 100);
    const totalRevenue = pnl.realization;
    const netProfit = totalRevenue - pnl.total_services - pnl.cogs - usn - nds;
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const profitability = pnl.cogs > 0 ? (netProfit / pnl.cogs) * 100 : 0;
    const ddr = totalRevenue > 0 ? (pnl.ad_spend / totalRevenue) * 100 : 0;
    return {
      period:
        dateFrom && dateTo
          ? `${dateFrom.slice(8)}.${dateFrom.slice(5, 7)}.${dateFrom.slice(0, 4)} — ${dateTo.slice(8)}.${dateTo.slice(5, 7)}.${dateTo.slice(0, 4)}`
          : "",
      ppvz,
      realization: pnl.realization,
      loyalty_compensation: pnl.loyalty_compensation || 0,
      revenue: totalRevenue,
      commission: pnl.commission,
      logistics: pnl.logistics,
      ad_spend: pnl.ad_spend,
      cogs: pnl.cogs,
      total_services: pnl.total_services,
      other_services: pnl.other_services,
      jam: pnl.jam || 0,
      storage: pnl.storage,
      penalty: pnl.penalty,
      acceptance: pnl.acceptance,
      rebill: pnl.rebill,
      net_qty: pnl.net_qty,
      sales_qty: pnl.sales_qty,
      returns_qty: pnl.returns_qty,
      sales_rpwd: pnl.sales_rpwd,
      returns_rpwd: pnl.returns_rpwd,
      orders_sum: pnl.orders_sum,
      usn,
      nds,
      tax_total: usn + nds,
      net_profit: netProfit,
      margin,
      profitability,
      ddr,
      profit_per_unit: pnl.net_qty > 0 ? netProfit / pnl.net_qty : 0,
      cancel_rate: 0,
      avg_buyout_rate: 0,
      total_orders: 0,
      total_cancels: 0,
      cogs_pct: pnl.realization > 0 ? (pnl.cogs / pnl.realization) * 100 : 0,
      logistics_pct: pnl.realization > 0 ? (pnl.logistics / pnl.realization) * 100 : 0,
      ad_pct: pnl.realization > 0 ? (pnl.ad_spend / pnl.realization) * 100 : 0,
    };
  }, [pnl, taxSettings, dateFrom, dateTo]);

  // ── Waterfall data ──
  const waterfallData = useMemo(() => (recalcPnl ? buildWaterfall(recalcPnl) : []), [recalcPnl]);

  // ── Pie data ──
  const pieData = useMemo(() => {
    if (!recalcPnl) return [];
    const p = recalcPnl;
    const other = p.realization - p.total_services - p.cogs - p.tax_total - p.net_profit;
    return [
      { name: "Себестоимость", value: p.cogs },
      { name: "Комиссия WB", value: p.commission },
      { name: "Логистика", value: p.logistics },
      { name: "Реклама", value: p.ad_spend },
      { name: "Налоги", value: p.tax_total },
      { name: "Прочее", value: Math.max(other, 0) },
    ];
  }, [recalcPnl]);

  const PIE_COLORS = ["#ef4444", "#a78bfa", "#f59e0b", "#6366f1", "#22c55e", "#8888a0"];

  // ── Ads DRR ──
  const totalAdSpend = useMemo(() => ads.reduce((s, c) => s + c.total, 0), [ads]);
  const drr = useMemo(() => (recalcPnl ? (totalAdSpend / recalcPnl.realization) * 100 : 0), [recalcPnl, totalAdSpend]);

  // ── Ads stacked chart data ──
  const adsChartData = useMemo(() => {
    if (!ads.length) return [];
    const allDates = new Set<string>();
    ads.forEach((c) => Object.keys(c.daily).forEach((d) => allDates.add(d)));
    return Array.from(allDates)
      .sort()
      .map((date) => {
        const row: Record<string, string | number> = { date };
        ads.forEach((c) => { row[c.name] = c.daily[date] || 0; });
        return row;
      });
  }, [ads]);

  // ── Sorted articles ──
  const sortedArticles = useMemo(() => {
    return [...articles].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [articles, sortKey, sortDir]);

  function toggleSort(key: keyof ArticleRow) {
    if (sortKey === key) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Forecast / cumulative data (uses filteredDaily) ──
  const forecastData = useMemo(() => {
    if (!filteredDaily.length) return [];
    let runningProfit = 0;
    let runningRevenue = 0;
    return filteredDaily.map((row) => {
      runningProfit += row.profit;
      runningRevenue += row.realization;
      return {
        date: row.date.slice(5),
        realization: row.realization,
        orders_rub: row.orders_rub,
        profit: row.profit,
        running_profit: runningProfit,
        running_revenue: runningRevenue,
      };
    });
  }, [filteredDaily]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">
        Загрузка финансов…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="relative">
          <h2 className="text-2xl font-bold">Период</h2>
          <button
            onClick={() => setShowPeriodPicker(!showPeriodPicker)}
            className="text-sm text-[var(--text-muted)] mt-2 px-3 py-1 border border-[var(--border)] rounded-lg hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            {dateFrom && dateTo
              ? `${dateFrom.slice(8)}.${dateFrom.slice(5, 7)}.${dateFrom.slice(0, 4)} — ${dateTo.slice(8)}.${dateTo.slice(5, 7)}.${dateTo.slice(0, 4)}`
              : recalcPnl?.period || "Выберите период"}
          </button>
          {showPeriodPicker && (
            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
              onClose={() => setShowPeriodPicker(false)}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/finance/settings"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            📦 Себестоимость
          </Link>
          <Link
            href="/finance/taxes"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            🧾 Налоги
          </Link>
          <Link
            href="/finance/formulas"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            📐 Формулы
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(["pnl", "daily", "articles", "ads", "reconciliation", "forecast"] as Tab[]).map((t) => (
          <TabBtn
            key={t}
            label={{ pnl: "Отчёты", daily: "По дням", articles: "Артикулы", ads: "Реклама", reconciliation: "Сверка", forecast: "Прогноз" }[t]}
            active={tab === t}
            onClick={() => setTab(t)}
          />
        ))}
      </div>

      {/* ══════════════ TAB: Отчёт ══════════════ */}
      {tab === "pnl" && recalcPnl && (() => {
        const p = recalcPnl;
        const taxesCosts = p.cogs + p.tax_total;
        const taxesCostsPct = p.realization > 0 ? Math.round(taxesCosts / p.realization * 100) : 0;
        const servicesPct = p.realization > 0 ? Math.round(p.total_services / p.realization * 100) : 0;
        const salesPct = p.sales_rpwd > 0 ? p.sales_rpwd / (p.sales_rpwd + p.returns_rpwd) * 100 : 100;
        const lastDay = filteredDaily.length > 0 ? filteredDaily[filteredDaily.length - 1] : null;
        const prevDay = filteredDaily.length > 1 ? filteredDaily[filteredDaily.length - 2] : null;
        const lastDate = lastDay?.date || "";
        const svcItems = [
          { name: "Комиссия", value: p.commission, color: "#F4A236" },
          { name: "Логистика", value: p.logistics, color: "#29B6F6" },
          { name: "Реклама", value: p.ad_spend, color: "#AB47BC" },
          { name: "Остальные", value: p.other_services, color: "#666" },
          { name: "Джем", value: p.jam || 0, color: "#FF7043" },
        ];
        const taxItems = [
          { name: "Налог", value: p.usn, color: "#EF5350" },
          { name: "НДС к уплате", value: p.nds, color: "#42A5F5" },
          { name: "Себестоимость продаж", value: p.cogs, color: "#26A69A" },
        ];
        const metricCards = [
          { title: "Заказы", value: p.orders_sum, color: "#F4A236", dataKey: "orders_rub" as const },
          { title: "Продажи", value: p.sales_rpwd, color: "#42A5F5", dataKey: "sales_rub" as const },
          { title: "Логистика", value: p.logistics, color: "#29B6F6", dataKey: "logistics" as const },
          { title: "Реклама", value: p.ad_spend, color: "#AB47BC", dataKey: "ad_spend" as const },
          { title: "Все услуги", value: p.total_services, color: "#6366f1", dataKey: "commission" as const },
        ];
        const fmtM = (v: number) => { if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M"; if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + "k"; return String(v); };
        const trend = (cur: number, prev: number) => prev > 0 ? Math.round((cur - prev) / prev * 100) : 0;

        return (
          <div className="space-y-4">
            {/* ROW 1 — 4 Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Реализация */}
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Реализация</p>
                <p className="text-3xl font-bold text-white mt-1">{RUB(p.revenue)}</p>
                <div className="mt-3 h-1.5 rounded-full overflow-hidden flex" style={{ background: "#2a2a3a" }}>
                  <div style={{ width: `${salesPct}%`, background: "#66BB6A" }} className="rounded-full" />
                  <div style={{ width: `${100 - salesPct}%`, background: "#EF5350" }} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center text-xs"><div className="w-2.5 h-2.5 rounded-full mr-2" style={{ background: "#66BB6A" }} /><span className="text-[var(--text-muted)]">Продажи</span><span className="ml-auto font-medium text-[var(--text)]">{RUB(p.sales_rpwd)}</span></div>
                  <div className="flex items-center text-xs"><div className="w-2.5 h-2.5 rounded-full mr-2" style={{ background: "#EF5350" }} /><span className="text-[var(--text-muted)]">Возвраты</span><span className="ml-auto font-medium text-[var(--text)]">{RUB(p.returns_rpwd)}</span></div>
                  {p.loyalty_compensation > 0 && (
                    <div className="flex items-center text-xs"><div className="w-2.5 h-2.5 rounded-full mr-2" style={{ background: "#42A5F5" }} /><span className="text-[var(--text-muted)]">Компенсация WB</span><span className="ml-auto font-medium text-[var(--text)]">{RUB(p.loyalty_compensation)}</span></div>
                  )}
                </div>
              </div>
              {/* Card 2: Услуги */}
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Услуги</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <p className="text-2xl font-bold text-white">{RUB(p.total_services)}</p>
                  <span className="text-xs bg-[var(--bg-card-hover)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">{servicesPct}%</span>
                </div>
                <div className="mt-3 h-1.5 rounded-full overflow-hidden flex" style={{ background: "#2a2a3a" }}>
                  {svcItems.map((s, i) => <div key={i} style={{ width: `${p.total_services > 0 ? s.value / p.total_services * 100 : 0}%`, background: s.color }} />)}
                </div>
                <div className="mt-3 space-y-1.5">
                  {svcItems.map((s, i) => (
                    <div key={i} className="flex items-center text-xs"><div className="w-2.5 h-2.5 rounded-full mr-2" style={{ background: s.color }} /><span className="text-[var(--text-muted)]">{s.name}</span><span className="ml-auto font-medium text-[var(--text)]">{RUB(s.value)}</span><span className="ml-1.5 text-xs bg-[var(--bg-card-hover)] px-1.5 py-0.5 rounded-full text-[var(--text-muted)]">{p.realization > 0 ? Math.round(s.value / p.realization * 100) : 0}%</span></div>
                  ))}
                </div>
              </div>
              {/* Card 3: Налоги и затраты */}
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Налоги и затраты</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <p className="text-2xl font-bold text-white">{RUB(taxesCosts)}</p>
                  <span className="text-xs bg-[var(--bg-card-hover)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">{taxesCostsPct}%</span>
                </div>
                <div className="mt-3 h-1.5 rounded-full overflow-hidden flex" style={{ background: "#2a2a3a" }}>
                  {taxItems.map((t, i) => <div key={i} style={{ width: `${taxesCosts > 0 ? t.value / taxesCosts * 100 : 0}%`, background: t.color }} />)}
                </div>
                <div className="mt-3 space-y-1.5">
                  {taxItems.map((t, i) => (
                    <div key={i} className="flex items-center text-xs"><div className="w-2.5 h-2.5 rounded-full mr-2" style={{ background: t.color }} /><span className="text-[var(--text-muted)]">{t.name}</span><span className="ml-auto font-medium text-[var(--text)]">{RUB(t.value)}</span><span className="ml-1.5 text-xs bg-[var(--bg-card-hover)] px-1.5 py-0.5 rounded-full text-[var(--text-muted)]">{p.realization > 0 ? Math.round(t.value / p.realization * 100) : 0}%</span></div>
                  ))}
                </div>
              </div>
              {/* Card 4: Операционная прибыль */}
              <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Операционная прибыль</p>
                <p className="text-3xl font-bold text-white mt-1">{RUB(p.net_profit)}</p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-[var(--text-muted)]">Маржинальность</span><span className="font-medium text-white">{PCT(p.margin)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-[var(--text-muted)]">Рентабельность</span><span className="font-medium text-white">{p.profitability !== undefined ? PCT(p.profitability) : "—"}</span></div>
                </div>
                {filteredDaily.length > 0 && (
                  <div className="mt-2">
                    <ResponsiveContainer width="100%" height={60}>
                      <AreaChart data={filteredDaily.map(d => ({ p: d.profit, day: d.date.slice(8) + "." + d.date.slice(5, 7) }))} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, fontSize: 12 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.day || ""} formatter={(v: unknown) => [RUB(Number(v)), "Прибыль"]} />
                        <Area type="monotone" dataKey="p" stroke="#66BB6A" fill="#66BB6A" fillOpacity={0.15} strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* ROW 2 — 5 Metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {metricCards.map((mc, idx) => {
                const lastVal = lastDay ? (lastDay as unknown as Record<string, number>)[mc.dataKey] || 0 : 0;
                const prevVal = prevDay ? (prevDay as unknown as Record<string, number>)[mc.dataKey] || 0 : 0;
                const tr = trend(lastVal, prevVal);
                return (
                  <div key={idx} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{mc.title}</p>
                      <p className="text-xs text-[var(--text-muted)]">{lastDate ? `${lastDate.slice(8)}.${lastDate.slice(5, 7)}.${lastDate.slice(0, 4)}` : ""}</p>
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">{RUB(mc.value)}</p>
                    <p className={`text-xs mt-1 ${tr >= 0 ? "text-[#66BB6A]" : "text-[#EF5350]"}`}>{tr >= 0 ? "+" : ""}{tr}% за день</p>
                    {filteredDaily.length > 0 && (
                      <div className="mt-2">
                        <ResponsiveContainer width="100%" height={40}>
                          <AreaChart data={filteredDaily.map(d => ({ v: (d as unknown as Record<string, number>)[mc.dataKey] || 0, day: d.date.slice(8) + "." + d.date.slice(5, 7) }))} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, fontSize: 11 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.day || ""} formatter={(v: unknown) => [RUB(Number(v)), mc.title]} />
                            <Area type="monotone" dataKey="v" stroke={mc.color} fill={mc.color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ROW 3 — Stacked Bar Chart */}
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
              <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">Динамика показателей</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredDaily.map(d => ({ ...d, day: d.date.slice(8) + "." + d.date.slice(5, 7) + "." + d.date.slice(0, 4) }))} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis dataKey="day" tick={{ fill: "#8888a0", fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => fmtM(v)} tick={{ fill: "#8888a0", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e4e4ef" }} itemStyle={{ color: "#e4e4ef" }} labelStyle={{ color: "#e4e4ef" }} formatter={(v) => RUB(Number(v))} itemSorter={(item) => { const order: Record<string, number> = { "Заказы": 0, "Продажи": 1, "Прибыль": 2 }; return order[item.name as string] ?? 9; }} />
                  <Legend wrapperStyle={{ color: "#8888a0", fontSize: 12 }} />
                  <Bar dataKey="profit" name="Прибыль" stackId="stack" fill="#66BB6A" />
                  <Bar dataKey="sales_rub" name="Продажи" stackId="stack" fill="#42A5F5">
                    <LabelList content={(props) => {
                      const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                      const val = filteredDaily[index]?.sales_rub ?? 0;
                      return <text key={`sl-${index}`} x={x + width / 2} y={y + height / 2 + 3} textAnchor="middle" fill="#000" fontSize={9}>{formatNumber(Math.round(val))}</text>;
                    }} />
                  </Bar>
                  <Bar dataKey="orders_rub" name="Заказы" stackId="stack" fill="#F4A236" radius={[4, 4, 0, 0]}>
                    <LabelList content={(props) => {
                      const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                      const val = filteredDaily[index]?.orders_rub ?? 0;
                      return <text key={`ol-${index}`} x={x + width / 2} y={y + height / 2 + 3} textAnchor="middle" fill="#000" fontSize={9}>{formatNumber(Math.round(val))}</text>;
                    }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ══════════════ TAB: По дням ══════════════ */}
      {tab === "daily" && (
        <div className="space-y-4">
          {/* Filter row */}
          {filterOptions.suppliers.length > 0 && (
            <div className="flex flex-wrap gap-3 items-center">
              <select
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Все юрлица</option>
                {filterOptions.suppliers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Все бренды</option>
                {filterOptions.brands.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Все предметы</option>
                {filterOptions.subjects.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={filterArticle}
                onChange={(e) => setFilterArticle(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Арт. WB</option>
                {filterOptions.articles.map((a) => (
                  <option key={a.nm_id} value={String(a.nm_id)}>{a.nm_id}</option>
                ))}
              </select>
              <select
                value={filterArticle ? (filterOptions.articles.find(a => String(a.nm_id) === filterArticle)?.sa_name || "") : ""}
                onChange={(e) => {
                  const sa = e.target.value;
                  if (sa) {
                    const art = filterOptions.articles.find(a => a.sa_name === sa);
                    setFilterArticle(art ? String(art.nm_id) : "");
                  } else {
                    setFilterArticle("");
                  }
                }}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Арт. продавца</option>
                {filterOptions.articles.map((a) => (
                  <option key={a.nm_id} value={a.sa_name}>{a.sa_name}</option>
                ))}
              </select>
              <select
                value={filterSize}
                onChange={(e) => setFilterSize(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Все размеры</option>
                {filterOptions.sizes.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {(filterSupplier || filterBrand || filterSubject || filterArticle || filterSize) && (
                <button
                  onClick={() => {
                    setFilterSupplier("");
                    setFilterBrand("");
                    setFilterSubject("");
                    setFilterArticle("");
                    setFilterSize("");
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white transition-colors"
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}

          {/* Active filter badges */}
          {(filterSupplier || filterBrand || filterSubject || filterArticle || filterSize) && (
            <div className="flex flex-wrap gap-2 text-xs">
              {filterSupplier && (
                <span className="bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)] px-2 py-1 rounded-full">
                  Юрлицо: {filterSupplier}
                </span>
              )}
              {filterBrand && (
                <span className="bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)] px-2 py-1 rounded-full">
                  Бренд: {filterBrand}
                </span>
              )}
              {filterSubject && (
                <span className="bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)] px-2 py-1 rounded-full">
                  Предмет: {filterSubject}
                </span>
              )}
              {filterArticle && (
                <span className="bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)] px-2 py-1 rounded-full">
                  Артикул WB: {filterArticle}
                </span>
              )}
              {filterSize && (
                <span className="bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)] px-2 py-1 rounded-full">
                  Размер: {filterSize}
                </span>
              )}
            </div>
          )}

          {/* Supplier info banner */}
          {!filterSupplier && filterOptions.suppliers.length === 1 && (
            <div className="text-sm text-[var(--text-muted)] px-1">
              Юрлицо: <span className="text-[var(--text)] font-medium">{filterOptions.suppliers[0]}</span>
            </div>
          )}

          {filteredDaily.length === 0 ? (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
              Нет данных за выбранный период
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                {(() => {
                  const SECTIONS = [
                    { name: "Период",     cols: 1,  bg: "#12121a", border: "#555" },
                    { name: "Деньги",     cols: 4,  bg: "#142a14", border: "#22c55e" },
                    { name: "Штуки",      cols: 3,  bg: "#1a1a38", border: "#818cf8" },
                    { name: "Услуги WB",  cols: 5,  bg: "#2a1414", border: "#ef4444" },
                    { name: "Итог",       cols: 2,  bg: "#2a2a10", border: "#f59e0b" },
                  ] as const;

                  type ColDef = {
                    key: keyof DailyRow | "margin_pct";
                    label: string;
                    section: number;
                    first?: boolean;
                    rub?: boolean;
                    qty?: boolean;
                    pct?: boolean;
                    date?: boolean;
                  };

                  const COLS: ColDef[] = [
                    // Период
                    { key: "date", label: "Дата", section: 0, date: true },
                    // Деньги
                    { key: "realization", label: "Реализация", section: 1, first: true, rub: true },
                    { key: "sales_rub", label: "Продажи", section: 1, rub: true },
                    { key: "returns_rub", label: "Возвраты", section: 1, rub: true },
                    { key: "orders_rub", label: "Заказы", section: 1, rub: true },
                    // Штуки
                    { key: "sales_qty", label: "Продажи шт", section: 2, first: true, qty: true },
                    { key: "returns_qty", label: "Возвраты шт", section: 2, qty: true },
                    { key: "net_qty", label: "Итого шт", section: 2, qty: true },
                    // Услуги
                    { key: "commission", label: "Комиссия", section: 3, first: true, rub: true },
                    { key: "logistics", label: "Логистика", section: 3, rub: true },
                    { key: "storage", label: "Хранение", section: 3, rub: true },
                    { key: "penalty", label: "Штрафы", section: 3, rub: true },
                    { key: "ad_spend", label: "Реклама", section: 3, rub: true },
                    // Итог
                    { key: "cogs", label: "Себестоим.", section: 4, first: true, rub: true },
                    { key: "profit", label: "Прибыль", section: 4, rub: true },
                  ];

                  return (
                    <table style={{ fontSize: 14, borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                      <thead>
                        <tr>
                          {SECTIONS.map((s, i) => (
                            <th
                              key={i}
                              colSpan={s.cols}
                              style={{
                                textAlign: "center",
                                background: s.bg,
                                borderLeft: `2px solid ${s.border}`,
                                borderBottom: `2px solid ${s.border}`,
                                padding: "10px 8px",
                                fontSize: "12px",
                                fontWeight: 700,
                                color: "#e4e4ef",
                                letterSpacing: "0.03em",
                              }}
                            >
                              {s.name}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {COLS.map((col, i) => {
                            const sec = SECTIONS[col.section];
                            return (
                              <th
                                key={i}
                                style={{
                                  background: sec.bg,
                                  borderLeft: col.first ? `2px solid ${sec.border}` : undefined,
                                  padding: "8px 10px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: "#8888a0",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {col.label}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDaily.map((row) => {
                          const margin = row.realization > 0 ? (row.profit / row.realization) * 100 : 0;
                          return (
                            <tr key={row.date}>
                              {COLS.map((col, i) => {
                                const sec = SECTIONS[col.section];
                                const rawVal = col.key === "margin_pct" ? margin : row[col.key as keyof DailyRow];
                                const numVal = typeof rawVal === "number" ? rawVal : 0;
                                return (
                                  <td
                                    key={i}
                                    style={{
                                      borderLeft: col.first ? `2px solid ${sec.border}` : undefined,
                                      textAlign: col.date ? "left" : "right",
                                      fontVariantNumeric: "tabular-nums",
                                      fontSize: "13px",
                                      padding: "8px 10px",
                                      whiteSpace: "nowrap",
                                      color:
                                        col.key === "profit"
                                          ? numVal >= 0 ? "#66BB6A" : "#EF5350"
                                          : undefined,
                                    }}
                                  >
                                    {col.date
                                      ? (rawVal as string).slice(8) + "." + (rawVal as string).slice(5, 7)
                                      : col.rub
                                      ? formatNumber(Math.round(numVal)) + " ₽"
                                      : col.qty
                                      ? formatNumber(numVal) + " шт"
                                      : col.pct
                                      ? numVal.toFixed(1) + "%"
                                      : formatNumber(Math.round(numVal))}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB: Артикулы ══════════════ */}
      {tab === "articles" && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Юнит-экономика по артикулам
          </h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  {(
                    [
                      ["article", "Артикул"],
                      ["sales_qty", "Продажи шт"],
                      ["revenue", "Выручка"],
                      ["cogs_unit", "Себ/шт"],
                      ["log_per_unit", "Логист/шт"],
                      ["ad_allocated", "Реклама"],
                      ["margin", "Маржа %"],
                      ["profit_per_unit", "Прибыль/шт"],
                    ] as [keyof ArticleRow, string][]
                  ).map(([key, label]) => (
                    <th
                      key={key}
                      className={key !== "article" ? "num cursor-pointer select-none" : "cursor-pointer select-none"}
                      onClick={() => toggleSort(key)}
                    >
                      {label} {sortKey === key ? (sortDir === "desc" ? "↓" : "↑") : ""}
                    </th>
                  ))}
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {sortedArticles.map((art) => (
                  <>
                    <tr
                      key={art.nm_id}
                      className="cursor-pointer"
                      onClick={() => toggleExpand(art.nm_id)}
                    >
                      <td className="font-mono text-[var(--accent)] text-xs">{art.article}</td>
                      <td className="num">{QTY(art.sales_qty)}</td>
                      <td className="num">{RUB(art.revenue)}</td>
                      <td className="num">{RUB(art.cogs_unit)}</td>
                      <td className="num">{RUB(art.log_per_unit)}</td>
                      <td className="num">{RUB(art.ad_allocated)}</td>
                      <td className={`num font-semibold ${marginColor(art.margin)}`}>{PCT(art.margin)}</td>
                      <td className="num">{RUB(art.profit_per_unit)}</td>
                      <td className="text-center text-lg">{marginStatus(art.margin)}</td>
                    </tr>
                    {expanded.has(art.nm_id) && (
                      <tr key={`${art.nm_id}-exp`}>
                        <td colSpan={9} className="p-0">
                          <div className="bg-[var(--bg)] border-t border-b border-[var(--border)] px-4 py-3">
                            <p className="text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                              Детализация по дням
                            </p>
                            <table className="data-table text-xs">
                              <thead>
                                <tr>
                                  <th>Дата</th>
                                  <th className="num">Заказы</th>
                                  <th className="num">Отмены</th>
                                  <th className="num">Продажи</th>
                                  <th className="num">Возвраты</th>
                                  <th className="num">Выручка</th>
                                </tr>
                              </thead>
                              <tbody>
                                {art.daily.map((d) => (
                                  <tr key={d.date}>
                                    <td className="font-mono text-[var(--text-muted)]">{d.date}</td>
                                    <td className="num">{formatNumber(d.orders)}</td>
                                    <td className="num cell-negative">{formatNumber(d.cancels)}</td>
                                    <td className="num">{formatNumber(d.sales)}</td>
                                    <td className="num cell-warning">{formatNumber(d.returns)}</td>
                                    <td className="num">{d.revenue > 0 ? RUB(d.revenue) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════ TAB: Реклама ══════════════ */}
      {tab === "ads" && (
        <div className="space-y-6">
          {/* DRR badge */}
          <div className="flex items-center gap-4">
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] px-6 py-4">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Общий DRR</p>
              <p className={`text-2xl font-bold mt-1 ${drr < 12 ? "text-[var(--success)]" : drr < 18 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>
                {PCT(drr)}
              </p>
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] px-6 py-4">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Расход всего</p>
              <p className="text-2xl font-bold mt-1 text-[var(--danger)]">{RUB(totalAdSpend)}</p>
            </div>
          </div>

          {/* Table */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
              Кампании
            </h3>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Название кампании</th>
                    <th className="num">Расход</th>
                    <th className="num">Дней</th>
                    <th className="num">Средний/день</th>
                  </tr>
                </thead>
                <tbody>
                  {ads.map((c) => {
                    const days = Object.keys(c.daily).length;
                    return (
                      <tr key={c.id}>
                        <td className="font-medium">{c.name}</td>
                        <td className="num cell-negative">{RUB(c.total)}</td>
                        <td className="num text-[var(--text-muted)]">{days}</td>
                        <td className="num">{days > 0 ? RUB(Math.round(c.total / days)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stacked bar chart */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
              Расход по дням (stacked)
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={adsChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 10 }} />
                <YAxis
                  tickFormatter={(v) => formatNumber(Math.round(v / 1000)) + "k"}
                  tick={{ fill: "#8888a0", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e4e4ef" }}
                  itemStyle={{ color: "#e4e4ef" }}
                  formatter={(v) => RUB(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {ads.map((c, i) => (
                  <Bar key={c.id} dataKey={c.name} stackId="a" fill={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ══════════════ TAB: Сверка ══════════════ */}
      {tab === "reconciliation" && (
        <ReconciliationTab />
      )}

      {/* ══════════════ TAB: Прогноз ══════════════ */}
      {tab === "forecast" && (
        <div className="space-y-6">
          {/* LineChart */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
              Нарастающая: реализация vs прибыль
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={forecastData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) => formatNumber(Math.round(v / 1000)) + "k"}
                  tick={{ fill: "#8888a0", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e4e4ef" }}
                  itemStyle={{ color: "#e4e4ef" }}
                  formatter={(v) => RUB(Number(v))}
                />
                <Legend />
                <Line type="monotone" dataKey="running_revenue" name="Нарастающая реализация" stroke="var(--success)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="running_profit" name="Нарастающая прибыль" stroke="var(--accent)" strokeWidth={2} dot={false} strokeDasharray="6 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
              Прибыль по дням
            </h3>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th className="num">Реализация</th>
                    <th className="num">Заказы ₽</th>
                    <th className="num">Прибыль</th>
                    <th className="num">Нараст. реализация</th>
                    <th className="num">Нараст. прибыль</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastData.map((row) => (
                    <tr key={row.date}>
                      <td className="font-mono text-[var(--text-muted)]">{row.date}</td>
                      <td className="num">{RUB(row.realization)}</td>
                      <td className="num">{RUB(row.orders_rub)}</td>
                      <td className={`num ${row.profit >= 0 ? "cell-positive" : "cell-negative"}`}>{RUB(row.profit)}</td>
                      <td className="num text-[var(--success)]">{RUB(row.running_revenue)}</td>
                      <td className="num text-[var(--accent)]">{RUB(row.running_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
