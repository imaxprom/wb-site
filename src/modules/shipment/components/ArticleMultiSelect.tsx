"use client";

import React, { useState, useRef, useEffect } from "react";
import type { Product, ProductOverrides } from "@/types";

interface Props {
  products: Product[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  orderCounts: Map<string, number>;
  overrides?: ProductOverrides;
}

export function ArticleMultiSelect({ products, selected, onChange, orderCounts, overrides = {} }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const allSelected = selected.size === products.length && products.length > 0;

  const label = allSelected
    ? `Все артикулы (${products.length})`
    : selected.size === 0
      ? `Выберите артикулы (${products.length})`
      : `${selected.size} из ${products.length} артикулов`;

  function toggleAll() {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(products.map(p => p.articleWB)));
    }
  }

  function toggle(articleWB: string) {
    const next = new Set(selected);
    if (next.has(articleWB)) {
      next.delete(articleWB);
    } else {
      next.add(articleWB);
    }
    onChange(next);
  }

  // Sort by orders desc
  const sorted = [...products].sort((a, b) => {
    return (orderCounts.get(b.articleWB) || 0) - (orderCounts.get(a.articleWB) || 0);
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] flex items-center gap-2 min-w-[320px] max-w-[520px]"
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[min(920px,calc(100vw-32px))] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl z-50 max-h-[520px] overflow-y-auto">
          {/* Select All */}
          <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--bg-card-hover)] border-b border-[var(--border)]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-[var(--accent)] w-4 h-4 shrink-0"
            />
            <span className="text-sm font-medium text-white">Все артикулы ({products.length})</span>
          </label>

          {/* Individual articles */}
          {sorted.map((p) => {
            const orders = orderCounts.get(p.articleWB) || 0;
            const checked = selected.has(p.articleWB);
            const customName = overrides[p.articleWB]?.customName?.trim() || "";
            return (
              <label
                key={p.articleWB}
                className={`grid grid-cols-[auto_minmax(74px,96px)_minmax(0,1fr)_minmax(0,1.2fr)_56px] items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--bg-card-hover)] ${
                  checked ? "" : "opacity-50"
                }`}
                title={`${p.articleWB} — ${customName ? `${customName} — ` : ""}${p.name}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.articleWB)}
                  className="accent-[var(--accent)] w-4 h-4 shrink-0 mt-1"
                />
                <span className="font-mono text-sm text-[var(--accent)] break-all">{p.articleWB}</span>
                <div className="min-w-0">
                  {customName ? (
                    <span className="block text-sm font-medium text-white whitespace-normal break-words">{customName}</span>
                  ) : (
                    <span className="block text-sm text-[var(--text-muted)]">—</span>
                  )}
                </div>
                <span className="text-sm text-[var(--text)] whitespace-normal break-words">{p.name}</span>
                <span className="text-xs text-[var(--text-muted)] text-right pt-0.5">{orders} зак.</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
