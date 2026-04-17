"use client";

import React, { useMemo, useState, useCallback } from "react";
import { useData } from "@/components/DataProvider";
import { calculateShipmentV2, calculateDeficit, type ShipmentCalculationV2 } from "@/modules/shipment/lib/engine";
import { formatNumber } from "@/lib/utils";
import { useEffectiveRegions } from "@/modules/shipment/lib/use-effective-regions";
import { calculateTrend } from "@/modules/shipment/lib/trend-engine";
import { useEffectiveBuyout } from "@/modules/shipment/lib/use-effective-buyout";
import { exportShipmentExcelSummary } from "@/lib/export-excel-summary";
import type { Product } from "@/types";
import { WarehouseBreakdown } from "./WarehouseBreakdown";
import type { TrendResult } from "@/modules/shipment/lib/trend-engine";
import { InfoTip } from "@/components/Tooltip";
import { packItems, unitVolumeLiters, type PackingItem, type BoxConfig } from "@/lib/packing-engine";
import { PackingSummaryTable, aggregatePackingByRegion, type SummaryArticle } from "./PackingSummaryTable";
import { ArticleMultiSelect } from "./ArticleMultiSelect";

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
  const { stock, orderAggregates, products, settings, overrides, updateSettings, isLoaded } = useData();
  const effectiveRegions = useEffectiveRegions();
  const getBuyout = useEffectiveBuyout();
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [articlesInitialized, setArticlesInitialized] = useState(false);
  const mode = initialMode;
  const [hideInactive, setHideInactive] = useState(true);

  // V2 Dynamics — two independent rounding settings + view mode
  const [v2BoxRounding, setV2BoxRounding] = useState<number>(settings.v2RoundTo ?? 1);
  const [v2UnitRounding, setV2UnitRounding] = useState<number>(settings.v2UnitRounding ?? 1);
  const [v2ViewMode, setV2ViewMode] = useState<"units" | "boxes">((settings.v2ViewMode as "units" | "boxes") ?? "units");

  React.useEffect(() => {
    if (settings.v2RoundTo !== undefined) setV2BoxRounding(settings.v2RoundTo);
    if (settings.v2UnitRounding !== undefined) setV2UnitRounding(settings.v2UnitRounding);
    if (settings.v2ViewMode !== undefined) setV2ViewMode(settings.v2ViewMode as "units" | "boxes");
  }, [settings.v2RoundTo, settings.v2UnitRounding, settings.v2ViewMode]);

  const { sortedProducts, orderTotals } = useMemo(() => {
    const stockTotals = new Map<string, number>();
    for (const s of stock) {
      stockTotals.set(s.articleWB, (stockTotals.get(s.articleWB) || 0) + s.totalOnWarehouses);
    }
    const orderTotalsMap = new Map<string, number>();
    if (orderAggregates) {
      for (const b of Object.values(orderAggregates.perBarcode)) {
        const key = String(b.articleWB);
        const nonCancelled = b.totalOrders - b.cancelledOrders;
        orderTotalsMap.set(key, (orderTotalsMap.get(key) || 0) + nonCancelled);
      }
    }
    let sorted = [...products].sort((a, b) => (stockTotals.get(b.articleWB) || 0) - (stockTotals.get(a.articleWB) || 0));
    if (hideInactive) {
      sorted = sorted.filter((p) => (stockTotals.get(p.articleWB) || 0) > 0 || (orderTotalsMap.get(p.articleWB) || 0) > 0);
    }
    return { sortedProducts: sorted, orderTotals: orderTotalsMap };
  }, [products, stock, orderAggregates, hideInactive]);

  // Auto-select all products on first load
  React.useEffect(() => {
    if (!articlesInitialized && sortedProducts.length > 0) {
      setSelectedArticles(new Set(sortedProducts.map(p => p.articleWB)));
      setArticlesInitialized(true);
    }
  }, [sortedProducts, articlesInitialized]);

  const activeProducts = useMemo(() => {
    if (selectedArticles.size === 0) return [];
    return sortedProducts.filter(p => selectedArticles.has(p.articleWB));
  }, [sortedProducts, selectedArticles]);

  const isAllMode = selectedArticles.size !== 1;

  const product = useMemo(() => {
    if (isAllMode) return null;
    return activeProducts[0];
  }, [activeProducts, isAllMode]);

  const uploadDays = settings.uploadDays ?? 28;

  const allCalculations = useMemo(() => {
    if (!activeProducts.length || !stock.length) return [];
    return activeProducts.map((p) =>
      calculateShipmentV2(p, stock, orderAggregates, getBuyout(p.articleWB), effectiveRegions, overrides[p.articleWB], uploadDays)
    );
  }, [activeProducts, stock, orderAggregates, effectiveRegions, overrides, getBuyout, uploadDays]);

  const singleCalc: ShipmentCalculationV2 | null = useMemo(() => {
    if (isAllMode || !product || stock.length === 0) return null;
    return calculateShipmentV2(product, stock, orderAggregates, getBuyout(product.articleWB), effectiveRegions, overrides[product.articleWB], uploadDays);
  }, [product, isAllMode, stock, orderAggregates, effectiveRegions, overrides, getBuyout, uploadDays]);

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
    if (singleCalc && product) {
      return {
        effectiveRows: singleCalc.rows.map(r => ({ ...r, articleWB: product.articleWB, articleName: product.name })),
        effectiveRowsV1: singleCalc.rowsV1.map(r => ({ ...r, articleWB: product.articleWB, articleName: product.name })),
        effectiveTrend: singleCalc.trend,
        effectiveRegionConfigs: singleCalc.regionConfigs,
      };
    }
    return { effectiveRows: [], effectiveRowsV1: [], effectiveTrend: null, effectiveRegionConfigs: effectiveRegions };
  }, [isAllMode, allCalculations, singleCalc, effectiveRegions]);

  if (!isLoaded) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <svg className="animate-spin h-8 w-8 text-[var(--accent)]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-xl font-medium">Загрузка данных...</p>
        <p className="text-base text-[var(--text-muted)] mt-2">Подождите, идёт загрузка остатков и заказов</p>
      </div>
    );
  }

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

  // V2 packing (for "boxes" view)
  const v2BoxConfig: BoxConfig = useMemo(() => ({
    lengthMm: (settings.boxLengthCm || 60) * 10,
    widthMm: (settings.boxWidthCm || 40) * 10,
    heightMm: (settings.boxHeightCm || 40) * 10,
    fillRate: 1.0,
  }), [settings.boxLengthCm, settings.boxWidthCm, settings.boxHeightCm]);

  // Articles aggregated for BOXES mode (via packing-engine)
  const v2ArticlesBoxes = useMemo<SummaryArticle[]>(() => {
    if (mode !== "v2" || effectiveRows.length === 0 || !effectiveRegionConfigs.length) return [];
    const packingByRegion = effectiveRegionConfigs.map((region) => {
      const items: PackingItem[] = [];
      for (const row of effectiveRows) {
        const regionData = row.regions.find((r) => r.regionId === region.id);
        const fullDeficit = Math.ceil(regionData ? Math.max(0, regionData.plan - regionData.fact) : 0);
        if (fullDeficit <= 0) continue;
        const step = row.perBox * v2BoxRounding;
        const needed = step > 0 ? Math.ceil(fullDeficit / step) * step : fullDeficit;
        items.push({
          id: `${row.barcode}-${region.id}`,
          label: row.articleWB ? `${row.articleWB} / ${row.size}` : row.size,
          articleWB: row.articleWB || "",
          articleName: row.articleName || "",
          productName: overrides[row.articleWB || ""]?.customName || row.articleName || "",
          size: row.size,
          barcode: row.barcode,
          needed,
          perBox: row.perBox,
          unitVolume: unitVolumeLiters(v2BoxConfig, row.perBox),
        });
      }
      return {
        region: { id: region.id, shortName: region.shortName },
        packing: packItems(items, v2BoxConfig, 999, 1, 1),
      };
    }).filter((p) => p.packing.totalBoxes > 0);
    return aggregatePackingByRegion(packingByRegion);
  }, [mode, effectiveRows, effectiveRegionConfigs, v2BoxRounding, v2BoxConfig, overrides]);

  // Articles aggregated for UNITS mode (direct from effectiveRows, no packing)
  const v2ArticlesUnits = useMemo<SummaryArticle[]>(() => {
    if (mode !== "v2" || effectiveRows.length === 0 || !effectiveRegionConfigs.length) return [];
    const map = new Map<string, SummaryArticle>();
    for (const row of effectiveRows) {
      const aid = row.articleWB || "";
      if (!map.has(aid)) {
        map.set(aid, {
          articleWB: aid,
          productName: overrides[aid]?.customName || row.articleName || "—",
          sizes: [],
          totalUnits: 0,
        });
      }
      const art = map.get(aid)!;
      let sr = art.sizes.find(s => s.item.barcode === row.barcode);
      if (!sr) {
        sr = {
          item: {
            id: row.barcode,
            label: aid ? `${aid} / ${row.size}` : row.size,
            articleWB: aid,
            articleName: row.articleName || "",
            productName: overrides[aid]?.customName || row.articleName || "",
            size: row.size,
            barcode: row.barcode,
            needed: 0,
            perBox: row.perBox,
            unitVolume: 0,
          },
          qtyByRegion: {},
        };
        art.sizes.push(sr);
      }
      for (const reg of row.regions) {
        const deficit = Math.max(0, Math.ceil(reg.plan - reg.fact));
        if (deficit <= 0) continue;
        const rounded = v2UnitRounding > 0 ? Math.ceil(deficit / v2UnitRounding) * v2UnitRounding : deficit;
        sr.qtyByRegion[reg.regionId] = (sr.qtyByRegion[reg.regionId] || 0) + rounded;
        art.totalUnits += rounded;
      }
    }
    // Drop empty articles
    for (const [k, art] of map) {
      if (art.totalUnits === 0) map.delete(k);
    }
    // Sort sizes within article, articles by volume
    const LETTER_ORDER: Record<string, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7 };
    const sizeSortKey = (s: string): number => {
      const num = s.match(/\d+/);
      if (num) return parseInt(num[0], 10);
      return LETTER_ORDER[s.trim().toUpperCase()] ?? 999;
    };
    for (const art of map.values()) {
      art.sizes.sort((a, b) => sizeSortKey(a.item.size) - sizeSortKey(b.item.size));
    }
    return Array.from(map.values()).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [mode, effectiveRows, effectiveRegionConfigs, v2UnitRounding, overrides]);

  const v2Articles = v2ViewMode === "boxes" ? v2ArticlesBoxes : v2ArticlesUnits;
  const v2SummaryRegions = effectiveRegionConfigs.map(r => ({ id: r.id, shortName: r.shortName }));

  const v2RowMeta = useMemo(() => {
    const map: Record<string, { plan: number; fact: number; need: number }> = {};
    for (const row of effectiveRows) {
      const plan = row.regions.reduce((s, r) => s + r.plan, 0);
      const fact = row.regions.reduce((s, r) => s + r.fact, 0);
      const need = row.regions.reduce((s, r) => s + Math.max(0, Math.ceil(r.plan - r.fact)), 0);
      map[row.barcode] = { plan, fact, need };
    }
    return map;
  }, [effectiveRows]);

  const handleExport = useCallback(() => {
    if (allCalculations.length === 0) return;
    exportShipmentExcelSummary({
      articles: v2Articles,
      regions: v2SummaryRegions,
      viewMode: v2ViewMode,
      rowMeta: v2RowMeta,
    });
  }, [allCalculations, v2Articles, v2SummaryRegions, v2ViewMode, v2RowMeta]);

  return (
    <div className="space-y-4">
      {/* Product selector + mode toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <ArticleMultiSelect
          products={sortedProducts}
          selected={selectedArticles}
          onChange={setSelectedArticles}
          orderCounts={orderTotals}
        />

        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>% выкупа<InfoTip term="buyoutRate" />:</span>
          {settings.buyoutMode === "auto" ? (
            <span className="text-[var(--accent)] font-medium">авто</span>
          ) : (
            <span className="text-white font-medium">{(settings.buyoutRate * 100).toFixed(0)}%</span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
          <input type="checkbox" checked={hideInactive} onChange={(e) => { setHideInactive(e.target.checked); setArticlesInitialized(false); }} className="accent-[var(--accent)] w-4 h-4" />
          Скрыть неактивные
        </label>

        <div className="ml-auto">
          <button
            onClick={handleExport}
            disabled={allCalculations.length === 0}
            className="px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
          >
            Сформировать отгрузку
          </button>
        </div>
      </div>

      {/* Trend panel + Settings (only in V2 mode) */}
      {mode === "v2" && trend && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left: Chart + Trend summary */}
            <div className="flex-1 flex flex-col lg:flex-row gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white mb-2">📊 Динамика заказов по неделям</h3>
                <WeeklyChart trend={trend} />
              </div>
              <div className="lg:w-56 space-y-2">
                <h3 className="text-sm font-bold text-white">{trend.direction === "up" ? "📈" : trend.direction === "down" ? "📉" : "📊"} Тренд<InfoTip term="trend" /></h3>
                <TrendBadge trend={trend} v1Need={v1Need} v2Need={v2Need} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[var(--bg)] rounded-lg p-1.5 text-center">
                    <div className="text-[var(--text-muted)] text-[10px]">Множитель<InfoTip term="multiplier" /></div>
                    <div className="text-white font-bold text-sm">×{trend.multiplier.toFixed(2)}</div>
                  </div>
                  <div className="bg-[var(--bg)] rounded-lg p-1.5 text-center">
                    <div className="text-[var(--text-muted)] text-[10px]">Δ/неделю<InfoTip term="deltaWeek" /></div>
                    <div className="font-bold text-sm" style={{ color: trend.slope >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {trend.slope >= 0 ? "+" : ""}{formatNumber(Math.round(trend.slope))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right 1/4: V2 Settings */}
            <div className="lg:w-52 lg:border-l lg:border-[var(--border)] lg:pl-4 space-y-3">
              <h3 className="text-sm font-bold text-white">⚙️ Настройки</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Округл. до короба</span>
                  <select value={v2BoxRounding} onChange={(e) => { const v = Number(e.target.value); setV2BoxRounding(v); updateSettings({ v2RoundTo: v }); }} className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]">
                    <option value={0.5}>0.5</option>
                    <option value={1}>1</option>
                  </select>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Округл. штук до</span>
                  <input
                    type="number"
                    list="v2-unit-rounding-list"
                    min={1}
                    value={v2UnitRounding}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || 1);
                      setV2UnitRounding(v);
                      updateSettings({ v2UnitRounding: v });
                    }}
                    className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]"
                  />
                  <datalist id="v2-unit-rounding-list">
                    <option value="1" />
                    <option value="5" />
                    <option value="10" />
                  </datalist>
                </div>
                <div className="pt-1 border-t border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-muted)] mb-1">Вид</div>
                  <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
                    {(["units", "boxes"] as const).map((key) => (
                      <button key={key} onClick={() => { setV2ViewMode(key); updateSettings({ v2ViewMode: key }); }}
                        className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors border-l first:border-l-0 border-[var(--border)] ${v2ViewMode === key ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-white"}`}
                      >{key === "units" ? "Штуки" : "Кораба"}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary view (boxes or units) */}
      {mode === "v2" && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">
              {v2ViewMode === "boxes" ? "📦 Кораба" : "🔢 Штуки"} — сводная по артикулам
            </h3>
          </div>
          <PackingSummaryTable articles={v2Articles} regions={v2SummaryRegions} viewMode={v2ViewMode} rowMeta={v2RowMeta} />
        </div>
      )}

      {/* V1 Table */}
      {(mode as string) !== "v2" && (
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
      )}

      {/* Warehouse breakdown */}
      {singleCalc && <WarehouseBreakdown calculation={singleCalc} />}
    </div>
  );
}
