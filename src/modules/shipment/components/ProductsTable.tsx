"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useData } from "@/components/DataProvider";
import { ProductRow } from "./ProductRow";
import type { Product } from "@/types";

interface ProductsTableProps {
  products: Product[];
  expandedProduct: string | null;
  onToggleExpand: (articleWB: string) => void;
  className?: string;
}

export function ProductsTable({
  products,
  expandedProduct,
  onToggleExpand,
  className = "",
}: ProductsTableProps) {
  const { stock, orderAggregates } = useData();
  const [scrollBufferHeight, setScrollBufferHeight] = useState(0);

  useEffect(() => {
    if (scrollBufferHeight <= 0 || typeof window === "undefined") return;

    let frame = 0;
    const clearWhenSafe = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const doc = document.documentElement;
        const maxScrollWithoutBuffer = Math.max(0, doc.scrollHeight - scrollBufferHeight - window.innerHeight);
        if (window.scrollY <= maxScrollWithoutBuffer - 8) {
          setScrollBufferHeight(0);
        }
      });
    };

    clearWhenSafe();
    window.addEventListener("scroll", clearWhenSafe, { passive: true });
    window.addEventListener("resize", clearWhenSafe);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", clearWhenSafe);
      window.removeEventListener("resize", clearWhenSafe);
    };
  }, [scrollBufferHeight]);

  const handleCollapseBuffer = useCallback((height: number) => {
    setScrollBufferHeight(Math.max(0, Math.ceil(height)));
  }, []);

  // articleWB → non-cancelled order count (из агрегатов, один проход)
  const orderCountsByArticleWB = React.useMemo(() => {
    const m = new Map<string, number>();
    if (orderAggregates) {
      for (const b of Object.values(orderAggregates.perBarcode)) {
        const key = String(b.articleWB);
        m.set(key, (m.get(key) || 0) + (b.totalOrders - b.cancelledOrders));
      }
    }
    return m;
  }, [orderAggregates]);

  return (
    <div className={`bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-x-auto ${className}`}>
      <table className="data-table" style={{ tableLayout: "fixed", minWidth: 800 }}>
        <colgroup>
          <col style={{ width: "11%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "42%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Артикул WB</th>
            <th>Артикул продавца</th>
            <th style={{ textAlign: "left" }}>Наименование продавца</th>
            <th style={{ textAlign: "center" }}>На складах</th>
            <th style={{ textAlign: "center" }}>Заказов 30д</th>
            <th style={{ textAlign: "center" }}>Размеров</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const isExpanded = expandedProduct === product.articleWB;
            const productStock = stock.filter(
              (s) => s.articleWB === product.articleWB
            );
            const totalOnWH = productStock.reduce(
              (s, i) => s + i.totalOnWarehouses,
              0
            );
            const orderCount = orderCountsByArticleWB.get(product.articleWB) || 0;

            return (
              <ProductRow
                key={product.articleWB}
                product={product}
                totalOnWH={totalOnWH}
                orderCount={orderCount}
                isExpanded={isExpanded}
                productStock={productStock}
                onToggle={() => onToggleExpand(product.articleWB)}
                onCollapseBuffer={handleCollapseBuffer}
              />
            );
          })}
        </tbody>
      </table>
      {scrollBufferHeight > 0 && (
        <div
          aria-hidden="true"
          style={{ height: scrollBufferHeight }}
        />
      )}
    </div>
  );
}
