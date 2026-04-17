"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { ProductsTable } from "@/modules/shipment/components/ProductsTable";
import type { Product } from "@/types";
import Link from "next/link";

export default function ProductsPage() {
  const { stock, products, isLoaded } = useData();
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  const { activeProducts, emptyProducts } = useMemo(() => {
    const stockTotals = new Map<string, number>();
    for (const s of stock) {
      stockTotals.set(s.articleWB, (stockTotals.get(s.articleWB) || 0) + s.totalOnWarehouses);
    }
    const active: Product[] = [];
    const empty: Product[] = [];
    for (const p of products) {
      ((stockTotals.get(p.articleWB) || 0) > 0 ? active : empty).push(p);
    }
    active.sort((a, b) => (stockTotals.get(b.articleWB) || 0) - (stockTotals.get(a.articleWB) || 0));
    return { activeProducts: active, emptyProducts: empty };
  }, [products, stock]);

  const handleToggleExpand = (articleWB: string) => {
    setExpandedProduct((prev) => (prev === articleWB ? null : articleWB));
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Товары</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Карточки товаров из Wildberries
        </p>
      </div>

      {/* Active products table */}
      {activeProducts.length > 0 ? (
        <div>
          <ProductsTable
            products={activeProducts}
            expandedProduct={expandedProduct}
            onToggleExpand={handleToggleExpand}
          />

          {/* Empty products toggle */}
          {emptyProducts.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowEmpty(!showEmpty)}
                className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                <span>{showEmpty ? "▲" : "▼"}</span>
                <span>
                  {showEmpty ? "Скрыть" : "Показать все товары"} ({emptyProducts.length} без остатков)
                </span>
              </button>

              {showEmpty && (
                <ProductsTable
                  products={emptyProducts}
                  expandedProduct={expandedProduct}
                  onToggleExpand={handleToggleExpand}
                  className="mt-3 opacity-70"
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
          <p className="text-4xl mb-4">📋</p>
          <p className="text-lg font-medium">Нет загруженных товаров</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Загрузите данные на вкладке{" "}
            <Link href="/upload" className="text-[var(--accent)] hover:underline">
              Загрузка данных
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
