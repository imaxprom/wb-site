"use client";

import React, { useMemo, useState, useCallback } from "react";
import { useData } from "./DataProvider";
import { calculateShipment, calculateDeficit } from "@/lib/calculation-engine";
import { formatNumber } from "@/lib/utils";
import { exportShipmentExcel } from "@/lib/export-excel";
import { exportShipmentExcelV2 } from "@/lib/export-excel-v2";
import type { Product, ShipmentCalculation } from "@/types";
import { WarehouseBreakdown } from "./WarehouseBreakdown";

export function ShipmentTable() {
  const { stock, orders, products, settings } = useData();
  const [selectedProduct, setSelectedProduct] = useState<string>("");

  const sortedProducts = useMemo(() => {
    // Precompute stock totals by articleWB to avoid O(n*m) filtering
    const stockTotals = new Map<string, number>();
    for (const s of stock) {
      stockTotals.set(s.articleWB, (stockTotals.get(s.articleWB) || 0) + s.totalOnWarehouses);
    }
    return [...products].sort((a, b) => {
      return (stockTotals.get(b.articleWB) || 0) - (stockTotals.get(a.articleWB) || 0);
    });
  }, [products, stock]);

  const product = useMemo(() => {
    if (selectedProduct) return products.find((p) => p.articleWB === selectedProduct);
    return sortedProducts[0];
  }, [products, sortedProducts, selectedProduct]);

  const calculation: ShipmentCalculation | null = useMemo(() => {
    if (!product || stock.length === 0) return null;
    return calculateShipment(product, stock, orders, settings.buyoutRate, settings.regions);
  }, [product, stock, orders, settings]);

  const allCalculations = useMemo(() => {
    if (!sortedProducts.length || !stock.length) return [];
    return sortedProducts.map((p) =>
      calculateShipment(p, stock, orders, settings.buyoutRate, settings.regions)
    );
  }, [sortedProducts, stock, orders, settings]);

  const handleExport = useCallback(() => {
    if (allCalculations.length === 0) return;
    exportShipmentExcel(allCalculations);
  }, [allCalculations]);

  const handleExportV2 = useCallback(() => {
    if (allCalculations.length === 0) return;
    exportShipmentExcelV2(allCalculations);
  }, [allCalculations]);

  if (!calculation) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
        <p className="text-4xl mb-4">📦</p>
        <p className="text-lg font-medium">Нет данных для расчёта</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Загрузите Excel файл на странице &quot;Загрузка данных&quot;
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Product selector */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={selectedProduct || product?.articleWB || ""}
          onChange={(e) => setSelectedProduct(e.target.value)}
          className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] max-w-[400px] truncate"
        >
          {sortedProducts.map((p) => (
            <option key={p.articleWB} value={p.articleWB}>
              {p.name} (WB: {p.articleWB})
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>% выкупа:</span>
          <span className="text-white font-medium">{(settings.buyoutRate * 100).toFixed(0)}%</span>
        </div>

        <button
          onClick={handleExport}
          disabled={allCalculations.length === 0}
          className="ml-auto px-5 py-2 bg-[var(--success)] hover:bg-[var(--success)]/80 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
        >
          Сформировать отгрузку
        </button>
        <button
          onClick={handleExportV2}
          disabled={allCalculations.length === 0}
          className="px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
        >
          Сформировать отгрузку v2
        </button>
      </div>

      {/* Main table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-auto max-h-[75vh]">
        <table className="data-table">
          <thead>
            <tr>
              <th rowSpan={2}>Размер</th>
              <th rowSpan={2} className="num">Шт/кор</th>
              <th rowSpan={2} className="num">На ВБ</th>
              <th rowSpan={2} className="num">Заказы 30д</th>
              <th rowSpan={2} className="num">Коробки</th>
              <th rowSpan={2} className="num">Запас +15д</th>
              {calculation.regionConfigs.map((r) => (
                <th key={r.id} colSpan={3} className="text-center border-l border-[var(--border)]">
                  {r.shortName} ({(r.percentage * 100).toFixed(0)}%)
                </th>
              ))}
            </tr>
            <tr>
              {calculation.regionConfigs.map((r) => (
                <React.Fragment key={r.id}>
                  <th className="num border-l border-[var(--border)]">План</th>
                  <th className="num">Факт</th>
                  <th className="num">Кор.</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {calculation.rows.map((row) => {
              const deficit = calculateDeficit(row);
              return (
                <tr key={row.barcode}>
                  <td className="font-medium">{row.size}</td>
                  <td className="num">{row.perBox}</td>
                  <td className="num">{formatNumber(row.totalOnWB)}</td>
                  <td className="num">{formatNumber(row.totalOrders30d, 1)}</td>
                  <td className="num font-medium">{formatNumber(row.planBoxes, 1)}</td>
                  <td className="num">{formatNumber(row.reserveBoxes, 1)}</td>
                  {row.regions.map((reg) => {
                    const diff = reg.fact - reg.plan;
                    return (
                      <React.Fragment key={reg.regionId}>
                        <td className="num border-l border-[var(--border)]">
                          {formatNumber(reg.plan, 1)}
                        </td>
                        <td
                          className={`num font-medium ${
                            diff >= 0 ? "cell-positive" : "cell-negative"
                          }`}
                        >
                          {formatNumber(reg.fact)}
                        </td>
                        <td
                          className={`num ${
                            reg.boxes === 0 ? "cell-zero" : "cell-warning"
                          }`}
                        >
                          {formatNumber(reg.boxes, 1)}
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
              <td>Итого</td>
              <td></td>
              <td className="num">{formatNumber(calculation.totals.totalOnWB)}</td>
              <td className="num">{formatNumber(calculation.totals.totalOrders, 1)}</td>
              <td className="num">
                {formatNumber(calculation.rows.reduce((s, r) => s + r.planBoxes, 0), 1)}
              </td>
              <td className="num">
                {formatNumber(calculation.rows.reduce((s, r) => s + r.reserveBoxes, 0), 1)}
              </td>
              {calculation.regionConfigs.map((reg) => {
                const planSum = calculation.rows.reduce(
                  (s, r) => s + (r.regions.find((x) => x.regionId === reg.id)?.plan || 0),
                  0
                );
                const factSum = calculation.rows.reduce(
                  (s, r) => s + (r.regions.find((x) => x.regionId === reg.id)?.fact || 0),
                  0
                );
                const boxSum = calculation.rows.reduce(
                  (s, r) => s + (r.regions.find((x) => x.regionId === reg.id)?.boxes || 0),
                  0
                );
                return (
                  <React.Fragment key={reg.id}>
                    <td className="num border-l border-[var(--border)]">{formatNumber(planSum, 1)}</td>
                    <td className={`num ${factSum >= planSum ? "cell-positive" : "cell-negative"}`}>
                      {formatNumber(factSum)}
                    </td>
                    <td className="num">{formatNumber(boxSum, 1)}</td>
                  </React.Fragment>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Warehouse breakdown */}
      <WarehouseBreakdown calculation={calculation} />
    </div>
  );
}
