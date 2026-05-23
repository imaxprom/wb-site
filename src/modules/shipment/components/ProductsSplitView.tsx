"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Search, X } from "lucide-react";
import { useData } from "@/components/DataProvider";
import { sortShipmentRows } from "@/modules/shipment/lib/engine";
import { formatNumber } from "@/lib/utils";
import type { Product, StockItem } from "@/types";

type SizeRow = {
  size: string;
  barcode: string;
  perBox: number;
  totalOnWB: number;
  orders30d: number;
  disabled: boolean;
  warehouses: Record<string, number>;
};

interface ProductsSplitViewProps {
  title?: string;
  description?: string;
}

function productTitle(product: Product, customName: string) {
  return customName.trim() || product.name || product.articleWB;
}

export default function ProductsSplitView({
  title = "Товары",
  description = "Слева артикулы, справа размерная таблица выбранного артикула.",
}: ProductsSplitViewProps) {
  const {
    products,
    stock,
    orderAggregates,
    overrides,
    isLoaded,
    updateProductPerBox,
    updateCustomName,
    toggleSizeDisabled,
  } = useData();
  const [selectedArticle, setSelectedArticle] = useState("");
  const [query, setQuery] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isWarehouseStockOpen, setIsWarehouseStockOpen] = useState(false);

  const articleStats = useMemo(() => {
    const stockTotals = new Map<string, number>();
    const orderTotals = new Map<string, number>();
    for (const item of stock) {
      stockTotals.set(item.articleWB, (stockTotals.get(item.articleWB) || 0) + item.totalOnWarehouses);
    }
    if (orderAggregates) {
      for (const row of Object.values(orderAggregates.perBarcode)) {
        orderTotals.set(row.articleWB, (orderTotals.get(row.articleWB) || 0) + (row.totalOrders - row.cancelledOrders));
      }
    }
    return { stockTotals, orderTotals };
  }, [orderAggregates, stock]);

  const sortedProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...products]
      .filter((product) => {
        const customName = overrides[product.articleWB]?.customName || "";
        if (!q) return true;
        return (
          product.articleWB.includes(q) ||
          product.name.toLowerCase().includes(q) ||
          customName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const stockDiff = (articleStats.stockTotals.get(b.articleWB) || 0) - (articleStats.stockTotals.get(a.articleWB) || 0);
        if (stockDiff !== 0) return stockDiff;
        return a.articleWB.localeCompare(b.articleWB);
      });
  }, [articleStats.stockTotals, overrides, products, query]);

  const selectedProduct = useMemo(() => {
    if (selectedArticle) {
      const selected = products.find((product) => product.articleWB === selectedArticle);
      if (selected) return selected;
    }
    return sortedProducts[0] || products[0] || null;
  }, [products, selectedArticle, sortedProducts]);

  const selectedOverride = selectedProduct ? overrides[selectedProduct.articleWB] : undefined;
  const customName = selectedOverride?.customName || "";

  const sizeRows = useMemo<SizeRow[]>(() => {
    if (!selectedProduct) return [];
    const productStock = stock.filter((item) => item.articleWB === selectedProduct.articleWB);
    const stockByBarcode = new Map<string, StockItem>();
    for (const item of productStock) stockByBarcode.set(item.barcode, item);
    return sortShipmentRows(selectedProduct.sizes).map((size) => {
      const stockItem = stockByBarcode.get(size.barcode);
      const orderRow = orderAggregates?.perBarcode[size.barcode];
      return {
        size: size.size,
        barcode: size.barcode,
        perBox: selectedOverride?.perBox[size.barcode] ?? size.perBox,
        totalOnWB: stockItem?.totalOnWarehouses || 0,
        orders30d: orderRow ? orderRow.totalOrders - orderRow.cancelledOrders : 0,
        disabled: Boolean(selectedOverride?.disabledSizes?.[size.barcode]),
        warehouses: stockItem?.warehouseStock || {},
      };
    });
  }, [orderAggregates, selectedOverride, selectedProduct, stock]);

  const warehouseColumns = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of sizeRows) {
      for (const [warehouse, qty] of Object.entries(row.warehouses)) {
        if (qty > 0) totals.set(warehouse, (totals.get(warehouse) || 0) + qty);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([warehouse]) => warehouse);
  }, [sizeRows]);

  if (!isLoaded) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--text-muted)]">
        Загрузка...
      </div>
    );
  }

  if (!selectedProduct) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-[var(--text-muted)]">
        Нет товаров
      </div>
    );
  }

  const totalStock = articleStats.stockTotals.get(selectedProduct.articleWB) || 0;
  const totalOrders = articleStats.orderTotals.get(selectedProduct.articleWB) || 0;

  const saveName = () => {
    updateCustomName(selectedProduct.articleWB, nameDraft.trim());
    setEditingName(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-[var(--text-muted)]">{description}</p>
        </div>
        <div className="text-sm text-[var(--text-muted)]">
          {formatNumber(products.length)} артикулов
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-160px)] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-h-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border)] p-3">
            <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <Search size={16} className="text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Артикул или название"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>
          <div className="max-h-[calc(100vh-245px)] overflow-auto">
            {sortedProducts.map((product) => {
              const selected = product.articleWB === selectedProduct.articleWB;
              const productCustomName = overrides[product.articleWB]?.customName || "";
              const stockQty = articleStats.stockTotals.get(product.articleWB) || 0;
              const ordersQty = articleStats.orderTotals.get(product.articleWB) || 0;
              return (
                <button
                  key={product.articleWB}
                  type="button"
                  onClick={() => {
                    setSelectedArticle(product.articleWB);
                    setEditingName(false);
                    setIsWarehouseStockOpen(false);
                  }}
                  className={`grid w-full gap-1 border-b border-[var(--border)] px-3 py-3 text-left transition-colors ${
                    selected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--bg-card-hover)]"
                  }`}
                >
                  <span className="font-mono text-sm text-[var(--accent)]">{product.articleWB}</span>
                  <span className="truncate text-sm font-medium text-[var(--text)]" title={productTitle(product, productCustomName)}>
                    {productTitle(product, productCustomName)}
                  </span>
                  <span className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>{formatNumber(stockQty)} шт</span>
                    <span>{formatNumber(ordersQty)} заказов</span>
                    <span>{product.sizes.length} разм.</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border)] p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg text-[var(--accent)]">{selectedProduct.articleWB}</span>
                  <span className="text-sm text-[var(--text-muted)]">{selectedProduct.name}</span>
                </div>
                <div className="mt-2">
                  {editingName ? (
                    <div className="flex max-w-2xl items-center gap-2">
                      <input
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveName();
                          if (event.key === "Escape") {
                            setNameDraft(customName);
                            setEditingName(false);
                          }
                        }}
                        className="min-w-0 flex-1 rounded-md border border-[var(--accent)] bg-[var(--bg)] px-3 py-2 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={saveName}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--success)] hover:border-[var(--success)]"
                        title="Сохранить"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNameDraft(customName);
                          setEditingName(false);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                        title="Отменить"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex max-w-2xl items-center gap-2">
                      <div className="min-w-0 flex-1 truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" title={customName || "Не задано"}>
                        {customName || <span className="text-[var(--text-muted)]">—</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setNameDraft(customName);
                          setEditingName(true);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        title="Редактировать наименование"
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label="На WB" value={formatNumber(totalStock)} />
                <Metric label="Заказов" value={formatNumber(totalOrders)} />
              </div>
            </div>
          </div>

          <div className="max-h-[calc(100vh-315px)] overflow-auto">
            <table className="data-table min-w-[1180px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-[var(--bg-card)]">Размер</th>
                  <th>Баркод</th>
                  <th className="num">На WB</th>
                  <th className="num">Заказов 30д</th>
                  <th className="num">Шт/кор</th>
                  <th className="text-center">Отгрузка</th>
                </tr>
              </thead>
              <tbody>
                {sizeRows.map((row) => (
                  <tr key={row.barcode} className={row.disabled ? "opacity-45" : ""}>
                    <td className="sticky left-0 z-10 bg-[var(--bg-card)] font-medium">{row.size}</td>
                    <td className="font-mono text-[var(--text-muted)]">{row.barcode}</td>
                    <td className="num font-semibold">{formatNumber(row.totalOnWB)}</td>
                    <td className="num">{formatNumber(row.orders30d)}</td>
                    <td className="num">
                      <input
                        type="number"
                        min="1"
                        value={row.perBox > 0 ? row.perBox : ""}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (value > 0) updateProductPerBox(selectedProduct.articleWB, row.barcode, value);
                        }}
                        placeholder="—"
                        className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-center text-sm outline-none focus:border-[var(--accent)]"
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => toggleSizeDisabled(selectedProduct.articleWB, row.barcode, !row.disabled)}
                        className={`relative h-5 w-10 rounded-full transition-colors ${row.disabled ? "bg-[var(--border)]" : "bg-[var(--success)]"}`}
                        title={row.disabled ? "Отключено" : "Включено"}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${row.disabled ? "left-0.5" : "left-5"}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {warehouseColumns.length > 0 && (
              <div className="border-t border-[var(--border)] p-4">
                <button
                  type="button"
                  onClick={() => setIsWarehouseStockOpen((value) => !value)}
                  className="flex w-full items-center justify-between rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left transition-colors hover:border-[var(--accent)]"
                >
                  <span className="text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Остатки по складам
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {warehouseColumns.length} складов {isWarehouseStockOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isWarehouseStockOpen && (
                  <div className="mt-2 overflow-auto">
                    <table className="data-table min-w-[1180px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-20 bg-[var(--bg-card)]">Размер</th>
                          <th className="num">Итого</th>
                          {warehouseColumns.map((warehouse) => (
                            <th key={warehouse} className="num min-w-[120px]" title={warehouse}>
                              {warehouse.length > 18 ? `${warehouse.slice(0, 18)}...` : warehouse}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sizeRows.map((row) => (
                          <tr key={`${row.barcode}:warehouse`}>
                            <td className="sticky left-0 z-10 bg-[var(--bg-card)] font-medium">{row.size}</td>
                            <td className="num font-semibold">{formatNumber(row.totalOnWB)}</td>
                            {warehouseColumns.map((warehouse) => (
                              <td key={warehouse} className="num">
                                {row.warehouses[warehouse] ? formatNumber(row.warehouses[warehouse]) : <span className="text-[var(--text-muted)]">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-base font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}
