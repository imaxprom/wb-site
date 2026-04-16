"use client";

import { useState, useEffect } from "react";
import { formatNumber } from "@/lib/utils";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const RUB = (v: number) => formatNumber(v) + " ₽";
const fmtDate = (d: string) => d.slice(8) + "." + d.slice(5, 7);

interface ForecastArticle {
  nm_id: number; article: string; custom_name: string; orders: number; buyout: number;
  avg_price: number; cogs_unit: number; logistics_unit: number;
  commission_unit: number; tax_unit: number; profit_per_unit: number;
  ad_spend: number; storage: number; penalties: number;
  estimated_revenue: number; estimated_profit: number;
}

interface ForecastDay {
  date: string; orders: number; orders_rub: number;
  estimated_revenue: number; estimated_profit_before_ads: number;
  ad_spend: number; storage: number; penalties: number; overhead: number;
  estimated_profit: number; running_profit: number; running_revenue: number;
  articles: ForecastArticle[];
}

// ── Column definitions ──
interface ColDef {
  key: string;
  label: string;
  shortLabel?: string;
  dayFn: (d: ForecastDay) => string;
  artFn?: (a: ForecastArticle) => string;
  defaultOn: boolean;
}

/** Средневзвешенное по артикулам (вес = orders × buyout/100) */
function wavg(d: ForecastDay, field: keyof ForecastArticle): string {
  let sumW = 0, sumV = 0;
  for (const a of d.articles) {
    const w = a.orders * (a.buyout / 100);
    sumW += w;
    sumV += w * (a[field] as number);
  }
  return sumW > 0 ? RUB(Math.round(sumV / sumW)) : "—";
}

const COLUMNS: ColDef[] = [
  { key: "orders",     label: "Заказы",          dayFn: d => formatNumber(d.orders),                    artFn: a => String(a.orders),        defaultOn: true },
  { key: "orders_rub", label: "Заказы ₽",        dayFn: d => RUB(d.orders_rub),                         artFn: a => `${a.buyout}%`,          defaultOn: true },
  { key: "est_rev",    label: "Прогн. выручка",  dayFn: d => RUB(d.estimated_revenue),                  artFn: a => RUB(a.estimated_revenue), defaultOn: true },
  { key: "avg_price",  label: "Ср. цена/шт",     dayFn: d => wavg(d, "avg_price"),                      artFn: a => RUB(a.avg_price),        defaultOn: false },
  { key: "cogs",       label: "Себест./шт",      dayFn: d => wavg(d, "cogs_unit"),                      artFn: a => RUB(a.cogs_unit),        defaultOn: false },
  { key: "logistics",  label: "Логист./шт",      dayFn: d => wavg(d, "logistics_unit"),                  artFn: a => RUB(a.logistics_unit),   defaultOn: false },
  { key: "commission", label: "Комисс./шт",      dayFn: d => wavg(d, "commission_unit"),                 artFn: a => RUB(a.commission_unit),  defaultOn: false },
  { key: "tax",        label: "Налоги/шт",       dayFn: d => wavg(d, "tax_unit"),                        artFn: a => RUB(a.tax_unit),         defaultOn: false },
  { key: "ppu",        label: "Прибыль/шт",      dayFn: d => wavg(d, "profit_per_unit"),                 artFn: a => RUB(a.profit_per_unit),  defaultOn: true },
  { key: "storage",    label: "Хранение",        dayFn: d => RUB(d.storage),                            artFn: a => a.storage ? RUB(a.storage) : "—", defaultOn: true },
  { key: "penalties",  label: "Штрафы",          dayFn: d => d.penalties ? RUB(d.penalties) : "—",       artFn: a => a.penalties ? RUB(a.penalties) : "—", defaultOn: false },
  { key: "ad_spend",   label: "Реклама",         dayFn: d => RUB(d.ad_spend),                           artFn: a => a.ad_spend ? RUB(a.ad_spend) : "—", defaultOn: true },
  { key: "profit_ba",  label: "До рекламы",      dayFn: d => RUB(d.estimated_profit_before_ads),        artFn: () => "",                     defaultOn: false },
  { key: "est_profit", label: "Прогн. прибыль",  dayFn: d => RUB(d.estimated_profit),                   artFn: a => RUB(a.estimated_profit), defaultOn: true },
  { key: "running",    label: "Нарастающая",     dayFn: d => RUB(d.running_profit),                     artFn: () => "",                     defaultOn: true },
];

