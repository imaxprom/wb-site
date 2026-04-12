"use client";

import React, { useMemo, useState, useCallback } from "react";
import { useData } from "@/components/DataProvider";
import { calculateShipmentV2, calculateDeficit, type ShipmentCalculationV2 } from "@/modules/shipment/lib/engine";
import { formatNumber } from "@/lib/utils";
import { useEffectiveRegions } from "@/modules/shipment/lib/use-effective-regions";
import { calculateTrend } from "@/lib/trend-engine";
import { useEffectiveBuyout } from "@/modules/shipment/lib/use-effective-buyout";
import { exportShipmentExcelV2 } from "@/lib/export-excel-v2";
import type { Product } from "@/types";
import { WarehouseBreakdown } from "./WarehouseBreakdown";
import type { TrendResult } from "@/lib/trend-engine";
import { InfoTip } from "@/components/Tooltip";

// ─── Trend Badge ────────────────────────────────────────────

function TrendBadge({ trend, v1Need, v2Need }: { trend: TrendResult; v1Need?: number; v2Need?: number }) {
  const icon = trend.direction === "up" ? "↗️" : trend.direction === "down" ? "↘️" : "→";
  const color =
    trend.direction === "up"
      ? "var(--success)"
      : trend.direction === "down"
        ? "var(--danger)"
        : "var(--text-muted)";
  const label =
    trend.direction === "up"
      ? "Растущий"
      : trend.direction === "down"
        ? "Падающий"
        : "Стабильный";

  const diffPercent = ((trend.multiplier - 1) * 100).toFixed(0);
  const diffSign = trend.multiplier >= 1 ? "+" : "";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
        style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <span className="text-base">{icon}</span>
        <span>{label} ({diffSign}{diffPercent}%)</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>V1: {formatNumber(v1Need ?? 0)} шт</span>
        <span>→</span>
        <span style={{ color }}>V2: {formatNumber(v2Need ?? 0)} шт</span>
      </div>
      <div
        className="text-[10px] px-2 py-0.5 rounded-full"
        style={{
          color: trend.confidence === "high" ? "var(--success)" : trend.confidence === "medium" ? "var(--warning)" : "var(--text-muted)",
          background:
            trend.confidence === "high"
              ? "color-mix(in srgb, var(--success) 10%, transparent)"
              : trend.confidence === "medium"
                ? "color-mix(in srgb, var(--warning) 10%, transparent)"
                : "color-mix(in srgb, var(--text-muted) 10%, transparent)",
        }}
      >
        R² = {trend.r2.toFixed(2)} ({trend.confidence === "high" ? "высокая" : trend.confidence === "medium" ? "средняя" : "низкая"} точность)<InfoTip term="r2" />
      </div>
    </div>
  );
}

// ─── Weekly Chart ───────────────────────────────────────────

