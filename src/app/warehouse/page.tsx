"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Boxes, Database, RefreshCw, Search, Sheet, TrendingUp, Warehouse } from "lucide-react";

interface WarehouseSizeRow {
  article_wb: string;
  sheet_name: string;
  size_label: string;
  size_range: string;
  barcode: string | null;
  barcode_match_status: "matched" | "warning" | "missing";
  barcode_match_reason: string;
  packing_days: number;
  packing_multiplier: number;
  base_orders_qty: number;
  base_sales_qty: number;
  buyout_rate: number;
  trend_multiplier: number;
  trend_direction: "up" | "down" | "flat";
  target_sales_qty: number;
  target_sales_45d: number;
  wb_stock_qty: number;
  warehouse_required_units: number;
  plan_pack_units: number;
  plan_pack_boxes: number | null;
  per_box: number | null;
  filled_cells: number;
  units_qty: number;
  boxes_qty: number | null;
  synced_at: string;
}

interface WarehouseArticle {
  articleWB: string;
  sheetName: string;
  unitsQty: number;
  boxesQty: number;
  sizes: WarehouseSizeRow[];
}

interface WarehouseResponse {
  meta: {
    ready: boolean;
    totalRows: number;
    totalArticles: number;
    totalUnits: number;
    totalBoxes: number;
    overallTrend?: {
      multiplier: number;
      direction: "up" | "down" | "flat";
      totalOrders: number;
    };
    lastRun: {
      id: number;
      spreadsheet_title: string | null;
      status: string;
      finished_at: string | null;
      sheets_count: number;
      rows_count: number;
      total_units: number;
      total_boxes: number;
      message: string | null;
    } | null;
  };
  rows: WarehouseSizeRow[];
  articles: WarehouseArticle[];
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function packingPlanTitle(row: WarehouseSizeRow) {
  return [
    `Заказы ${row.packing_days || 30} дней: ${formatNumber(row.base_orders_qty ?? row.base_sales_qty ?? row.target_sales_qty ?? row.target_sales_45d)}`,
    `% выкупа: ${formatNumber((row.buyout_rate ?? 1) * 100, 1)}%`,
    `Потребность до тренда: ${formatNumber(row.base_sales_qty ?? row.target_sales_qty ?? row.target_sales_45d)}`,
    `Коэффициент отгрузки: x${formatNumber(row.trend_multiplier ?? 1, 2)}`,
    `Коэффициент упаковки: x${formatNumber(row.packing_multiplier ?? 1, 2)}`,
    `Цель с коэффициентом: ${formatNumber(row.target_sales_qty ?? row.target_sales_45d)}`,
    `Остаток WB: ${formatNumber(row.wb_stock_qty)}`,
    `Нужно держать на складе: ${formatNumber(row.warehouse_required_units)}`,
    `Готово на складе: ${formatNumber(row.units_qty)}`,
  ].join("\n");
}

function sizeKey(row: WarehouseSizeRow) {
  return `${row.size_label}_${row.size_range}`;
}

function sortSizeRows(rows: WarehouseSizeRow[]) {
  return [...rows].sort((a, b) => {
    const range = a.size_range.localeCompare(b.size_range, "ru");
    if (range !== 0) return range;
    return a.size_label.localeCompare(b.size_label, "ru");
  });
}

function trendLabel(direction: WarehouseSizeRow["trend_direction"] | undefined) {
  if (direction === "up") return "растущий";
  if (direction === "down") return "снижается";
  return "стабильный";
}

function articleTrend(article: WarehouseArticle | undefined) {
  return article?.sizes.find((size) => Number.isFinite(size.trend_multiplier));
}

function SizeTable({ sizes }: { sizes: WarehouseSizeRow[] }) {
  const sortedSizes = sortSizeRows(sizes);
  const totalUnits = sizes.reduce((sum, size) => sum + Number(size.units_qty || 0), 0);
  const totalBoxes = sizes.reduce((sum, size) => sum + Number(size.boxes_qty || 0), 0);
  const totalPlanUnits = sizes.reduce((sum, size) => sum + Number(size.plan_pack_units || 0), 0);
  const totalPlanBoxes = sizes.reduce((sum, size) => sum + Number(size.plan_pack_boxes || 0), 0);

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="text-[var(--text-muted)]">
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Размер</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Этикетка</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Штук в коробе</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Баркод</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Штук</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">Коробов</th>
          <th className="border border-[var(--border)] px-2 py-2 text-center font-medium">План упаковки</th>
        </tr>
      </thead>
      <tbody>
        {sortedSizes.map((size) => (
          <tr key={sizeKey(size)}>
            <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums text-white">{size.size_range || "-"}</td>
            <td className="border border-[var(--border)] px-2 py-2 text-center text-white">{size.size_label || "-"}</td>
            <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums">{formatNumber(size.per_box)}</td>
            <td
              className={`border border-[var(--border)] px-2 py-2 text-center font-mono tabular-nums ${size.barcode ? "text-[var(--text-muted)]" : "text-[var(--danger)]"}`}
              title={size.barcode_match_reason}
            >
              {size.barcode || "-"}
            </td>
            <td className="border border-[var(--border)] px-2 py-2 text-center font-semibold tabular-nums">{formatNumber(size.units_qty)}</td>
            <td className="border border-[var(--border)] px-2 py-2 text-center text-[var(--accent)] tabular-nums">{formatNumber(size.boxes_qty, 2)}</td>
            <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums" title={packingPlanTitle(size)}>
              {size.plan_pack_units > 0 ? (
                <div className="grid min-h-[2.25rem] content-center">
                  <div className="font-semibold text-[var(--accent)]">{formatNumber(size.plan_pack_boxes, 2)} кор.</div>
                  <div className="text-[11px] text-white">{formatNumber(size.plan_pack_units)} шт</div>
                </div>
              ) : (
                <div className="grid min-h-[2.25rem] content-center">
                  <div className="font-semibold text-[var(--accent)]">0,00 кор.</div>
                  <div className="text-[11px] text-white">0 шт</div>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-[var(--bg)] text-white">
          <td className="border border-[var(--border)] px-2 py-2 text-center text-xs font-semibold uppercase text-[var(--text-muted)]" colSpan={4}>
            Итого
          </td>
          <td className="border border-[var(--border)] px-2 py-2 text-center font-bold tabular-nums">
            {formatNumber(totalUnits)}
          </td>
          <td className="border border-[var(--border)] px-2 py-2 text-center font-bold tabular-nums text-[var(--accent)]">
            {formatNumber(totalBoxes, 2)}
          </td>
          <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums">
            <div className="grid min-h-[2.25rem] content-center">
              <div className="font-bold text-[var(--accent)]">{formatNumber(totalPlanBoxes, 2)} кор.</div>
              <div className="text-[11px] font-semibold text-white">{formatNumber(totalPlanUnits)} шт</div>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

const PACKING_MULTIPLIER_OPTIONS = [1, 1.25, 1.5, 2] as const;

export default function WarehousePage() {
  const [data, setData] = useState<WarehouseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingPackingMultiplier, setSavingPackingMultiplier] = useState(false);
  const [error, setError] = useState("");
  const [selectedArticle, setSelectedArticle] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [packingMultiplier, setPackingMultiplier] = useState<number>(1);

  const loadWarehouse = useCallback((multiplier: number, cancelled?: () => boolean) => {
    return fetch(`/api/warehouse/stock?packingMultiplier=${multiplier}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: WarehouseResponse) => {
        if (cancelled?.()) return;
        setData(payload);
        setError("");
      })
      .catch((err) => {
        if (cancelled?.()) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить склад");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((settings: { warehousePackingMultiplier?: number }) => {
        if (cancelled) return;
        const savedMultiplier = PACKING_MULTIPLIER_OPTIONS.includes(settings.warehousePackingMultiplier as typeof PACKING_MULTIPLIER_OPTIONS[number])
          ? Number(settings.warehousePackingMultiplier)
          : 1;
        setPackingMultiplier(savedMultiplier);
        return loadWarehouse(savedMultiplier, () => cancelled);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить настройки склада");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadWarehouse]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/warehouse/sync", { method: "POST" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      await loadWarehouse(packingMultiplier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить склад");
    } finally {
      setSyncing(false);
    }
  }, [loadWarehouse, packingMultiplier]);

  const handlePackingMultiplierChange = useCallback(async (multiplier: number) => {
    setPackingMultiplier(multiplier);
    setSavingPackingMultiplier(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehousePackingMultiplier: multiplier, warehousePackingDays: 30 }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      await loadWarehouse(multiplier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить коэффициент плана упаковки");
    } finally {
      setSavingPackingMultiplier(false);
    }
  }, [loadWarehouse]);

  const visibleArticles = useMemo(() => {
    const articles = data?.articles || [];
    const query = articleQuery.trim().toLowerCase();
    if (!query) return articles;
    return articles.filter((article) => (
      article.articleWB.includes(query) ||
      article.sheetName.toLowerCase().includes(query)
    ));
  }, [articleQuery, data]);
  const currentArticle = visibleArticles.find((article) => article.articleWB === selectedArticle) || visibleArticles[0];
  const meta = data?.meta;

  useEffect(() => {
    if (visibleArticles.length === 0) {
      if (selectedArticle) setSelectedArticle("");
      return;
    }
    if (!visibleArticles.some((article) => article.articleWB === selectedArticle)) {
      setSelectedArticle(visibleArticles[0].articleWB);
    }
  }, [selectedArticle, visibleArticles]);

  const cards = [
    {
      label: "Источник / готово",
      value: meta?.lastRun?.spreadsheet_title || "Google Sheets",
      detail: `${formatNumber(meta?.totalUnits || 0)} шт · ${formatNumber(meta?.totalBoxes || 0, 2)} коробов`,
      icon: Sheet,
    },
    {
      label: "Общий тренд",
      value: `×${formatNumber(meta?.overallTrend?.multiplier ?? 1, 2)}`,
      detail: `${trendLabel(meta?.overallTrend?.direction)} · ${formatNumber(meta?.overallTrend?.totalOrders || 0)} заказов`,
      icon: TrendingUp,
    },
    {
      label: "Настройка плана упаковки",
      value: `×${formatNumber(packingMultiplier, 2)}`,
      detail: "База: 30 дней",
      icon: Boxes,
    },
    {
      label: "Последний импорт",
      value: formatDateTime(meta?.lastRun?.finished_at),
      detail: meta?.lastRun?.finished_at ? "Google Sheets" : "нет данных",
      icon: Database,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Склад</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Готовые короба из Google Sheets
          </p>
        </div>
        {loading && (
          <div className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
            Загрузка
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {card.label}
              </span>
              <card.icon size={18} className="text-[var(--accent)]" />
            </div>
            <div className="mt-3 truncate text-xl font-semibold text-white">{card.value}</div>
            <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{card.detail}</div>
            {card.label === "Настройка плана упаковки" && (
              <div className="mt-3 grid grid-cols-4 gap-1">
                {PACKING_MULTIPLIER_OPTIONS.map((multiplier) => (
                  <button
                    key={multiplier}
                    type="button"
                    onClick={() => handlePackingMultiplierChange(multiplier)}
                    disabled={savingPackingMultiplier || packingMultiplier === multiplier}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-default ${packingMultiplier === multiplier ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-white"}`}
                  >
                    ×{formatNumber(multiplier, 2)}
                  </button>
                ))}
              </div>
            )}
            {card.label === "Последний импорт" && (
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Обновление" : "Обновить"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Готовые короба по артикулам</h3>
          <span className="text-xs text-[var(--text-muted)]">
            {articleQuery.trim()
              ? `${formatNumber(visibleArticles.length)} из ${formatNumber(data?.articles.length || 0)} артикулов`
              : `${formatNumber(data?.articles.length || 0)} артикулов`}
          </span>
        </div>

        {!loading && (data?.articles.length || 0) === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--accent)]">
              <Warehouse size={24} />
            </div>
            <div className="mt-4 text-base font-medium text-white">Данных склада пока нет</div>
            <div className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">
              Запусти локальный импорт `node scripts/warehouse-google-sync.js`, чтобы заполнить SQLite.
            </div>
          </div>
        ) : (data?.articles.length || 0) > 0 ? (
          <div className="grid min-h-[520px] border-t border-[var(--border)] lg:grid-cols-[320px_1fr]">
            <div className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
              <div className="border-b border-[var(--border)] p-3">
                <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                  <Search size={16} className="text-[var(--text-muted)]" />
                  <input
                    value={articleQuery}
                    onChange={(event) => setArticleQuery(event.target.value)}
                    placeholder="Артикул или название"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>
              <div className="max-h-[610px] overflow-auto">
                {visibleArticles.map((article) => {
                  const active = article.articleWB === currentArticle?.articleWB;
                  const trend = articleTrend(article);
                  return (
                    <button
                      key={article.articleWB}
                      type="button"
                      onClick={() => setSelectedArticle(article.articleWB)}
                      className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${active ? "bg-[var(--accent)]/15" : "hover:bg-[var(--bg-card-hover)]"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-[var(--accent)]">{article.articleWB}</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-[var(--accent)]" title={`Тренд: ${trendLabel(trend?.trend_direction)}`}>
                          ×{formatNumber(trend?.trend_multiplier ?? 1, 2)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{article.sheetName}</div>
                    </button>
                  );
                })}
                {visibleArticles.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                    Поиск ничего не нашёл
                  </div>
                )}
              </div>
            </div>
            <div className="p-4">
              {currentArticle ? (
                <>
                  <div className="mb-3 text-sm font-medium text-white">{currentArticle.sheetName}</div>
                  <div className="overflow-auto">
                    <SizeTable sizes={currentArticle.sizes} />
                  </div>
                </>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center text-center text-sm text-[var(--text-muted)]">
                  Поиск ничего не нашёл
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-[var(--text-muted)]">Нет артикулов для отображения</div>
        )}
      </div>
    </div>
  );
}