export default function ForecastTab({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [data, setData] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ econFrom: string; econTo: string; econDays: number; articlesCount: number } | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => new Set(COLUMNS.filter(c => c.defaultOn).map(c => c.key)));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    fetch(`/api/finance/forecast?from=${dateFrom}&to=${dateTo}`)
      .then(r => r.json())
      .then(resp => {
        setData(Array.isArray(resp?.days) ? resp.days : (Array.isArray(resp) ? resp : []));
        if (resp?.meta) setMeta(resp.meta);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dateFrom, dateTo]);

  if (loading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">Расчёт прогноза...</div>;
  }

  if (!data.length) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
        <p className="text-xl font-medium">Нет данных для прогноза</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">Нужны заказы в таблице shipment_orders</p>
      </div>
    );
  }

  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const totalRevenue = data.reduce((s, d) => s + d.estimated_revenue, 0);
  const totalAds = data.reduce((s, d) => s + d.ad_spend, 0);
  const totalProfit = data.reduce((s, d) => s + d.estimated_profit, 0);
  const totalProfitBeforeAds = data.reduce((s, d) => s + d.estimated_profit_before_ads, 0);
  const fmtM = (v: number) => { if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M"; if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + "k"; return String(v); };

  const chartData = data.map(d => ({
    date: fmtDate(d.date),
    profit: d.estimated_profit,
    ads: d.ad_spend,
    orders_rub: d.orders_rub,
    running_profit: d.running_profit,
    running_revenue: d.running_revenue,
  }));

  const cols = COLUMNS.filter(c => visibleCols.has(c.key));

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] px-4 py-3">
        <p className="text-xs text-[var(--text-muted)]">
          Прогноз прибыли: <strong className="text-[var(--text)]">заказы × % выкупа × прибыль/шт − реклама − хранение − штрафы</strong>.
          {meta && <> Юнит-экономика за <strong className="text-[var(--text)]">{fmtDate(meta.econFrom)} — {fmtDate(meta.econTo)}</strong> ({meta.articlesCount} артикулов). % выкупа — исторический.</>}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase">Заказов</p>
          <p className="text-2xl font-bold text-white mt-1">{formatNumber(totalOrders)} шт</p>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase">Прогноз выручки</p>
          <p className="text-2xl font-bold text-white mt-1">{RUB(totalRevenue)}</p>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase">Реклама</p>
          <p className="text-2xl font-bold text-[var(--warning)] mt-1">{RUB(totalAds)}</p>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase">Прогноз прибыли</p>
          <p className={`text-2xl font-bold mt-1 ${totalProfit >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{RUB(totalProfit)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">без рекламы: {RUB(totalProfitBeforeAds)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">Динамика показателей</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 12 }} />
              <YAxis tickFormatter={fmtM} tick={{ fill: "#8888a0", fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e4e4ef" }} itemStyle={{ color: "#e4e4ef" }} formatter={(v: unknown) => RUB(Number(v))} itemSorter={(item) => { const order: Record<string, number> = { "Реклама": 0, "Прибыль": 1 }; return order[item.name as string] ?? 9; }} />
              <Legend iconSize={10} wrapperStyle={{ color: "#8888a0", fontSize: 14 }} formatter={(value: string) => <span style={{ verticalAlign: "middle" }}>{value}</span>} />
              <Bar dataKey="profit" name="Прибыль" stackId="stack" fill="#66BB6A" />
              <Bar dataKey="ads" name="Реклама" stackId="stack" fill="#F4A236" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">Нарастающая: выручка vs прибыль</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="date" tick={{ fill: "#8888a0", fontSize: 12 }} />
              <YAxis tickFormatter={fmtM} tick={{ fill: "#8888a0", fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 8, color: "#e4e4ef" }} formatter={(v: unknown) => RUB(Number(v))} />
              <Legend iconSize={10} wrapperStyle={{ color: "#8888a0", fontSize: 14 }} formatter={(value: string) => <span style={{ verticalAlign: "middle" }}>{value}</span>} />
              <Line type="monotone" dataKey="running_revenue" name="Выручка" stroke="var(--success)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="running_profit" name="Прибыль" stroke="var(--accent)" strokeWidth={2} dot={false} strokeDasharray="6 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide">Прогноз по дням</h3>
          {/* Column settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white hover:border-[var(--accent)] transition-colors text-xs"
            >
              Столбцы ({cols.length}/{COLUMNS.length})
            </button>
            {showSettings && (
              <div className="absolute right-0 top-10 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 shadow-xl min-w-[200px]">
                {COLUMNS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 py-1 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={visibleCols.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                      className="rounded"
                    />
                    <span className={visibleCols.has(c.key) ? "text-white" : "text-[var(--text-muted)]"}>{c.label}</span>
                  </label>
                ))}
                <div className="border-t border-[var(--border)] mt-2 pt-2 flex gap-2">
                  <button onClick={() => setVisibleCols(new Set(COLUMNS.map(c => c.key)))} className="text-[10px] text-[var(--accent)] hover:underline">Все</button>
                  <button onClick={() => setVisibleCols(new Set(COLUMNS.filter(c => c.defaultOn).map(c => c.key)))} className="text-[10px] text-[var(--text-muted)] hover:underline">По умолчанию</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Дата</th>
                {cols.map(c => <th key={c.key} className="num">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map(row => (
                <>
                  <tr
                    key={row.date}
                    className="cursor-pointer hover:bg-[var(--bg-card-hover)]"
                    onClick={() => setExpandedDay(expandedDay === row.date ? null : row.date)}
                  >
                    <td className="font-mono text-[var(--text-muted)]">
                      {expandedDay === row.date ? "▾" : "▸"} {fmtDate(row.date)}
                    </td>
                    {cols.map(c => {
                      const val = c.dayFn(row);
                      const isProfit = c.key === "est_profit";
                      return (
                        <td key={c.key} className={`num ${isProfit ? (row.estimated_profit >= 0 ? "cell-positive" : "cell-negative") : ""} ${c.key === "running" ? "text-[var(--accent)]" : ""}`}>
                          {val || "—"}
                        </td>
                      );
                    })}
                  </tr>
                  {expandedDay === row.date && row.articles.map(art => (
                    <tr key={`${row.date}-${art.nm_id}`} className="bg-[var(--bg)]/50 text-xs">
                      <td className="pl-6">
                        <div className="flex items-center gap-0">
                          <span className="text-[var(--text-muted)] w-[90px] shrink-0 font-mono text-[11px]">{art.nm_id}</span>
                          <span className="text-[var(--text-muted)] opacity-60 w-[120px] shrink-0 truncate text-[11px]" title={art.article}>{art.article}</span>
                          {art.custom_name && <span className="text-white font-medium truncate text-xs" title={art.custom_name}>{art.custom_name}</span>}
                        </div>
                      </td>
                      {cols.map(c => {
                        const val = c.artFn?.(art) || "";
                        const isProfit = c.key === "est_profit";
                        return (
                          <td key={c.key} className={`num ${isProfit ? (art.estimated_profit >= 0 ? "cell-positive" : "cell-negative") : ""}`}>
                            {val || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
