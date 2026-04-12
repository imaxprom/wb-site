"use client";

import React, { useMemo, useState, useCallback } from "react";
import { useData } from "./DataProvider";
import { calculateShipmentV2, type ShipmentCalculationV2 } from "@/modules/shipment/lib/engine";
import { exportShipmentExcelV2 } from "@/lib/export-excel-v2";
import { packItems, unitVolumeLiters, usableVolumeLiters, boxVolumeLiters, type PackingItem, type PackingResult, type BoxConfig } from "@/lib/packing-engine";
import { formatNumber } from "@/lib/utils";
import { useEffectiveRegions } from "@/modules/shipment/lib/use-effective-regions";
import { useEffectiveBuyout } from "@/modules/shipment/lib/use-effective-buyout";
import { InfoTip } from "@/components/Tooltip";
import { calculateTrend, type TrendResult } from "@/lib/trend-engine";
import type { ShipmentRowExtended } from "@/types";

// ─── Packing Visualization ──────────────────────────────────

// ─── Вариант А: Карточки (сетка) ────────────────────────────

function PackingCards({ result }: { result: PackingResult }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {result.boxes.map((box) => (
        <div key={box.boxNumber} className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-white">Короб {box.boxNumber}</span>
            <span className="text-[10px] font-mono" style={{
              color: box.fillPercent > 85 ? "var(--success)" : box.fillPercent > 50 ? "var(--accent)" : "var(--warning)"
            }}>
              {box.fillPercent.toFixed(0)}%
            </span>
          </div>
          <div className="space-y-1 mb-2">
            {box.items.map((entry, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">{entry.item.label}</span>
                <span className="text-white font-medium">×{entry.qty}</span>
              </div>
            ))}
          </div>
          <div className="w-full h-1.5 bg-[var(--border)]/30 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{
              width: `${box.fillPercent}%`,
              background: box.fillPercent > 85 ? "var(--success)" : box.fillPercent > 50 ? "var(--accent)" : "var(--warning)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Вариант Б: Таблица ─────────────────────────────────────

function PackingTable({ result }: { result: PackingResult }) {
  // Collect all unique sizes across all boxes
  const allSizes = Array.from(
    new Set(result.boxes.flatMap((b) => b.items.map((i) => i.item.label)))
  );

  return (
    <div className="overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            {allSizes.map((size) => (
              <th key={size} className="num">{size}</th>
            ))}
            <th className="num">Всего шт</th>
            <th className="num">Заполн.</th>
          </tr>
        </thead>
        <tbody>
          {result.boxes.map((box) => {
            const totalQty = box.items.reduce((s, i) => s + i.qty, 0);
            return (
              <tr key={box.boxNumber}>
                <td className="font-medium text-white">Короб {box.boxNumber}</td>
                {allSizes.map((size) => {
                  const entry = box.items.find((i) => i.item.label === size);
                  return (
                    <td key={size} className="num">
                      {entry ? (
                        <span className="text-white font-medium">{entry.qty}</span>
                      ) : (
                        <span className="text-[var(--border)]">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="num font-bold">{totalQty}</td>
                <td className="num">
                  <span style={{
                    color: box.fillPercent > 85 ? "var(--success)" : box.fillPercent > 50 ? "var(--accent)" : "var(--warning)"
                  }}>
                    {box.fillPercent.toFixed(0)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td>Итого</td>
            {allSizes.map((size) => {
              const total = result.boxes.reduce((s, b) => s + (b.items.find((i) => i.item.label === size)?.qty || 0), 0);
              return <td key={size} className="num">{total > 0 ? total : "—"}</td>;
            })}
            <td className="num">{result.totalItems}</td>
            <td className="num">{result.totalBoxes} кор.</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Вариант В: Вертикальные столбцы ────────────────────────

function PackingColumns({ result }: { result: PackingResult }) {
  const maxVol = result.usableVolume;
  const colors = ["var(--accent)", "var(--success)", "var(--warning)", "#e879f9", "#fb923c", "#38bdf8", "#a3e635"];

  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 200 }}>
      {result.boxes.map((box) => (
        <div key={box.boxNumber} className="flex flex-col items-center shrink-0" style={{ width: 80 }}>
          {/* Percentage */}
          <span className="text-[10px] font-mono mb-1" style={{
            color: box.fillPercent > 85 ? "var(--success)" : box.fillPercent > 50 ? "var(--accent)" : "var(--warning)"
          }}>
            {box.fillPercent.toFixed(0)}%
          </span>

          {/* Column */}
          <div className="w-16 bg-[var(--border)]/20 border border-[var(--border)] rounded-lg overflow-hidden relative" style={{ height: 150 }}>
            <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse">
              {box.items.map((entry, idx) => {
                const pct = (entry.volumeUsed / maxVol) * 100;
                return (
                  <div
                    key={idx}
                    style={{
                      height: `${pct * 1.5}px`,
                      background: colors[idx % colors.length],
                      opacity: 0.8,
                      minHeight: 4,
                    }}
                    title={`${entry.item.label}: ${entry.qty} шт`}
                  />
                );
              })}
            </div>
          </div>

          {/* Label */}
          <span className="text-[9px] text-[var(--text-muted)] mt-1 text-center leading-tight">
            Короб {box.boxNumber}
          </span>
          <span className="text-[9px] text-white font-medium">
            {box.items.reduce((s, i) => s + i.qty, 0)} шт
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Unified PackingView with variant switcher ──────────────

type PackingVariant = "cards" | "table" | "columns";

function PackingView({ result, regionName, variant }: { result: PackingResult; regionName: string; variant: PackingVariant }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">
          📦 Укладка — {regionName} ({result.boxConfig.lengthMm / 10}×{result.boxConfig.widthMm / 10}×{result.boxConfig.heightMm / 10} см)
        </h3>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>{result.totalBoxes} {result.totalBoxes === 1 ? "короб" : result.totalBoxes < 5 ? "короба" : "коробов"}</span>
          <span>{result.totalItems} шт</span>
        </div>
      </div>

      {variant === "cards" && <PackingCards result={result} />}
      {variant === "table" && <PackingTable result={result} />}
      {variant === "columns" && <PackingColumns result={result} />}
    </div>
  );
}

// ─── Weekly Chart (same as V2) ──────────────────────────────

function WeeklyChart({ trend }: { trend: TrendResult }) {
  const max = Math.max(...trend.weekly.map((w) => w.orders), trend.forecast, 1);
  return (
    <div className="space-y-1.5">
      {trend.weekly.map((w) => (
        <div key={w.week} className="flex items-center gap-2 text-xs">
          <span className="w-14 text-[var(--text-muted)] text-right shrink-0">{w.label}</span>
          <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden relative">
            <div className="h-full rounded transition-all" style={{ width: `${(w.orders / max) * 100}%`, background: "var(--accent)", minWidth: w.orders > 0 ? "4px" : "0" }} />
          </div>
          <span className="w-16 text-right text-white font-mono text-[11px]">{formatNumber(w.orders)}</span>
          <span className="w-24 text-[10px] text-[var(--text-muted)] shrink-0">{w.dateRange}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-14 text-[var(--warning)] text-right shrink-0 font-medium">Прогн.</span>
        <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden relative">
          <div className="h-full rounded" style={{ width: `${(trend.forecast / max) * 100}%`, background: trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--warning)", opacity: 0.6, minWidth: trend.forecast > 0 ? "4px" : "0" }} />
        </div>
        <span className="w-16 text-right font-mono text-[11px]" style={{ color: trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--warning)" }}>{formatNumber(Math.round(trend.forecast))}</span>
        <span className="w-24 text-[10px] text-[var(--text-muted)] shrink-0">прогноз</span>
      </div>
    </div>
  );
}

// ─── Trend Badge (reused from V2) ───────────────────────────

function TrendBadge({ trend, v2Need, v3Total }: { trend: TrendResult; v2Need?: number; v3Total?: number }) {
  const icon = trend.direction === "up" ? "↗️" : trend.direction === "down" ? "↘️" : "→";
  const color = trend.direction === "up" ? "var(--success)" : trend.direction === "down" ? "var(--danger)" : "var(--text-muted)";
  const label = trend.direction === "up" ? "Растущий" : trend.direction === "down" ? "Падающий" : "Стабильный";
  const diffPercent = ((trend.multiplier - 1) * 100).toFixed(0);
  const diffSign = trend.multiplier >= 1 ? "+" : "";

  const v2Val = v2Need ?? 0;
  const v3Diff = v3Total !== undefined && v2Val > 0 ? ((v3Total - v2Val) / v2Val * 100).toFixed(0) : null;

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
        <span>V2: {formatNumber(v2Val)} шт</span>
        <span>→</span>
        <span className="text-[var(--success)]">V3: {formatNumber(v3Total ?? 0)} шт {v3Diff ? `(${Number(v3Diff) > 0 ? "+" : ""}${v3Diff}%)` : ""}</span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function ShipmentCalcV3() {
  const { stock, orders, products, settings, overrides, updateSettings } = useData();
  const effectiveRegions = useEffectiveRegions();
  const getBuyout = useEffectiveBuyout();
  const [selectedProduct, setSelectedProduct] = useState<string>("__all__");
  const [packingVariant, setPackingVariant] = useState<PackingVariant>((settings.packingVariant as PackingVariant) ?? "cards");
  const [hideInactive, setHideInactive] = useState(true);
  const [postponedOpen, setPostponedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [maxArticlesPerBox, setMaxArticlesPerBox] = useState(settings.maxArticlesPerBox ?? 4);
  const [shipmentsPerMonth, setShipmentsPerMonth] = useState(settings.shipmentsPerMonth ?? 4);
  const [minUnits, setMinUnits] = useState(settings.minUnits ?? 10);
  const [roundTo, setRoundTo] = useState(settings.roundTo ?? 5);

  const boxConfig: BoxConfig = useMemo(() => ({
    lengthMm: (settings.boxLengthCm || 60) * 10,
    widthMm: (settings.boxWidthCm || 40) * 10,
    heightMm: (settings.boxHeightCm || 40) * 10,
    fillRate: 1.0,
  }), [settings.boxLengthCm, settings.boxWidthCm, settings.boxHeightCm]);

  const { sortedProducts, stockTotals, orderTotals } = useMemo(() => {
    const st = new Map<string, number>();
    for (const s of stock) {
      st.set(s.articleWB, (st.get(s.articleWB) || 0) + s.totalOnWarehouses);
    }
    const ot = new Map<string, number>();
    for (const o of orders) {
      if (!o.isCancel) {
        const key = String(o.articleWB);
        ot.set(key, (ot.get(key) || 0) + 1);
      }
    }
    const sorted = [...products].sort((a, b) => (st.get(b.articleWB) || 0) - (st.get(a.articleWB) || 0));
    return { sortedProducts: sorted, stockTotals: st, orderTotals: ot };
  }, [products, stock, orders]);

  const filteredProducts = useMemo(() => {
    if (!hideInactive) return sortedProducts;
    return sortedProducts.filter((p) => (stockTotals.get(p.articleWB) || 0) > 0 || (orderTotals.get(p.articleWB) || 0) > 0);
  }, [sortedProducts, hideInactive, stockTotals, orderTotals]);

  const isAllMode = selectedProduct === "__all__";

  const uploadDays = settings.uploadDays ?? 28;

  // Calculate V2 for all products
  const allCalcs = useMemo(() => {
    if (stock.length === 0 || filteredProducts.length === 0) return [];
    return filteredProducts.map((p) =>
      calculateShipmentV2(p, stock, orders, getBuyout(p.articleWB), effectiveRegions, overrides[p.articleWB], uploadDays)
    );
  }, [sortedProducts, stock, orders, effectiveRegions, overrides, getBuyout, uploadDays]);

  // Single product calc (when specific article selected)
  const singleCalc: ShipmentCalculationV2 | null = useMemo(() => {
    if (isAllMode) return null;
    const prod = products.find((p) => p.articleWB === selectedProduct);
    if (!prod || stock.length === 0) return null;
    return calculateShipmentV2(prod, stock, orders, getBuyout(prod.articleWB), effectiveRegions, overrides[prod.articleWB], uploadDays);
  }, [selectedProduct, isAllMode, products, stock, orders, effectiveRegions, overrides, getBuyout, uploadDays]);

  // Effective rows and trend
  const { rows, trend, regionConfigs } = useMemo<{ rows: ShipmentRowExtended[]; trend: TrendResult | null; regionConfigs: typeof effectiveRegions }>(() => {
    if (isAllMode && allCalcs.length > 0) {
      // Merge all rows
      const merged = allCalcs.flatMap((c) =>
        c.rows.map((r) => ({ ...r, articleName: c.product.name, articleWB: c.product.articleWB }))
      );
      // Merge trend: sum weekly
      const numWeeks = allCalcs[0]?.trend.weekly.length || 4;
      const mergedWeekly = Array.from({ length: numWeeks }, (_, i) => ({
        week: i + 1,
        label: `Нед. ${i + 1}`,
        orders: allCalcs.reduce((s, c) => s + (c.trend.weekly[i]?.orders || 0), 0),
        dateRange: allCalcs[0]?.trend.weekly[i]?.dateRange || "",
      }));
      const mergedTrend = calculateTrend(mergedWeekly);
      return { rows: merged, trend: mergedTrend, regionConfigs: allCalcs[0]?.regionConfigs || effectiveRegions };
    }
    if (singleCalc) {
      const prod = products.find((p) => p.articleWB === selectedProduct);
      const extRows: ShipmentRowExtended[] = singleCalc.rows.map((r) => ({ ...r, articleWB: prod?.articleWB || "", articleName: prod?.name || "" }));
      return { rows: extRows, trend: singleCalc.trend, regionConfigs: singleCalc.regionConfigs };
    }
    return { rows: [] as ShipmentRowExtended[], trend: null, regionConfigs: effectiveRegions };
  }, [isAllMode, allCalcs, singleCalc, effectiveRegions, products, selectedProduct]);

  // Threshold only uses minUnits — frequency is informational only

  // Pack items for each region (all products or single)
  const packingByRegion = useMemo(() => {
    if (rows.length === 0 || !regionConfigs.length) return [];
    const box = boxConfig;

    return regionConfigs.map((region) => {
      const allItems: { item: PackingItem; salesPerDay: number; deficitDays: number; fullDeficit: number }[] = [];

      for (const row of rows) {
        const regionData = row.regions.find((r) => r.regionId === region.id);
        // Plan is for 30 days. Scale to period: if 4 shipments/month, need only 7 days
        const salesPerDay = row.totalOrders30d > 0 ? row.totalOrders30d / 30 : 0;
        // Full 30-day deficit (same as V2), rounded to whole units
        const fullDeficit = Math.ceil(regionData ? Math.max(0, regionData.plan - regionData.fact) : 0);
        if (fullDeficit <= 0) continue;

        const deficitDays = salesPerDay > 0 ? fullDeficit / salesPerDay : 999;

        allItems.push({
          item: {
            id: `${row.barcode}-${region.id}`,
            label: row.articleWB ? `${row.articleWB} / ${row.size}` : row.size,
            articleWB: row.articleWB || "",
            articleName: row.articleName || "",
            productName: overrides[row.articleWB]?.customName || row.articleName || "",
            size: row.size,
            barcode: row.barcode,
            needed: roundTo > 1 ? Math.round(fullDeficit / roundTo) * roundTo : fullDeficit,
            perBox: row.perBox,
            unitVolume: unitVolumeLiters(box, row.perBox),
          },
          salesPerDay,
          deficitDays,
          fullDeficit,
        });
      }

      // Filter: all items must meet minUnits threshold
      const toShip = allItems.filter((i) => i.fullDeficit >= minUnits);
      const postponed = allItems.filter((i) => !toShip.includes(i));

      return {
        region,
        packing: packItems(toShip.map((i) => i.item), box, maxArticlesPerBox, minUnits, roundTo),
        postponed: postponed.map((i) => ({
          ...i.item,
          deficitDays: i.deficitDays,
          salesPerDay: i.salesPerDay,
        })),
      };
    });
  }, [rows, regionConfigs, maxArticlesPerBox, minUnits, roundTo]);

  // Export handler
  const handleExport = useCallback(() => {
    if (allCalcs.length === 0) return;
    exportShipmentExcelV2(allCalcs, overrides);
  }, [allCalcs, overrides]);

  // Per-position surplus/deficit (must be before early return — React hooks rule)
  const { totalSurplus, totalDeficit: totalDeficitQty } = useMemo(() => {
    let surplus = 0;
    let deficit = 0;
    for (const row of rows) {
      for (const reg of row.regions) {
        const diff = reg.fact - reg.plan;
        if (diff > 0) surplus += diff;
        else deficit += Math.abs(diff);
      }
    }
    return { totalSurplus: Math.round(surplus), totalDeficit: Math.round(deficit) };
  }, [rows]);

  if (stock.length === 0 || filteredProducts.length === 0) {
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

  const totalNewBoxes = packingByRegion.reduce((s, p) => s + p.packing.totalBoxes, 0);

  // Stock summary
  const totalOnWB = rows.reduce((s, r) => s + r.totalOnWB, 0);
  const totalNeed30d = rows.reduce((s, r) => s + r.totalOrders30d, 0);
  const totalShipping = packingByRegion.reduce((s, p) => s + p.packing.totalItems, 0);
  // V2 need = total deficit (plan - fact) before minUnits/rounding
  const v2Need = rows.reduce((s, r) => s + r.regions.reduce((rs, reg) => rs + Math.max(0, Math.ceil(reg.plan - reg.fact)), 0), 0);
  const totalAfter = totalOnWB + totalShipping;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={selectedProduct}
          onChange={(e) => setSelectedProduct(e.target.value)}
          className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] max-w-[400px] truncate"
        >
          <option value="__all__">Все артикулы ({filteredProducts.length})</option>
          {filteredProducts.map((p) => (
            <option key={p.articleWB} value={p.articleWB}>
              {p.name} (WB: {p.articleWB})
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideInactive}
            onChange={(e) => { setHideInactive(e.target.checked); setSelectedProduct("__all__"); }}
            className="accent-[var(--accent)] w-4 h-4"
          />
          Скрыть неактивные
        </label>

        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>% выкупа<InfoTip term="buyoutRate" />:</span>
          {settings.buyoutMode === "auto" ? (
            <span className="text-[var(--accent)] font-medium">авто</span>
          ) : (
            <span className="text-white font-medium">{(settings.buyoutRate * 100).toFixed(0)}%</span>
          )}
        </div>

        <button
          onClick={handleExport}
          disabled={allCalcs.length === 0}
          className="ml-auto px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
        >
          Сформировать отгрузку
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex flex-col items-center">
          <div className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5">Остаток на складе WB<InfoTip term="onWB" /></div>
          <div className="text-white font-bold text-lg mt-1">{formatNumber(totalOnWB)}</div>
          <div className="text-[10px] text-[var(--text-muted)]">сейчас</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex flex-col items-center">
          <div className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5">Переизбыток / Дефицит<InfoTip term="demand" /></div>
          <div className="flex justify-center gap-3 mt-1">
            <span className="text-[var(--success)] font-bold text-lg">🟢 +{formatNumber(totalSurplus)}</span>
            <span className="text-[var(--danger)] font-bold text-lg">🔴 −{formatNumber(totalDeficitQty)}</span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">на {settings.uploadDays ?? 28} дней продаж</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex flex-col items-center">
          <div className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5">К отгрузке<InfoTip term="smartBoxes" /></div>
          <div className="text-[var(--success)] font-bold text-lg mt-1">{formatNumber(totalShipping)} шт</div>
          <div className="text-xs text-[var(--text-muted)]">в {totalNewBoxes} коробах (Smart)</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 flex flex-col items-center">
          <div className="text-xs text-[var(--text-muted)] flex items-center justify-center gap-0.5">Баланс склада<InfoTip term="balance" /></div>
          <div className="text-white font-bold text-lg mt-1">{formatNumber(totalAfter)}</div>
          <div className="text-[10px] text-[var(--text-muted)]">после отгрузки (+{formatNumber(totalShipping)})</div>
        </div>
      </div>

      {/* Trend panel + Settings — 3/4 + 1/4 */}
      {trend && <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left 3/4: Chart + Trend */}
          <div className="flex-1 flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-bold text-white mb-2">📊 Динамика заказов по неделям</h3>
              <WeeklyChart trend={trend} />
            </div>
            <div className="lg:w-56 space-y-2">
              <h3 className="text-sm font-bold text-white">Тренд<InfoTip term="trend" /></h3>
              <TrendBadge trend={trend} v2Need={v2Need} v3Total={totalShipping} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[var(--bg)] rounded-lg p-1.5 text-center">
                  <div className="text-[var(--text-muted)] text-[10px]">Множитель</div>
                  <div className="text-white font-bold text-sm">×{trend.multiplier.toFixed(2)}</div>
                </div>
                <div className="bg-[var(--bg)] rounded-lg p-1.5 text-center">
                  <div className="text-[var(--text-muted)] text-[10px]">Δ/неделю</div>
                  <div className="font-bold text-sm" style={{ color: trend.slope >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {trend.slope >= 0 ? "+" : ""}{formatNumber(Math.round(trend.slope))}
                  </div>
                </div>
              </div>
              <div className="text-[10px] px-2 py-0.5 rounded-full inline-block" style={{
                color: trend.confidence === "high" ? "var(--success)" : trend.confidence === "medium" ? "var(--warning)" : "var(--text-muted)",
                background: trend.confidence === "high" ? "color-mix(in srgb, var(--success) 10%, transparent)" : trend.confidence === "medium" ? "color-mix(in srgb, var(--warning) 10%, transparent)" : "color-mix(in srgb, var(--text-muted) 10%, transparent)",
              }}>
                R² = {trend.r2.toFixed(2)} ({trend.confidence === "high" ? "высокая" : trend.confidence === "medium" ? "средняя" : "низкая"})<InfoTip term="r2" />
              </div>
            </div>
          </div>

          {/* Right 1/4: Settings */}
          <div className="lg:w-52 lg:border-l lg:border-[var(--border)] lg:pl-4 space-y-3">
            <h3 className="text-sm font-bold text-white">⚙️ Настройки</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Позиций/кор.</span>
                <input type="number" value={maxArticlesPerBox} onChange={(e) => { const v = Math.max(1, Math.min(20, Number(e.target.value) || 1)); setMaxArticlesPerBox(v); updateSettings({ maxArticlesPerBox: v }); }} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]" min="1" max="20" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Отгрузок/мес.</span>
                <input type="number" value={shipmentsPerMonth} onChange={(e) => { const v = Math.max(1, Math.min(8, Number(e.target.value) || 1)); setShipmentsPerMonth(v); updateSettings({ shipmentsPerMonth: v }); }} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]" min="1" max="8" />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Мин. штук</span>
                <input type="number" value={minUnits} onChange={(e) => { const v = Math.max(1, Math.min(100, Number(e.target.value) || 1)); setMinUnits(v); updateSettings({ minUnits: v }); }} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]" min="1" max="100" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Округление</span>
                <select value={roundTo} onChange={(e) => { const v = Number(e.target.value); setRoundTo(v); updateSettings({ roundTo: v }); }} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-1 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]">
                  <option value={1}>1</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </div>
              <div className="pt-1 border-t border-[var(--border)]">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Вид укладки</div>
                <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
                  {([
                    { key: "cards" as PackingVariant, label: "А" },
                    { key: "table" as PackingVariant, label: "Б" },
                    { key: "columns" as PackingVariant, label: "В" },
                  ]).map(({ key, label }) => (
                    <button key={key} onClick={() => { setPackingVariant(key); updateSettings({ packingVariant: key }); }}
                      className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors border-l first:border-l-0 border-[var(--border)] ${packingVariant === key ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-white"}`}
                    >{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>}

      {/* Packing by region */}
      {packingByRegion.map(({ region, packing }) => (
        packing.totalBoxes > 0 && (
          <PackingView
            key={region.id}
            result={packing}
            regionName={region.shortName}
            variant={packingVariant}
          />
        )
      ))}

      {/* Postponed items */}
      {packingByRegion.some((p) => p.postponed && p.postponed.length > 0) && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <div className="text-sm font-bold text-[var(--text-muted)] cursor-pointer select-none flex items-center justify-between" onClick={() => setPostponedOpen(!postponedOpen)}>
            <span>Отложено до следующей отгрузки <span className="font-normal text-[10px]">(дефицит &lt; {minUnits} шт)</span></span>
            <span className="text-xs">{postponedOpen ? "▼" : "◀"}</span>
          </div>
          {postponedOpen && <div className="mt-3">
          <div className="overflow-auto">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Артикул WB</th>
                  <th>Наименование</th>
                  <th>Размер</th>
                  <th>Регион</th>
                  <th className="num">Дефицит шт</th>
                  <th className="num">Продаж/день</th>
                  <th className="num">Покрывает дней</th>
                </tr>
              </thead>
              <tbody>
                {packingByRegion.flatMap(({ region, postponed }) =>
                  (postponed || []).map((item: any, i: number) => (
                    <tr key={`${region.id}-${i}`} className="opacity-60">
                      <td className="font-mono">{item.articleWB || "—"}</td>
                      <td>{item.productName || "—"}</td>
                      <td>{item.size}</td>
                      <td>{region.shortName}</td>
                      <td className="num">{item.needed}</td>
                      <td className="num">{item.salesPerDay?.toFixed(1) || "—"}</td>
                      <td className="num">{item.deficitDays?.toFixed(1) || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </div>}
        </div>
      )}

      {/* Summary table — sizes × what goes where */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
        <div className="text-sm font-bold text-[var(--text-muted)] cursor-pointer select-none flex items-center justify-between" onClick={() => setDetailsOpen(!detailsOpen)}>
          <span>Детализация по регионам</span>
          <span className="text-xs">{detailsOpen ? "▼" : "◀"}</span>
        </div>
        {detailsOpen && <div className="mt-3 overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              {isAllMode && <th>Артикул WB</th>}
              {isAllMode && <th>Баркод</th>}
              {isAllMode && <th>Артикул продавца</th>}
              <th>Размер</th>
              <th className="num">Шт/кор</th>
              <th className="num">Объём 1 шт (л)</th>
              <th className="num">На ВБ</th>
              <th className="num">V2 план</th>
              {regionConfigs.map((r) => (
                <th key={r.id} className="num border-l border-[var(--border)]">{r.shortName} нужно</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const currArticle = row.articleWB;
              const prevArticle = idx > 0 ? rows[idx - 1].articleWB : null;
              const isFirstOfArticle = !prevArticle || prevArticle !== currArticle;
              return (
              <tr key={row.barcode} className={isAllMode && isFirstOfArticle && idx > 0 ? "border-t-2 border-[var(--accent)]/30" : ""}>
                {isAllMode && <td className="font-mono">{isFirstOfArticle ? currArticle || "—" : ""}</td>}
                {isAllMode && <td className="font-mono">{row.barcode}</td>}
                {isAllMode && <td>{isFirstOfArticle ? row.articleName || "—" : ""}</td>}
                <td className="font-medium">{row.size}</td>
                <td className="num">{row.perBox}</td>
                <td className="num">{unitVolumeLiters(boxConfig, row.perBox).toFixed(2)}</td>
                <td className="num">{formatNumber(row.totalOnWB)}</td>
                <td className="num font-medium" style={{ color: trend?.direction === "up" ? "var(--success)" : trend?.direction === "down" ? "var(--danger)" : "var(--text)" }}>
                  {formatNumber(row.totalOrders30d, 1)}
                </td>
                {row.regions.map((reg) => {
                  const deficit = Math.max(0, reg.plan - reg.fact);
                  return (
                    <td key={reg.regionId} className={`num border-l border-[var(--border)] ${deficit > 0 ? "text-[var(--warning)]" : "cell-positive"}`}>
                      {deficit > 0 ? formatNumber(Math.ceil(deficit)) : "—"}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>}
      </div>
    </div>
  );
}
