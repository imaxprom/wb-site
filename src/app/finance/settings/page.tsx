"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { StatCard } from "@/components/StatCard";
import { formatNumber, cn } from "@/lib/utils";


interface BarcodeItem {
  barcode: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
  quantity: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const RUB = (v: number) =>
  formatNumber(v, v % 1 !== 0 ? 2 : 0) + " ₽";

interface RowData extends BarcodeItem {
  cost: number | null;
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function CogsSettingsPage() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [cogs, setCogs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Load data on mount
  useEffect(() => {
    async function loadAll() {
      setLoading(true);

      // 1. Load cogs from API (SQLite)
      let storedCogs: Record<string, number> = {};
      try {
        const resp = await fetch("/api/finance/cogs");
        if (resp.ok) {
          const rows = await resp.json() as { barcode: string; cost: number }[];
          for (const r of rows) storedCogs[r.barcode] = r.cost;
        }
      } catch { /* ignore */ }

      setCogs(storedCogs);

      // 2. Load barcode list from API (SQLite)
      let barcodes: BarcodeItem[] = [];
      try {
        const resp = await fetch("/api/finance/barcodes");
        if (resp.ok) {
          barcodes = await resp.json();
        }
      } catch { /* ignore */ }

      // 4. If no barcodes from API — build from cogs keys
      if (barcodes.length === 0) {
        barcodes = Object.keys(storedCogs).map((barcode) => ({
          barcode,
          nm_id: 0,
          sa_name: "",
          ts_name: "",
          quantity: 0,
        }));
      }

      // 5. Merge
      const merged: RowData[] = barcodes.map((b) => ({
        ...b,
        cost: storedCogs[b.barcode] ?? null,
      }));

      // Sort: no cost first, then by sa_name, ts_name
      merged.sort((a, b) => {
        if ((a.cost === null) !== (b.cost === null)) {
          return a.cost === null ? -1 : 1;
        }
        const sa = a.sa_name.localeCompare(b.sa_name, "ru");
        if (sa !== 0) return sa;
        return a.ts_name.localeCompare(b.ts_name, "ru");
      });

      setRows(merged);
      setLoading(false);
    }

    loadAll();
  }, []);

  // Persist cogs whenever they change
  const persistCogs = useCallback(async (updated: Record<string, number>) => {
    try {
      await fetch("/api/finance/cogs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch { /* ignore */ }
  }, []);

  // Update cost for a barcode
  function applyCost(barcode: string, value: number | null) {
    const newCogs = { ...cogs };

    if (value === null || isNaN(value)) {
      delete newCogs[barcode];
    } else {
      newCogs[barcode] = value;
    }

    setCogs(newCogs);
    persistCogs(newCogs);

    setRows((prev) =>
      prev.map((r) =>
        r.barcode === barcode ? { ...r, cost: value } : r
      )
    );
  }

  // Inline edit handlers
  function startEdit(barcode: string, current: number | null) {
    setEditingBarcode(barcode);
    setEditValue(current !== null ? String(current) : "");
    setTimeout(() => editRef.current?.focus(), 30);
  }

  function commitEdit(barcode: string) {
    const num = parseFloat(editValue);
    applyCost(barcode, isNaN(num) ? null : num);
    setEditingBarcode(null);
  }

  // Bulk import handler
  function applyBulkImport() {
    const lines = bulkText
      .split(/[\n\r]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    let imported = 0;
    let errors = 0;
    const newCogs = { ...cogs };

    for (const line of lines) {
      const parts = line.split(/[\s,;]+/);
      if (parts.length < 2) { errors++; continue; }
      const barcode = parts[0];
      const cost = parseFloat(parts[1]);
      if (!barcode || isNaN(cost)) { errors++; continue; }
      newCogs[barcode] = cost;
      imported++;
    }

    setCogs(newCogs);
    persistCogs(newCogs);

    // Merge into rows
    setRows((prev) => {
      const updated = prev.map((r) => ({
        ...r,
        cost: newCogs[r.barcode] ?? r.cost,
      }));

      // Re-sort
      updated.sort((a, b) => {
        if ((a.cost === null) !== (b.cost === null)) {
          return a.cost === null ? -1 : 1;
        }
        const sa = a.sa_name.localeCompare(b.sa_name, "ru");
        if (sa !== 0) return sa;
        return a.ts_name.localeCompare(b.ts_name, "ru");
      });

      return updated;
    });

    setBulkResult(`✅ Импортировано: ${imported} | Ошибок: ${errors}`);
    setBulkText("");
  }

  // Filtered rows
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.barcode.includes(q) ||
        r.sa_name.toLowerCase().includes(q) ||
        r.ts_name.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Stats
  const total = rows.length;
  const withCost = rows.filter((r) => r.cost !== null && r.cost > 0).length;
  const withoutCost = total - withCost;
  const coverage = total > 0 ? (withCost / total) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">
        Загрузка себестоимостей…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/finance"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              ← Финансы
            </Link>
          </div>
          <h2 className="text-2xl font-bold mt-1">Себестоимость</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Управление себестоимостью по баркодам
          </p>
        </div>
        <button
          onClick={() => setShowBulkImport(!showBulkImport)}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text)] transition-colors"
        >
          📥 Загрузить из файла
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Всего баркодов"
          value={formatNumber(total) + " шт"}
          color="default"
        />
        <StatCard
          title="Без себестоимости"
          value={formatNumber(withoutCost) + " шт"}
          color={withoutCost === 0 ? "success" : withoutCost < total * 0.2 ? "warning" : "danger"}
        />
        <StatCard
          title="Покрытие"
          value={coverage.toFixed(1) + "%"}
          subtitle={`${withCost} из ${total} баркодов`}
          color={coverage >= 90 ? "success" : coverage >= 50 ? "warning" : "danger"}
        />
      </div>

      {/* Bulk import panel */}
      {showBulkImport && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 space-y-3">
          <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Массовый импорт
          </h3>
          <p className="text-sm text-[var(--text-muted)]">
            Формат: по одной строке — <code className="bg-[var(--bg)] px-1 rounded">баркод цена</code> (разделитель: пробел, запятая или точка с запятой)
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"10165718462 330\n10329737328 245\n..."}
            rows={8}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:border-[var(--accent)] focus:outline-none resize-y"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={applyBulkImport}
              disabled={!bulkText.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              Применить
            </button>
            {bulkResult && (
              <span className="text-sm text-[var(--text-muted)]">{bulkResult}</span>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">
          🔍
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по артикулу или баркоду…"
          className="w-full pl-9 pr-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Баркод</th>
                <th>Размер</th>
                <th className="num">Себестоимость</th>
                <th className="text-center">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const hasCost = row.cost !== null && row.cost > 0;
                const isEditing = editingBarcode === row.barcode;

                return (
                  <tr
                    key={row.barcode}
                    className={cn(
                      !hasCost && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                    )}
                  >
                    <td className="font-mono text-[var(--accent)]">
                      {row.sa_name || "—"}
                    </td>
                    <td className="font-mono text-sm text-[var(--text-muted)]">
                      {row.barcode}
                    </td>
                    <td className="text-base">{row.ts_name || "—"}</td>
                    <td className="num">
                      {isEditing ? (
                        <input
                          ref={editRef}
                          type="number"
                          min="0"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(row.barcode)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(row.barcode);
                            if (e.key === "Escape") setEditingBarcode(null);
                          }}
                          className="w-28 bg-[var(--bg)] border border-[var(--accent)] rounded px-2 py-1 text-sm text-right focus:outline-none"
                        />
                      ) : (
                        <span
                          onClick={() => startEdit(row.barcode, row.cost)}
                          className={cn(
                            "cursor-pointer rounded px-2 py-0.5 hover:bg-[var(--bg-card-hover)] transition-colors",
                            hasCost ? "text-[var(--text)]" : "text-[var(--danger)] italic"
                          )}
                          title="Нажмите для редактирования"
                        >
                          {hasCost ? RUB(row.cost!) : "не задана"}
                        </span>
                      )}
                    </td>
                    <td className="text-center text-base">
                      {hasCost ? "✅" : "🔴"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-[var(--text-muted)]">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-4 text-base text-[var(--text-muted)]">
          <span>Всего: <strong className="text-[var(--text)]">{formatNumber(total)}</strong> баркодов</span>
          <span>|</span>
          <span>Без себестоимости: <strong className={withoutCost > 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}>{formatNumber(withoutCost)}</strong></span>
          <span>|</span>
          <span>Покрытие: <strong className={coverage >= 90 ? "text-[var(--success)]" : coverage >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}>{coverage.toFixed(1)}%</strong></span>
          {search && <span>| Показано: <strong className="text-[var(--text)]">{formatNumber(filtered.length)}</strong></span>}
        </div>
      </div>
    </div>
  );
}
