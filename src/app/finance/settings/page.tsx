"use client";

import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
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
  realSizeCount: number;
  withCost: number;
  withoutCost: number;
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

interface CogsHistoryRow {
  barcode: string;
  cost: number;
  valid_from: string;
  valid_to: string | null;
  created_at: string | null;
}

function hasCost(row: RowData): boolean {
  return row.cost !== null && row.cost > 0;
}

function todayInputValue(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "сейчас";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getGroupKey(row: RowData): string {
  return row.nm_id > 0 ? `nm:${row.nm_id}` : `barcode:${row.barcode}`;
}

function isRealSizeName(sizeName: string): boolean {
  const normalized = sizeName.trim().toLowerCase();
  return Boolean(normalized && normalized !== "-" && normalized !== "—" && normalized !== "–" && normalized !== "нет" && normalized !== "без размера");
}

function compareSizeRows(a: RowData, b: RowData): number {
  const aReal = isRealSizeName(a.ts_name);
  const bReal = isRealSizeName(b.ts_name);
  if (aReal !== bReal) return aReal ? -1 : 1;

  const size = a.ts_name.localeCompare(b.ts_name, "ru", { numeric: true });
  if (size !== 0) return size;
  return a.barcode.localeCompare(b.barcode, "ru");
}

function countRealSizes(groupRows: RowData[]): number {
  return new Set(groupRows.map((row) => row.ts_name.trim()).filter(isRealSizeName)).size;
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
    const sortedRows = [...groupRows].sort(compareSizeRows);
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
      realSizeCount: countRealSizes(sortedRows),
      withCost,
      withoutCost: total - withCost,
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
  const [costHistory, setCostHistory] = useState<CogsHistoryRow[] | null>(null);
  const [costHistoryLoading, setCostHistoryLoading] = useState(false);
  const [costHistoryError, setCostHistoryError] = useState<string | null>(null);
  const [showCostHistory, setShowCostHistory] = useState(false);
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
    setCostHistory(null);
    setCostHistoryError(null);
    setCostHistoryLoading(false);
    setShowCostHistory(false);
    setCostEdit({
      row,
      value: row.cost !== null ? String(row.cost) : "",
      mode: hasCost(row) ? "today" : "first_sale",
      date: todayInputValue(),
      saving: false,
      error: null,
    });
  }

  async function loadCostHistory(barcode: string) {
    setShowCostHistory(true);
    setCostHistoryLoading(true);
    setCostHistoryError(null);

    try {
      const resp = await fetch(`/api/finance/cogs?history=true&barcode=${encodeURIComponent(barcode)}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = await resp.json() as CogsHistoryRow[];
      setCostHistory(rows);
    } catch {
      setCostHistoryError("Не удалось загрузить историю себестоимости.");
    } finally {
      setCostHistoryLoading(false);
    }
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
    if (costEdit.mode === "custom" && costEdit.date > todayInputValue()) {
      setCostEdit((prev) => prev ? { ...prev, error: "Дата не может быть позже сегодняшнего дня." } : prev);
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
        realSizeCount: countRealSizes(matchedRows),
        withCost,
        withoutCost: matchedRows.length - withCost,
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
  const totalArticles = articleGroups.length;
  const withoutCost = rows.filter((row) => !hasCost(row)).length;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <div className="flex flex-col items-end gap-2">
          <div className="grid grid-cols-3 gap-2 text-right text-sm">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
              <div className="text-xs text-[var(--text-muted)]">Баркодов</div>
              <div className="font-semibold">{formatNumber(total)}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
              <div className="text-xs text-[var(--text-muted)]">Товаров</div>
              <div className="font-semibold">{formatNumber(totalArticles)}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
              <div className="text-xs text-[var(--text-muted)]">Без цены</div>
              <div className={cn("font-semibold", withoutCost > 0 ? "text-[var(--danger)]" : "text-[var(--success)]")}>{formatNumber(withoutCost)}</div>
            </div>
          </div>
          <button
            onClick={() => setShowBulkImport(!showBulkImport)}
            className="w-fit px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text)] transition-colors"
          >
            📥 Загрузить из файла
          </button>
        </div>
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
              <col className="w-[14%]" />
              <col className="w-[30%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[17%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Артикул продавца</th>
                <th className="text-center">Размер</th>
                <th className="text-center">Баркод</th>
                <th className="text-center">Себестоимость</th>
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
                      <td className="text-center tabular-nums">{formatNumber(group.realSizeCount)}</td>
                      <td className="text-center tabular-nums">{formatNumber(group.total)}</td>
                      <td className={cn("text-center tabular-nums", hasMissingCost ? "text-[var(--danger)]" : "text-[var(--success)]")}>
                        {formatNumber(group.withoutCost)}
                      </td>
                      <td className="text-center text-base">
                        {hasMissingCost ? "🔴" : "✅"}
                      </td>
                    </tr>

                    {isExpanded && (
                      <>
                        {group.rows.map((row, rowIndex) => {
                          const rowHasCost = hasCost(row);
                          return (
                            <tr
                              key={`${group.key}:${row.barcode}`}
                              className={cn(
                                "bg-[var(--bg)]/45 text-sm",
                                rowIndex === 0 && "[&>td]:border-t [&>td]:border-t-[var(--border)]",
                                !rowHasCost && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                              )}
                            >
                              <td aria-hidden="true" />
                              <td aria-hidden="true" />
                              <td className="text-center text-[var(--text)]">
                                <span className="inline-block min-w-10 text-left">{row.ts_name || "—"}</span>
                              </td>
                              <td className="text-center font-mono text-[var(--text-muted)]">
                                {row.barcode}
                              </td>
                              <td className="text-center tabular-nums">
                                <button
                                  type="button"
                                  onClick={() => openCostEdit(row)}
                                  className={cn(
                                    "inline-flex min-w-[104px] cursor-pointer justify-center rounded-md border px-2.5 py-1 text-sm tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50",
                                    rowHasCost
                                      ? "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-white"
                                      : "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)] italic hover:border-[var(--danger)] hover:bg-[var(--danger)]/20"
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
          <span>Товаров: <strong className="text-[var(--text)]">{formatNumber(totalArticles)}</strong></span>
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
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-[var(--text)]">
                  Себестоимость баркода
                </h3>
                <p className="font-mono text-sm text-[var(--text-muted)]">
                  {costEdit.row.barcode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadCostHistory(costEdit.row.barcode)}
                disabled={costEdit.saving || costHistoryLoading}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
              >
                {costHistoryLoading ? "Загрузка…" : "История"}
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {showCostHistory && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="mb-2 text-sm font-medium text-[var(--text-muted)]">
                    История изменения себестоимости
                  </div>
                  {costHistoryError && (
                    <p className="text-sm text-[var(--danger)]">{costHistoryError}</p>
                  )}
                  {!costHistoryError && costHistoryLoading && (
                    <p className="text-sm text-[var(--text-muted)]">Загрузка истории…</p>
                  )}
                  {!costHistoryError && !costHistoryLoading && costHistory?.length === 0 && (
                    <p className="text-sm text-[var(--text-muted)]">История пока пустая.</p>
                  )}
                  {!costHistoryError && !costHistoryLoading && costHistory && costHistory.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[460px] border-collapse text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                            <th className="border-b border-[var(--border)] px-2 py-2 text-left">С даты</th>
                            <th className="border-b border-[var(--border)] px-2 py-2 text-left">По дату</th>
                            <th className="border-b border-[var(--border)] px-2 py-2 text-right">Себестоимость</th>
                            <th className="border-b border-[var(--border)] px-2 py-2 text-left">Создано</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costHistory.map((row) => (
                            <tr key={`${row.barcode}:${row.valid_from}:${row.valid_to || ""}:${row.created_at || ""}`}>
                              <td className="border-b border-[var(--border)]/70 px-2 py-2">{formatDate(row.valid_from)}</td>
                              <td className="border-b border-[var(--border)]/70 px-2 py-2">{formatDate(row.valid_to)}</td>
                              <td className="border-b border-[var(--border)]/70 px-2 py-2 text-right tabular-nums">{RUB(row.cost)}</td>
                              <td className="border-b border-[var(--border)]/70 px-2 py-2">{formatDateTime(row.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

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
                      max={todayInputValue()}
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