function WeeklyChart({ trend }: { trend: TrendResult }) {
  const max = Math.max(...trend.weekly.map((w) => w.orders), trend.forecast, 1);

  return (
    <div className="space-y-1.5">
      {trend.weekly.map((w) => (
        <div key={w.week} className="flex items-center gap-2 text-xs">
          <span className="w-14 text-[var(--text-muted)] text-right shrink-0">{w.label}</span>
          <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden relative">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${(w.orders / max) * 100}%`,
                background: "var(--accent)",
                minWidth: w.orders > 0 ? "4px" : "0",
              }}
            />
          </div>
          <span className="w-16 text-right text-white font-mono text-[11px]">
            {formatNumber(w.orders)}
          </span>
          <span className="w-24 text-[10px] text-[var(--text-muted)] shrink-0">{w.dateRange}</span>
        </div>
      ))}
      {/* Forecast bar */}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-[var(--warning)] text-right shrink-0 font-medium">Прогн.</span>
        <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden relative">
          <div
            className="h-full rounded"
            style={{
              width: `${(trend.forecast / max) * 100}%`,
              background: trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--warning)",
              opacity: 0.6,
              minWidth: trend.forecast > 0 ? "4px" : "0",
            }}
          />
          {/* Dashed overlay */}
          <div
            className="absolute inset-0 h-full rounded"
            style={{
              width: `${(trend.forecast / max) * 100}%`,
              backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0,0,0,0.3) 4px, rgba(0,0,0,0.3) 8px)",
            }}
          />
        </div>
        <span className="w-16 text-right font-mono text-[11px]" style={{ color: trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--warning)" }}>
          {formatNumber(Math.round(trend.forecast))}
        </span>
        <span className="w-24 text-[10px] text-[var(--text-muted)] shrink-0">прогноз</span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function ShipmentCalcV2({ initialMode = "v2" }: { initialMode?: "v1" | "v2" }) {
  const { stock, orders, products, settings, overrides } = useData();
  const effectiveRegions = useEffectiveRegions();
  const getBuyout = useEffectiveBuyout();
  const [selectedProduct, setSelectedProduct] = useState<string>("__all__");
  const mode = initialMode;
  const [hideInactive, setHideInactive] = useState(true);

  const sortedProducts = useMemo(() => {
    const stockTotals = new Map<string, number>();
    for (const s of stock) {
      stockTotals.set(s.articleWB, (stockTotals.get(s.articleWB) || 0) + s.totalOnWarehouses);
    }
    const orderTotals = new Map<string, number>();
    for (const o of orders) {
      if (!o.isCancel) {
        const key = String(o.articleWB);
        orderTotals.set(key, (orderTotals.get(key) || 0) + 1);
      }
    }
    let sorted = [...products].sort((a, b) => (stockTotals.get(b.articleWB) || 0) - (stockTotals.get(a.articleWB) || 0));
    if (hideInactive) {
      sorted = sorted.filter((p) => (stockTotals.get(p.articleWB) || 0) > 0 || (orderTotals.get(p.articleWB) || 0) > 0);
    }
    return sorted;
  }, [products, stock, orders, hideInactive]);

  const isAllMode = selectedProduct === "__all__";

  const product = useMemo(() => {
    if (isAllMode) return null;
    if (selectedProduct) return products.find((p) => p.articleWB === selectedProduct);
    return sortedProducts[0];
  }, [products, sortedProducts, selectedProduct, isAllMode]);

  const uploadDays = settings.uploadDays ?? 28;

  const allCalculations = useMemo(() => {
    if (!sortedProducts.length || !stock.length) return [];
    return sortedProducts.map((p) =>
      calculateShipmentV2(p, stock, orders, getBuyout(p.articleWB), effectiveRegions, overrides[p.articleWB], uploadDays)
    );
  }, [sortedProducts, stock, orders, effectiveRegions, overrides, getBuyout, uploadDays]);

  const singleCalc: ShipmentCalculationV2 | null = useMemo(() => {
    if (isAllMode || !product || stock.length === 0) return null;
    return calculateShipmentV2(product, stock, orders, getBuyout(product.articleWB), effectiveRegions, overrides[product.articleWB], uploadDays);
  }, [product, isAllMode, stock, orders, effectiveRegions, overrides, getBuyout, uploadDays]);

  // Merged rows and trend for "all" mode
  const { effectiveRows, effectiveRowsV1, effectiveTrend, effectiveRegionConfigs } = useMemo(() => {
    if (isAllMode && allCalculations.length > 0) {
      const merged = allCalculations.flatMap((c) => c.rows.map((r) => ({ ...r, articleName: c.product.name, articleWB: c.product.articleWB })));
      const mergedV1 = allCalculations.flatMap((c) => c.rowsV1.map((r) => ({ ...r, articleName: c.product.name, articleWB: c.product.articleWB })));
      const numWeeks = allCalculations[0]?.trend.weekly.length || 4;
      const mergedWeekly = Array.from({ length: numWeeks }, (_, i) => ({
        week: i + 1,
        label: `Нед. ${i + 1}`,
        orders: allCalculations.reduce((s, c) => s + (c.trend.weekly[i]?.orders || 0), 0),
        dateRange: allCalculations[0]?.trend.weekly[i]?.dateRange || "",
      }));
      return {
        effectiveRows: merged,
        effectiveRowsV1: mergedV1,
        effectiveTrend: calculateTrend(mergedWeekly),
        effectiveRegionConfigs: allCalculations[0]?.regionConfigs || effectiveRegions,
      };
    }
    if (singleCalc) {
      return {
        effectiveRows: singleCalc.rows,
        effectiveRowsV1: singleCalc.rowsV1,
        effectiveTrend: singleCalc.trend,
        effectiveRegionConfigs: singleCalc.regionConfigs,
      };
    }
    return { effectiveRows: [], effectiveRowsV1: [], effectiveTrend: null, effectiveRegionConfigs: effectiveRegions };
  }, [isAllMode, allCalculations, singleCalc, effectiveRegions]);

  const handleExport = useCallback(() => {
    if (allCalculations.length === 0) return;
    exportShipmentExcelV2(allCalculations, overrides);
  }, [allCalculations, overrides]);

  if (stock.length === 0 || sortedProducts.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
        <p className="text-4xl mb-4">📦</p>
        <p className="text-xl font-medium">Нет данных для расчёта</p>
        <p className="text-base text-[var(--text-muted)] mt-2">
          Загрузите Excel файл на странице &quot;Загрузка данных&quot;
        </p>
      </div>
    );
  }

  const rows = mode === "v2" ? effectiveRows : effectiveRowsV1;
  const trend = effectiveTrend;

  // V1 need: sum of deficit without trend
  const v1Need = effectiveRowsV1.reduce((s, r) => s + r.regions.reduce((rs, reg) => rs + Math.max(0, Math.ceil(reg.plan - reg.fact)), 0), 0);
  // V2 need: sum of deficit with trend
  const v2Need = effectiveRows.reduce((s, r) => s + r.regions.reduce((rs, reg) => rs + Math.max(0, Math.ceil(reg.plan - reg.fact)), 0), 0);

  return (
    <div className="space-y-4">
      {/* Product selector + mode toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={selectedProduct}
          onChange={(e) => setSelectedProduct(e.target.value)}
          className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] max-w-[400px] truncate"
        >
          <option value="__all__">Все артикулы ({sortedProducts.length})</option>
          {sortedProducts.map((p) => (
            <option key={p.articleWB} value={p.articleWB}>
              {p.name} (WB: {p.articleWB})
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>% выкупа<InfoTip term="buyoutRate" />:</span>
          {settings.buyoutMode === "auto" ? (
            <span className="text-[var(--accent)] font-medium">авто</span>
          ) : (
            <span className="text-white font-medium">{(settings.buyoutRate * 100).toFixed(0)}%</span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
          <input type="checkbox" checked={hideInactive} onChange={(e) => { setHideInactive(e.target.checked); setSelectedProduct("__all__"); }} className="accent-[var(--accent)] w-4 h-4" />
          Скрыть неактивные
        </label>

        <button
          onClick={handleExport}
          disabled={allCalculations.length === 0}
          className="ml-auto px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
        >
          Сформировать отгрузку
        </button>
      </div>

      {/* Trend panel (only in V2 mode) */}
      {mode === "v2" && trend && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Chart */}
            <div className="flex-1">
              <h3 className="text-sm font-bold text-white mb-2">📊 Динамика заказов по неделям</h3>
              <WeeklyChart trend={trend} />
            </div>
            {/* Summary */}
            <div className="lg:w-72 space-y-3">
              <h3 className="text-sm font-bold text-white">{trend.direction === "up" ? "📈" : trend.direction === "down" ? "📉" : "📊"} Тренд<InfoTip term="trend" /></h3>
              <TrendBadge trend={trend} v1Need={v1Need} v2Need={v2Need} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[var(--bg)] rounded-lg p-2 text-center">
                  <div className="text-[var(--text-muted)]">Множитель<InfoTip term="multiplier" /></div>
                  <div className="text-white font-bold text-sm">×{trend.multiplier.toFixed(2)}</div>
                </div>
                <div className="bg-[var(--bg)] rounded-lg p-2 text-center">
                  <div className="text-[var(--text-muted)]">Δ/неделю<InfoTip term="deltaWeek" /></div>
                  <div className="font-bold text-sm" style={{ color: trend.slope >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {trend.slope >= 0 ? "+" : ""}{formatNumber(Math.round(trend.slope))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-auto max-h-[65vh]">
        <table className="data-table">
          <thead>
            <tr>
              {isAllMode && <th rowSpan={2}>Артикул WB</th>}
              {isAllMode && <th rowSpan={2}>Баркод</th>}
              {isAllMode && <th rowSpan={2}>Артикул продавца</th>}
              <th rowSpan={2}>Размер</th>
              {mode === "v2" && <th rowSpan={2} className="num">Шт/кор</th>}
              <th rowSpan={2} className="num">На ВБ</th>
              {mode === "v2" && <th rowSpan={2} className="num">V1</th>}
              <th rowSpan={2} className="num">{mode === "v2" ? "V2 тренд" : "Заказы"}</th>
              <th rowSpan={2} className="num">Нужно</th>
              {effectiveRegionConfigs.map((r) => (
                <th key={r.id} colSpan={3} className="text-center border-l border-[var(--border)]">
                  {r.shortName}
                </th>
              ))}
            </tr>
            <tr>
              {effectiveRegionConfigs.map((r) => (
                <React.Fragment key={r.id}>
                  <th className="num border-l border-[var(--border)]">План</th>
                  <th className="num">Факт</th>
                  <th className="num">Нужно</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const v1Row = effectiveRowsV1[idx];
              const prevArticle = idx > 0 ? (rows[idx - 1] as any).articleWB : null;
              const currArticle = (row as any).articleWB;
              const isFirstOfArticle = !prevArticle || prevArticle !== currArticle;
              return (
                <tr key={row.barcode} className={isAllMode && isFirstOfArticle && idx > 0 ? "border-t-2 border-[var(--accent)]/30" : ""}>
                  {isAllMode && (
                    <td className="font-mono">{isFirstOfArticle ? currArticle || "—" : ""}</td>
                  )}
                  {isAllMode && <td className="font-mono">{row.barcode}</td>}
                  {isAllMode && (
                    <td>{isFirstOfArticle ? (row as any).articleName || "—" : ""}</td>
                  )}
                  <td className="font-medium">{row.size}</td>
                  {mode === "v2" && <td className="num">{row.perBox}</td>}
                  <td className="num">{formatNumber(row.totalOnWB)}</td>
                  {mode === "v2" && (
                    <td className="num text-[var(--text-muted)]">{formatNumber(v1Row?.totalOrders30d || 0, 1)}</td>
                  )}
                  <td className="num font-medium" style={mode === "v2" && trend ? { color: trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--text)" } : undefined}>
                    {formatNumber(row.totalOrders30d, 1)}
                  </td>
                  <td className="num font-medium">{formatNumber(row.regions.reduce((s, r) => s + Math.max(0, Math.ceil(r.plan - r.fact)), 0))}</td>
                  {row.regions.map((reg) => {
                    const diff = reg.fact - reg.plan;
                    const need = Math.max(0, Math.ceil(reg.plan - reg.fact));
                    return (
                      <React.Fragment key={reg.regionId}>
                        <td className="num border-l border-[var(--border)]">{formatNumber(reg.plan, 1)}</td>
                        <td className={`num font-medium ${diff >= 0 ? "cell-positive" : "cell-negative"}`}>
                          {formatNumber(reg.fact)}
                        </td>
                        <td className={`num ${need === 0 ? "cell-zero" : "cell-warning"}`}>
                          {need > 0 ? formatNumber(need) : "—"}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={isAllMode ? 4 : 1}>Итого</td>
              {mode === "v2" && <td></td>}
              <td className="num">{formatNumber(rows.reduce((s, r) => s + r.totalOnWB, 0))}</td>
              {mode === "v2" && (
                <td className="num text-[var(--text-muted)]">
                  {formatNumber(effectiveRowsV1.reduce((s, r) => s + r.totalOrders30d, 0), 1)}
                </td>
              )}
              <td className="num">{formatNumber(rows.reduce((s, r) => s + r.totalOrders30d, 0), 1)}</td>
              <td className="num font-bold">{formatNumber(rows.reduce((s, r) => s + r.regions.reduce((rs, reg) => rs + Math.max(0, Math.ceil(reg.plan - reg.fact)), 0), 0))}</td>

              {effectiveRegionConfigs.map((reg) => {
                const planSum = rows.reduce((s, r) => s + (r.regions.find((x) => x.regionId === reg.id)?.plan || 0), 0);
                const factSum = rows.reduce((s, r) => s + (r.regions.find((x) => x.regionId === reg.id)?.fact || 0), 0);
                const needSum = rows.reduce((s, r) => {
                  const regData = r.regions.find((x) => x.regionId === reg.id);
                  return s + Math.max(0, Math.ceil((regData?.plan || 0) - (regData?.fact || 0)));
                }, 0);
                return (
                  <React.Fragment key={reg.id}>
                    <td className="num border-l border-[var(--border)]">{formatNumber(planSum, 1)}</td>
                    <td className={`num ${factSum >= planSum ? "cell-positive" : "cell-negative"}`}>{formatNumber(factSum)}</td>
                    <td className="num">{formatNumber(needSum)}</td>
                  </React.Fragment>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Warehouse breakdown */}
      {singleCalc && <WarehouseBreakdown calculation={singleCalc} />}
    </div>
  );
}
