"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/components/DataProvider";
import { sortShipmentRows } from "@/modules/shipment/lib/engine";
import { formatNumber } from "@/lib/utils";
import { getWbImageUrlCandidates } from "@/lib/wb-image";
import type { Product, StockItem } from "@/types";
import Link from "next/link";
import { Check, Pencil, X } from "lucide-react";

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
  const { overrides, updateProductPerBox, updateCustomName, toggleSizeDisabled } = useData();

  const override = overrides[product.articleWB];
  const customName = override?.customName || "";
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(customName);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const anchorTopRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNameEditing) setNameDraft(customName);
  }, [customName, isNameEditing]);

  useEffect(() => {
    if (isNameEditing) nameInputRef.current?.focus();
  }, [isNameEditing]);

  useLayoutEffect(() => {
    if (anchorTopRef.current === null || typeof window === "undefined") return;
    const beforeTop = anchorTopRef.current;
    const frame = window.requestAnimationFrame(() => {
      const afterTop = rowRef.current?.getBoundingClientRect().top;
      if (typeof afterTop === "number") {
        window.scrollBy(0, afterTop - beforeTop);
      }
      anchorTopRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isExpanded]);

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

  const sortedSizes = useMemo(() => {
    // Apply perBox overrides
    return sortShipmentRows(product.sizes).map((s) => ({
      ...s,
      perBox: override?.perBox[s.barcode] ?? s.perBox,
    }));
  }, [product.sizes, override]);

  const handlePerBoxChange = useCallback(
    (barcode: string, value: number) => {
      if (value > 0) {
        updateProductPerBox(product.articleWB, barcode, value);
      }
    },
    [product.articleWB, updateProductPerBox]
  );

  const handleNameChange = useCallback(
    (value: string) => {
      updateCustomName(product.articleWB, value);
    },
    [product.articleWB, updateCustomName]
  );

  const handleToggle = useCallback(() => {
    anchorTopRef.current = rowRef.current?.getBoundingClientRect().top ?? null;
    onToggle();
  }, [onToggle]);

  const saveName = useCallback(() => {
    const next = nameDraft.trim();
    if (next !== customName) {
      handleNameChange(next);
    }
    setIsNameEditing(false);
  }, [customName, handleNameChange, nameDraft]);

  const cancelNameEdit = useCallback(() => {
    setNameDraft(customName);
    setIsNameEditing(false);
  }, [customName]);

  return (
    <>
      <tr ref={rowRef} onClick={handleToggle} className="cursor-pointer">
        <td>
          <div className="flex items-center gap-2">
            <ProductThumb nmId={product.articleWB} />
            <span className="font-mono text-[var(--accent)]">{product.articleWB}</span>
          </div>
        </td>
        <td className="font-medium" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
          {product.name}
        </td>
        <td>
          {isNameEditing ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                ref={nameInputRef}
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") cancelNameEdit();
                }}
                onPaste={(e) => e.stopPropagation()}
                onBlur={saveName}
                placeholder="—"
                className="min-w-0 flex-1 bg-[var(--bg)] border border-[var(--accent)] rounded px-2 py-1 text-base focus:outline-none"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  saveName();
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--success)] hover:border-[var(--success)]"
                title="Сохранить"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelNameEdit();
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                title="Отменить"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[var(--text)]" title={customName || "Не задано"}>
                {customName || <span className="text-[var(--text-muted)]">—</span>}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setNameDraft(customName);
                  setIsNameEditing(true);
                }}
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--accent)]"
                title="Редактировать наименование"
              >
                <Pencil size={14} />
              </button>
            </div>
          )}
        </td>
        <td style={{ textAlign: "center" }}>{formatNumber(totalOnWH)}</td>
        <td style={{ textAlign: "center" }}>{formatNumber(orderCount)}</td>
        <td style={{ textAlign: "center" }}>{product.sizes.length}</td>
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
                <h4 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  Размерная сетка
                </h4>
                <div className="overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Размер</th>
                        <th>Баркод</th>
                        <th className="num">На складах</th>
                        <th className="num">Шт/кор</th>
                        <th className="text-center">Отгрузка</th>
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
                                value={s.perBox > 0 ? s.perBox : ""}
                                onChange={(e) => handlePerBoxChange(s.barcode, Number(e.target.value))}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="—"
                                className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-[var(--accent)]"
                                min="1"
                              />
                            </td>
                            <td className="text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const isDisabled = override?.disabledSizes?.[s.barcode] || false;
                                  toggleSizeDisabled(product.articleWB, s.barcode, !isDisabled);
                                }}
                                className={`w-10 h-5 rounded-full transition-colors relative ${
                                  override?.disabledSizes?.[s.barcode]
                                    ? "bg-[var(--border)]"
                                    : "bg-[var(--success)]"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                    override?.disabledSizes?.[s.barcode]
                                      ? "left-0.5"
                                      : "left-5"
                                  }`}
                                />
                              </button>
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
                  <h4 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                    Остатки по складам
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="data-table">
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
  const urls = useMemo(() => getWbImageUrlCandidates(nmId, "small"), [nmId]);
  const [urlIndex, setUrlIndex] = useState(0);
  const url = urls[urlIndex];

  useEffect(() => {
    setUrlIndex(0);
  }, [nmId]);

  if (!url) {
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
      onError={() => setUrlIndex((current) => current + 1)}
    />
  );
}
