"use client";

import React, { useMemo, useState, useCallback } from "react";
import { useData } from "@/components/DataProvider";
import { calculateShipmentV2, type ShipmentCalculationV2 } from "@/modules/shipment/lib/engine";
import { exportShipmentExcelV2 } from "@/lib/export-excel-v2";
import { packItems, unitVolumeLiters, usableVolumeLiters, boxVolumeLiters, type PackingItem, type PackingResult, type BoxConfig } from "@/lib/packing-engine";
import { formatNumber } from "@/lib/utils";
import { useEffectiveRegions } from "@/modules/shipment/lib/use-effective-regions";
import { useEffectiveBuyout } from "@/modules/shipment/lib/use-effective-buyout";
import { InfoTip } from "@/components/Tooltip";
import { calculateTrend, type TrendResult } from "@/modules/shipment/lib/trend-engine";
import type { ShipmentRowExtended } from "@/types";
import { ArticleMultiSelect } from "./ArticleMultiSelect";

// ─── Packing Visualization ──────────────────────────────────

// ─── Вариант А: Карточки (сетка) ────────────────────────────

function PackingCards({ result }: { result: PackingResult }) {
  // Sort boxes by number of unique articles, then group identical boxes
  const groups = useMemo(() => {
    type BoxGroup = {
      key: string;
      firstBoxNumber: number;
      lastBoxNumber: number;
      boxNumbers: number[];
      count: number;
      articleCount: number;
      box: typeof result.boxes[0];
    };

    // First: sort boxes by number of unique articles (1 article first, then 2, 3...)
    const sorted = [...result.boxes].sort((a, b) => {
      const aArticles = new Set(a.items.map(e => e.item.articleWB)).size;
      const bArticles = new Set(b.items.map(e => e.item.articleWB)).size;
      if (aArticles !== bArticles) return aArticles - bArticles;
      return a.boxNumber - b.boxNumber;
    });

    // Then: group identical boxes (same items with same quantities)
    const grouped: BoxGroup[] = [];
    for (const box of sorted) {
      const sig = box.items
        .map(e => `${e.item.label}:${e.qty}`)
        .sort()
        .join("|");
      const articleCount = new Set(box.items.map(e => e.item.articleWB)).size;

      const last = grouped[grouped.length - 1];
      if (last && last.key === sig) {
        last.count++;
        last.boxNumbers.push(box.boxNumber);
        last.lastBoxNumber = Math.max(last.lastBoxNumber, box.boxNumber);
        last.firstBoxNumber = Math.min(last.firstBoxNumber, box.boxNumber);
      } else {
        grouped.push({
          key: sig,
          firstBoxNumber: box.boxNumber,
          lastBoxNumber: box.boxNumber,
          boxNumbers: [box.boxNumber],
          count: 1,
          articleCount,
          box,
        });
      }
    }
    return grouped;
  }, [result.boxes]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {groups.map((group) => {
        const { box, count, boxNumbers } = group;
        let label: string;
        if (count === 1) {
          label = `Короб ${boxNumbers[0]}`;
        } else {
          // Check if numbers are sequential
          const sorted = [...boxNumbers].sort((a, b) => a - b);
          const isSequential = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
          label = isSequential
            ? `Короба ${sorted[0]}-${sorted[sorted.length - 1]}`
            : `Короба ${sorted.join(", ")}`;
        }
        const fillColor = box.fillPercent > 85 ? "var(--success)" : box.fillPercent > 50 ? "var(--accent)" : "var(--warning)";

        return (
          <div key={group.key + boxNumbers[0]} className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{label}</span>
                {count > 1 && (
                  <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{
                    background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                    color: "var(--accent)",
                  }}>
                    ×{count}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono" style={{ color: fillColor }}>
                  {box.fillPercent.toFixed(0)}%
                </span>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: `conic-gradient(${fillColor} ${box.fillPercent}%, color-mix(in srgb, var(--border) 60%, transparent) 0)`,
                    position: "relative",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 3,
                      background: "var(--bg)",
                      borderRadius: "50%",
                    }}
                  />
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {(() => {
                // Split label into article and size for alignment
                const rows = box.items.map(entry => {
                  const parts = entry.item.label.split(" / ");
                  const article = parts[0] || "";
                  const size = parts[1] || "";
                  const bc = entry.item.barcode || "";
                  const bcStart = bc.slice(0, -6);
                  const bcEnd = bc.slice(-6);
                  return { article, size, bcStart, bcEnd, qty: entry.qty };
                });
                return (
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="text-[var(--text-muted)] pr-2 whitespace-nowrap">{row.article}</td>
                          <td className="text-[var(--text-muted)] pr-3 whitespace-nowrap">{row.size}</td>
                          <td className="font-mono pr-3 whitespace-nowrap">
                            <span className="text-[var(--text-muted)]">{row.bcStart}</span>
                            <span className="text-white text-sm font-semibold">{row.bcEnd}</span>
                          </td>
                          <td className="text-white font-medium text-right whitespace-nowrap">×{row.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Вариант Б: По артикулу + общий блок смешанных ──────────

function PackingByArticle({ result }: { result: PackingResult }) {
  type SizeEntry = { item: PackingItem; boxCount: number; qtyPerBox: number };
  type ArticleGroup = {
    articleWB: string;
    productName: string;
    sizes: SizeEntry[];
    totalBoxes: number;
    totalItems: number;
  };

  const { articles, otherBoxes } = useMemo(() => {
    const pureFull: typeof result.boxes = [];
    const other: typeof result.boxes = [];
    for (const box of result.boxes) {
      const isSingleItem = box.items.length === 1;
      const isFull = box.fillPercent >= 99;
      if (isSingleItem && isFull) pureFull.push(box);
      else other.push(box);
    }

    const map = new Map<string, ArticleGroup>();
    for (const box of pureFull) {
      const entry = box.items[0];
      const { item, qty } = entry;
      if (!map.has(item.articleWB)) {
        map.set(item.articleWB, {
          articleWB: item.articleWB,
          productName: item.productName || item.articleName || "—",
          sizes: [],
          totalBoxes: 0,
          totalItems: 0,
        });
      }
      const g = map.get(item.articleWB)!;
      const existing = g.sizes.find(s => s.item.id === item.id);
      if (existing) {
        existing.boxCount += 1;
      } else {
        g.sizes.push({ item, boxCount: 1, qtyPerBox: qty });
      }
      g.totalBoxes += 1;
      g.totalItems += qty;
    }

    const LETTER_ORDER: Record<string, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7 };
    const sizeSortKey = (s: string): number => {
      const num = s.match(/\d+/);
      if (num) return parseInt(num[0], 10);
      return LETTER_ORDER[s.trim().toUpperCase()] ?? 999;
    };
    for (const g of map.values()) {
      g.sizes.sort((a, b) => sizeSortKey(a.item.size) - sizeSortKey(b.item.size));
    }

    return { articles: Array.from(map.values()), otherBoxes: other };
  }, [result.boxes]);

  return (
    <div className="space-y-3">
      {articles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {articles.map(article => (
            <div key={article.articleWB} className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-[var(--border)]/40">
                <div>
                  <span className="font-mono text-sm text-[var(--text-muted)] mr-2">{article.articleWB}</span>
                  <span className="text-sm font-semibold text-white">{article.productName}</span>
                </div>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {article.sizes.map(s => {
                    const bc = s.item.barcode || "";
                    return (
                      <tr key={s.item.id}>
                        <td className="text-[var(--text-muted)] pr-3 whitespace-nowrap py-1">{s.item.size}</td>
                        <td className="font-mono pr-3 whitespace-nowrap py-1">
                          <span className="text-[var(--text-muted)]">{bc.slice(0, -6)}</span>
                          <span className="text-white font-semibold text-sm">{bc.slice(-6)}</span>
                        </td>
                        <td className="text-white text-right font-semibold whitespace-nowrap py-1 tabular-nums">
                          {s.boxCount}×{s.qtyPerBox}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 pt-2 border-t border-[var(--border)]/40 flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">{article.totalBoxes} полн. коробов</span>
                <span className="text-white font-semibold">{article.totalItems} шт</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {otherBoxes.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "color-mix(in srgb, var(--warning) 4%, transparent)",
            border: "1px dashed color-mix(in srgb, var(--warning) 35%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
              ⚠️ Смешанные и неполные коробы ({otherBoxes.length})
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {otherBoxes.map(box => (
              <div
                key={box.boxNumber}
                className="bg-[var(--bg)] rounded-lg p-3 text-xs"
                style={{ border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)" }}
              >
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-white font-semibold text-sm">Короб №{box.boxNumber}</span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--warning)" }}>
                    {box.fillPercent.toFixed(0)}%
                  </span>
                </div>
                <div className="space-y-0.5">
                  {box.items.map((entry, idx) => (
                    <div key={idx} className="font-mono text-[11px] text-[var(--text-muted)] leading-snug">
                      {entry.item.articleWB} · <span className="text-white font-semibold">{entry.item.size} ×{entry.qty}</span>
                    </div>
                  ))}
                </div>
                {box.fillPercent < 99 && (
                  <div
                    className="mt-2 pt-1.5 text-[10px] italic"
                    style={{
                      borderTop: "1px solid color-mix(in srgb, var(--warning) 15%, transparent)",
                      color: "var(--warning)",
                    }}
                  >
                    ↑ свободно ~{Math.round(100 - box.fillPercent)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Вариант В (прежний): Вертикальные столбцы ──────────────

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
      {variant === "table" && <PackingByArticle result={result} />}
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
  const { stock, orderAggregates, products, settings, overrides, updateSettings, isLoaded } = useData();
  const effectiveRegions = useEffectiveRegions();
  const getBuyout = useEffectiveBuyout();
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set());
  const [articlesInitialized, setArticlesInitialized] = useState(false);
  const [packingVariant, setPackingVariant] = useState<PackingVariant>((settings.packingVariant as PackingVariant) ?? "cards");
  const [hideInactive, setHideInactive] = useState(true);
  const [postponedOpen, setPostponedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [maxArticlesPerBox, setMaxArticlesPerBox] = useState(settings.maxArticlesPerBox ?? 4);
  const [shipmentsPerMonth, setShipmentsPerMonth] = useState(settings.shipmentsPerMonth ?? 4);
  const [minUnits, setMinUnits] = useState(settings.minUnits ?? 10);
  const [roundTo, setRoundTo] = useState(settings.roundTo ?? 5);

  // Sync local state when settings load from API
  React.useEffect(() => {
    if (settings.maxArticlesPerBox !== undefined) setMaxArticlesPerBox(settings.maxArticlesPerBox);
    if (settings.shipmentsPerMonth !== undefined) setShipmentsPerMonth(settings.shipmentsPerMonth);
    if (settings.minUnits !== undefined) setMinUnits(settings.minUnits);
    if (settings.roundTo !== undefined) setRoundTo(settings.roundTo);
    if (settings.packingVariant !== undefined) setPackingVariant(settings.packingVariant as PackingVariant);
  }, [settings.maxArticlesPerBox, settings.shipmentsPerMonth, settings.minUnits, settings.roundTo, settings.packingVariant]);

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
    if (orderAggregates) {
      for (const b of Object.values(orderAggregates.perBarcode)) {
        const key = String(b.articleWB);
        const nonCancelled = b.totalOrders - b.cancelledOrders;
        ot.set(key, (ot.get(key) || 0) + nonCancelled);
      }
    }
    const sorted = [...products].sort((a, b) => (ot.get(b.articleWB) || 0) - (ot.get(a.articleWB) || 0));
    return { sortedProducts: sorted, stockTotals: st, orderTotals: ot };
  }, [products, stock, orderAggregates]);

  const filteredProducts = useMemo(() => {
    if (!hideInactive) return sortedProducts;
    return sortedProducts.filter((p) => (stockTotals.get(p.articleWB) || 0) > 0 || (orderTotals.get(p.articleWB) || 0) > 0);
  }, [sortedProducts, hideInactive, stockTotals, orderTotals]);

  // Auto-select all when products first load
  React.useEffect(() => {
    if (!articlesInitialized && filteredProducts.length > 0) {
      setSelectedArticles(new Set(filteredProducts.map(p => p.articleWB)));
      setArticlesInitialized(true);
    }
  }, [filteredProducts, articlesInitialized]);

  // "Multi mode" — when more than 1 article selected (show combined table)
  const isAllMode = selectedArticles.size !== 1;

  const uploadDays = settings.uploadDays ?? 28;

  // Products to show (filtered by multiselect)
  const activeProducts = useMemo(() => {
    if (selectedArticles.size === 0) return [];
    return filteredProducts.filter(p => selectedArticles.has(p.articleWB));
  }, [filteredProducts, selectedArticles]);

  // Calculate V2 for active products
  const allCalcs = useMemo(() => {
    if (stock.length === 0 || activeProducts.length === 0) return [];
    return activeProducts.map((p) =>
      calculateShipmentV2(p, stock, orderAggregates, getBuyout(p.articleWB), effectiveRegions, overrides[p.articleWB], uploadDays)
    );
  }, [activeProducts, stock, orderAggregates, effectiveRegions, overrides, getBuyout, uploadDays]);

  // Single product calc (when exactly 1 selected)
  const singleCalc: ShipmentCalculationV2 | null = useMemo(() => {
    if (isAllMode || activeProducts.length !== 1) return null;
    const prod = activeProducts[0];
    if (!prod || stock.length === 0) return null;
    return calculateShipmentV2(prod, stock, orderAggregates, getBuyout(prod.articleWB), effectiveRegions, overrides[prod.articleWB], uploadDays);
  }, [activeProducts, isAllMode, stock, orderAggregates, effectiveRegions, overrides, getBuyout, uploadDays]);

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
    if (singleCalc && activeProducts.length === 1) {
      const prod = activeProducts[0];
      const extRows: ShipmentRowExtended[] = singleCalc.rows.map((r) => ({ ...r, articleWB: prod.articleWB, articleName: prod.name }));
      return { rows: extRows, trend: singleCalc.trend, regionConfigs: singleCalc.regionConfigs };
    }
    return { rows: [] as ShipmentRowExtended[], trend: null, regionConfigs: effectiveRegions };
  }, [isAllMode, allCalcs, singleCalc, effectiveRegions, activeProducts]);

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
        <ArticleMultiSelect
          products={filteredProducts}
          selected={selectedArticles}
          onChange={setSelectedArticles}
          orderCounts={orderTotals}
        />

        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideInactive}
            onChange={(e) => { setHideInactive(e.target.checked); setSelectedArticles(new Set()); }}
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
      {packingVariant === "columns" ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <h3 className="text-base font-bold text-white mb-2">Сводная таблица перенесена</h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Этот вариант доступен в <span className="text-[var(--accent)] font-medium">V2 Динамика</span> → режим <span className="text-[var(--accent)] font-medium">«Кораба»</span>.
          </p>
        </div>
      ) : (
        packingByRegion.map(({ region, packing }) => (
          packing.totalBoxes > 0 && (
            <PackingView
              key={region.id}
              result={packing}
              regionName={region.shortName}
              variant={packingVariant}
            />
          )
        ))
      )}

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
