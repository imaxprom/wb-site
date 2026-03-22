"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { sortShipmentRows } from "@/lib/calculation-engine";
import { formatNumber } from "@/lib/utils";
import { getWbImageUrl } from "@/lib/wb-image";
import type { Product, StockItem } from "@/types";
import Link from "next/link";

interface ProductRowProps {
  product: Product;
  totalOnWH: number;
  orderCount: number;
  isExpanded: boolean;
  productStock: StockItem[];
  onToggle: () => void;
}

export const ProductRow = React.memo(function ProductRow({
  product,
  totalOnWH,
  orderCount,
  isExpanded,
  productStock,
  onToggle,
}: ProductRowProps) {
  const { updateProductPerBox } = useData();

  const { warehouseMap, allWarehouses } = useMemo(() => {
    const whMap = new Map<string, Map<string, number>>();
    const whTotals = new Map<string, number>();
    for (const item of productStock) {
      for (const [wh, qty] of Object.entries(item.warehouseStock)) {
        if (qty <= 0) continue;
        whTotals.set(wh, (whTotals.get(wh) || 0) + qty);
        if (!whMap.has(item.size)) whMap.set(item.size, new Map());
        whMap.get(item.size)!.set(wh, (whMap.get(item.size)!.get(wh) || 0) + qty);
      }
    }
    const sorted = [...whTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([wh]) => wh);
    return { warehouseMap: whMap, allWarehouses: sorted };
  }, [productStock]);

  const sortedSizes = useMemo(() => sortShipmentRows(product.sizes), [product.sizes]);

  const handlePerBoxChange = useCallback(
    (barcode: string, value: number) => {
      if (value > 0) {
        updateProductPerBox(product.articleWB, barcode, value);
      }
    },
    [product.articleWB, updateProductPerBox]
  );

  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer">
        <td>
          <div className="flex items-center gap-2">
            <ProductThumb nmId={product.articleWB} />
            <span className="font-mono text-[var(--accent)]">{product.articleWB}</span>
          </div>
        </td>
        <td className="font-medium" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
          {product.name}
        </td>
        <td>{product.brand}</td>
        <td className="num">{product.sizes.length}</td>
        <td className="num">{formatNumber(totalOnWH)}</td>
        <td className="num">{formatNumber(orderCount)}</td>
        <td className="text-right text-[var(--text-muted)]">
          {isExpanded ? "▲" : "▼"}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} className="!p-0 !whitespace-normal">
            <div className="bg-[var(--bg)]/50 p-4 space-y-4 overflow-x-auto">
              {/* Size grid */}
              <div>
                <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  Размерная сетка
                </h4>
                <div className="overflow-auto">
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        <th>Размер</th>
                        <th>Баркод</th>
                        <th className="num">На складах</th>
                        <th className="num">Шт/кор</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSizes.map((s) => {
                        const sizeStock = productStock.find((st) => st.barcode === s.barcode);
                        return (
                          <tr key={s.barcode}>
                            <td className="font-medium">{s.size}</td>
                            <td className="font-mono text-[var(--text-muted)]">{s.barcode}</td>
                            <td className="num font-bold">
                              {formatNumber(sizeStock?.totalOnWarehouses || 0)}
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                value={s.perBox}
                                onChange={(e) => handlePerBoxChange(s.barcode, Number(e.target.value))}
                                onClick={(e) => e.stopPropagation()}
                                className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-xs focus:outline-none focus:border-[var(--accent)]"
                                min="1"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Warehouse stock table */}
              {allWarehouses.length > 0 && (
                <div>
                  <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">
                    Остатки по складам
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="data-table text-xs">
                      <thead>
                        <tr>
                          <th>Размер</th>
                          <th className="num">Итого</th>
                          {allWarehouses.map((wh) => (
                            <th key={wh} className="num">
                              {wh.length > 20 ? wh.substring(0, 20) + "..." : wh}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSizes.map((s) => {
                          const sizeWH = warehouseMap.get(s.size);
                          const total = sizeWH
                            ? Array.from(sizeWH.values()).reduce((a, b) => a + b, 0)
                            : 0;
                          return (
                            <tr key={s.barcode}>
                              <td className="font-medium">{s.size}</td>
                              <td className="num font-bold">{total}</td>
                              {allWarehouses.map((wh) => (
                                <td key={wh} className="num">
                                  {sizeWH?.get(wh) || (
                                    <span className="text-[var(--text-muted)]">—</span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Link
                href="/shipment"
                className="inline-block text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
              >
                Перейти к расчёту отгрузки →
              </Link>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

function ProductThumb({ nmId }: { nmId: string }) {
  const [failed, setFailed] = useState(false);
  const url = getWbImageUrl(nmId, "small");

  if (!url || failed) {
    return (
      <div className="w-8 h-8 rounded bg-[var(--border)] flex-shrink-0" />
    );
  }

  return (
    <img
      src={url}
      alt=""
      width={32}
      height={32}
      className="w-8 h-8 rounded object-cover flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
