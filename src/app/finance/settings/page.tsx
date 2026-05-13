"use client";

import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
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

interface ArticleGroup {
  key: string;
  nm_id: number;
  sellerArticle: string;
  sellerArticles: string[];
  rows: RowData[];
  total: number;
  withCost: number;
  withoutCost: number;
  coverage: number;
}

type CostApplyMode = "today" | "first_sale" | "custom";

interface CostEditState {
  row: RowData;
  value: string;
  mode: CostApplyMode;
  date: string;
  saving: boolean;
  error: string | null;
}

function hasCost(row: RowData): boolean {
  return row.cost !== null && row.cost > 0;
}

function todayInputValue(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function getGroupKey(row: RowData): string {
  return row.nm_id > 0 ? `nm:${row.nm_id}` : `barcode:${row.barcode}`;
}

function rowMatches(row: RowData, query: string): boolean {
  return (
    row.barcode.includes(query) ||
    String(row.nm_id).includes(query) ||
    row.sa_name.toLowerCase().includes(query) ||
    row.ts_name.toLowerCase().includes(query)
  );
}

function buildArticleGroups(sourceRows: RowData[]): ArticleGroup[] {
  const groups = new Map<string, RowData[]>();

  for (const row of sourceRows) {
    const key = getGroupKey(row);
    const groupRows = groups.get(key) || [];
    groupRows.push(row);
    groups.set(key, groupRows);
  }

  return Array.from(groups.entries()).map(([key, groupRows]) => {
    const sortedRows = [...groupRows].sort((a, b) => {
      const size = a.ts_name.localeCompare(b.ts_name, "ru");
      if (size !== 0) return size;
      return a.barcode.localeCompare(b.barcode, "ru");
    });
    const sellerArticles = Array.from(
      new Set(sortedRows.map((row) => row.sa_name).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "ru"));
    const withCost = sortedRows.filter(hasCost).length;
    const total = sortedRows.length;

    return {
      key,
      nm_id: sortedRows[0]?.nm_id || 0,
      sellerArticle: sellerArticles[0] || "",
      sellerArticles,
      rows: sortedRows,
      total,
      withCost,
      withoutCost: total - withCost,
      coverage: total > 0 ? (withCost / total) * 100 : 0,
    };
  }).sort((a, b) => {
    if ((a.withoutCost > 0) !== (b.withoutCost > 0)) {
      return a.withoutCost > 0 ? -1 : 1;
    }
    if (a.nm_id !== b.nm_id) return a.nm_id - b.nm_id;
    return a.sellerArticle.localeCompare(b.sellerArticle, "ru");
  });
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
export default function CogsSettingsPage() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [cogs, setCogs] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [costEdit, setCostEdit] = useState<CostEditState | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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

      // Sort: no cost first, then by stable WB article and seller article.
      merged.sort((a, b) => {
        if ((a.cost === null) !== (b.cost === null)) {
          return a.cost === null ? -1 : 1;
        }
        const nm = a.nm_id - b.nm_id;
        if (nm !== 0) return nm;
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

  function openCostEdit(row: RowData) {
    setCostEdit({
      row,
      value: row.cost !== null ? String(row.cost) : "",
      mode: hasCost(row) ? "today" : "first_sale",
      date: todayInputValue(),
      saving: false,
      error: null,
    });
  }

  async function saveCostEdit() {
    if (!costEdit) return;

    const rawValue = costEdit.value.trim().replace(",", ".");
    const value = rawValue === "" ? null : Number(rawValue);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setCostEdit((prev) => prev ? { ...prev, error: "Укажите корректную себестоимость от 0 и выше." } : prev);
      return;
    }
    if (costEdit.mode === "custom" && !costEdit.date) {
      setCostEdit((prev) => prev ? { ...prev, error: "Выберите дату, с которой применять себестоимость." } : prev);
      return;
    }

    setCostEdit((prev) => prev ? { ...prev, saving: true, error: null } : prev);

    try {
      const resp = await fetch("/api/finance/cogs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: costEdit.row.barcode,
          cost: value,
          applyMode: costEdit.mode,
          validFrom: costEdit.mode === "custom" ? costEdit.date : undefined,
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      setCogs((prev) => {
        const next = { ...prev };
        if (value === null) {
          delete next[costEdit.row.barcode];
        } else {
          next[costEdit.row.barcode] = value;
        }
        return next;
      });
      setRows((prev) =>
        prev.map((row) =>
          row.barcode === costEdit.row.barcode ? { ...row, cost: value } : row
        )
      );
      setCostEdit(null);
    } catch {
      setCostEdit((prev) => prev ? {
        ...prev,
        saving: false,
        error: "Не удалось сохранить себестоимость. Проверьте подключение и попробуйте ещё раз.",
      } : prev);
    }
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
        const nm = a.nm_id - b.nm_id;
        if (nm !== 0) return nm;
        const sa = a.sa_name.localeCompare(b.sa_name, "ru");
        if (sa !== 0) return sa;
        return a.ts_name.localeCompare(b.ts_name, "ru");
      });

      return updated;
    });

    setBulkResult(`✅ Импортировано: ${imported} | Ошибок: ${errors}`);
    setBulkText("");
  }

  const articleGroups = useMemo(() => buildArticleGroups(rows), [rows]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articleGroups;

    return articleGroups.flatMap((group) => {
      const groupMatches =
        String(group.nm_id).includes(q) ||
        group.sellerArticles.some((article) => article.toLowerCase().includes(q));

      if (groupMatches) return [group];

      const matchedRows = group.rows.filter((row) => rowMatches(row, q));
      if (matchedRows.length === 0) return [];

      const withCost = matchedRows.filter(hasCost).length;
      return [{
        ...group,
        rows: matchedRows,
        total: matchedRows.length,
        withCost,
        withoutCost: matchedRows.length - withCost,
        coverage: matchedRows.length > 0 ? (withCost / matchedRows.length) * 100 : 0,
      }];
    });
  }, [articleGroups, search]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Stats
  const total = rows.length;
  const withCost = rows.filter(hasCost).length;
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
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по NM ID, артикулу продавца, баркоду или размеру…"
          className="w-full pl-9 pr-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="data-table-wrapper">
          <table className="data-table table-fixed">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[34%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Артикул продавца</th>
                <th className="num">Баркоды</th>
                <th className="num">Без себестоимости</th>
                <th className="num">Покрытие</th>
                <th className="text-center">Статус</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((group) => {
                const isExpanded = search.trim() ? true : expandedGroups.has(group.key);
                const hasMissingCost = group.withoutCost > 0;

                return (
                  <Fragment key={group.key}>
                    <tr
                      key={group.key}
                      className={cn(
                        "cursor-pointer",
                        hasMissingCost && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                      )}
                      onClick={() => toggleGroup(group.key)}
                    >
                      <td className="font-mono text-sm text-[var(--text)]">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 text-left"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronDown size={16} className="text-[var(--text-muted)]" />
                          ) : (
                            <ChevronRight size={16} className="text-[var(--text-muted)]" />
                          )}
                          <span>{group.nm_id || "—"}</span>
                        </button>
                      </td>
                      <td className="font-mono text-[var(--accent)]">
                        <span title={group.sellerArticles.join(", ")}>
                          {group.sellerArticle || "—"}
                          {group.sellerArticles.length > 1 && (
                            <span className="ml-2 text-xs text-[var(--text-muted)]">
                              +{group.sellerArticles.length - 1}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="num">{formatNumber(group.total)}</td>
                      <td className={cn(hasMissingCost ? "text-[var(--danger)]" : "text-[var(--success)]")}>
                        {formatNumber(group.withoutCost)}
                      </td>
                      <td className="num">{group.coverage.toFixed(1)}%</td>
                      <td className="text-center text-base">
                        {hasMissingCost ? "🔴" : "✅"}
                      </td>
                    </tr>

                    {isExpanded && (
                      <>
                        <tr className="bg-[var(--bg)]/70">
                          <td
                            colSpan={2}
                            className="pl-12 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                          >
                            Баркод
                          </td>
                          <td className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Размер
                          </td>
                          <td
                            colSpan={2}
                            className="num text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                          >
                            Себестоимость
                          </td>
                          <td className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Статус
                          </td>
                        </tr>

                        {group.rows.map((row) => {
                          const rowHasCost = hasCost(row);
                          return (
                            <tr
                              key={`${group.key}:${row.barcode}`}
                              className={cn(
                                "bg-[var(--bg)]/40 text-sm",
                                !rowHasCost && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                              )}
                            >
                              <td
                                colSpan={2}
                                className="pl-12 font-mono text-[var(--text-muted)]"
                              >
                                {row.barcode}
                              </td>
                              <td className="text-[var(--text)]">
                                {row.ts_name || "—"}
                              </td>
                              <td colSpan={2} className="num tabular-nums">
                                <button
                                  type="button"
                                  onClick={() => openCostEdit(row)}
                                  className={cn(
                                    "rounded px-2 py-0.5 text-right tabular-nums hover:bg-[var(--bg-card-hover)] transition-colors",
                                    rowHasCost ? "text-[var(--text)]" : "text-[var(--danger)] italic"
                                  )}
                                  title="Нажмите для редактирования"
                                >
                                  {rowHasCost ? RUB(row.cost!) : "не задана"}
                                </button>
                              </td>
                              <td className="text-center text-base">
                                {rowHasCost ? "✅" : "🔴"}
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </Fragment>
                );
              })}
              {visibleGroups.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-[var(--text-muted)]">
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
          <span>|</span>
          <span>Артикулов: <strong className="text-[var(--text)]">{formatNumber(articleGroups.length)}</strong></span>
          {search && <span>| Показано групп: <strong className="text-[var(--text)]">{formatNumber(visibleGroups.length)}</strong></span>}
        </div>
      </div>

      {costEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
          onClick={() => !costEdit.saving && setCostEdit(null)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-[var(--text)]">
                Себестоимость баркода
              </h3>
              <p className="font-mono text-sm text-[var(--text-muted)]">
                {costEdit.row.barcode}
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-[var(--text-muted)]">
                  Себестоимость
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costEdit.value}
                  onChange={(e) => setCostEdit((prev) => prev ? { ...prev, value: e.target.value, error: null } : prev)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                  placeholder="Например, 330"
                  autoFocus
                />
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  Если оставить поле пустым, себестоимость будет снята.
                </span>
              </label>

              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--text-muted)]">
                  С какой даты применять
                </p>

                <label className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="apply-mode"
                    checked={costEdit.mode === "today"}
                    onChange={() => setCostEdit((prev) => prev ? { ...prev, mode: "today", error: null } : prev)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-[var(--text)]">
                      С сегодняшнего дня
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      Новая себестоимость применяется только к продажам с сегодняшней даты. Прошлые дни остаются по прежней истории.
                    </span>
                  </span>
                </label>

                <label className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="apply-mode"
                    checked={costEdit.mode === "first_sale"}
                    onChange={() => setCostEdit((prev) => prev ? { ...prev, mode: "first_sale", error: null } : prev)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-[var(--text)]">
                      С даты первой продажи
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      Себестоимость применяется с первой продажи этого баркода. Подходит, если товар продавался раньше, а себестоимость внесли позже.
                    </span>
                  </span>
                </label>

                <label className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="apply-mode"
                    checked={costEdit.mode === "custom"}
                    onChange={() => setCostEdit((prev) => prev ? { ...prev, mode: "custom", error: null } : prev)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-[var(--text)]">
                      С выбранной даты
                    </span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      Себестоимость применяется начиная с указанного дня. Всё до этой даты не меняется.
                    </span>
                    <input
                      type="date"
                      value={costEdit.date}
                      disabled={costEdit.mode !== "custom"}
                      onChange={(e) => setCostEdit((prev) => prev ? { ...prev, date: e.target.value, error: null } : prev)}
                      className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
                    />
                  </span>
                </label>
              </div>

              {costEdit.error && (
                <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                  {costEdit.error}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCostEdit(null)}
                disabled={costEdit.saving}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={saveCostEdit}
                disabled={costEdit.saving}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {costEdit.saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
