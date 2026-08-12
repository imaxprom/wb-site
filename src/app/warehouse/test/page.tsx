"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronsUpDown, Grid3X3, LayoutDashboard, PanelLeft, Rows3, type LucideIcon } from "lucide-react";

interface WarehouseSizeRow {
  article_wb: string;
  sheet_name: string;
  size_label: string;
  size_range: string;
  barcode: string | null;
  barcode_match_status: "matched" | "warning" | "missing";
  barcode_match_reason: string;
  packing_days: number;
  base_orders_qty: number;
  base_sales_qty: number;
  buyout_rate: number;
  trend_multiplier: number;
  trend_direction: "up" | "down" | "flat";
  target_sales_qty: number;
  target_sales_45d: number;
  wb_stock_qty: number;
  wb_stock_total_qty?: number;
  wb_stock_excluded_qty?: number;
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
    totalRows: number;
    totalArticles: number;
    totalUnits: number;
    totalBoxes: number;
    lastRun: {
      finished_at: string | null;
      status: string;
    } | null;
  };
  rows: WarehouseSizeRow[];
  articles: WarehouseArticle[];
}

type VariantKey = "split" | "cards" | "accordion" | "tabs" | "grouped";

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

function sizeKey(row: WarehouseSizeRow) {
  return `${row.size_label}_${row.size_range}`;
}

function sizeTitle(row: WarehouseSizeRow) {
  return `${row.size_range || "-"} ${row.size_label || ""}`.trim();
}

function packingPlanTitle(row: WarehouseSizeRow) {
  return [
    `Заказы ${row.packing_days || 30} дней: ${formatNumber(row.base_orders_qty ?? row.base_sales_qty ?? row.target_sales_qty ?? row.target_sales_45d)}`,
    `% выкупа: ${formatNumber((row.buyout_rate ?? 1) * 100, 1)}%`,
    `Потребность до тренда: ${formatNumber(row.base_sales_qty ?? row.target_sales_qty ?? row.target_sales_45d)}`,
    `Коэффициент отгрузки: x${formatNumber(row.trend_multiplier ?? 1, 2)}`,
    `Цель с коэффициентом: ${formatNumber(row.target_sales_qty ?? row.target_sales_45d)}`,
    `Остаток WB всего: ${formatNumber(row.wb_stock_total_qty ?? row.wb_stock_qty)}`,
    `Исключено по настройке: ${formatNumber(row.wb_stock_excluded_qty ?? 0)}`,
    `Остаток WB в расчёте: ${formatNumber(row.wb_stock_qty)}`,
    `Нужно держать на складе: ${formatNumber(row.warehouse_required_units)}`,
    `Готово на складе: ${formatNumber(row.units_qty)}`,
  ].join("\n");
}

function sortSizeRows(rows: WarehouseSizeRow[]) {
  return [...rows].sort((a, b) => {
    const range = a.size_range.localeCompare(b.size_range, "ru");
    if (range !== 0) return range;
    return a.size_label.localeCompare(b.size_label, "ru");
  });
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function SizeTable({ sizes, compact = false }: { sizes: WarehouseSizeRow[]; compact?: boolean }) {
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
        {sortSizeRows(sizes).map((size) => (
          <tr key={sizeKey(size)} className={compact ? "align-top" : ""}>
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
                  <div className="font-semibold text-white">{formatNumber(size.plan_pack_units)} шт</div>
                  <div className="text-[11px] text-[var(--accent)]">{formatNumber(size.plan_pack_boxes, 2)} кор.</div>
                </div>
              ) : (
                <div className="grid min-h-[2.25rem] content-center">
                  <div className="font-semibold text-[var(--text-muted)]">0 шт</div>
                  <div className="text-[11px] text-[var(--text-muted)]">0,00 кор.</div>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitVariant({ articles }: { articles: WarehouseArticle[] }) {
  const [selected, setSelected] = useState(articles[0]?.articleWB || "");
  const current = articles.find((article) => article.articleWB === selected) || articles[0];

  useEffect(() => {
    if (!selected && articles[0]) setSelected(articles[0].articleWB);
  }, [articles, selected]);

  if (!current) return null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={PanelLeft} title="1. Список слева + таблица справа" />
      <div className="grid min-h-[520px] border-t border-[var(--border)] lg:grid-cols-[320px_1fr]">
        <div className="max-h-[680px] overflow-auto border-b border-[var(--border)] lg:border-b-0 lg:border-r">
          {articles.map((article) => {
            const active = article.articleWB === current.articleWB;
            return (
              <button
                key={article.articleWB}
                type="button"
                onClick={() => setSelected(article.articleWB)}
                className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${active ? "bg-[var(--accent)]/15" : "hover:bg-[var(--bg-card-hover)]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-[var(--accent)]">{article.articleWB}</span>
                  <span className="text-xs font-semibold tabular-nums text-white">{formatNumber(article.boxesQty, 2)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{article.sheetName}</div>
                <div className="mt-2 text-[11px] text-[var(--text-muted)]">{formatNumber(article.unitsQty)} шт · {article.sizes.length} разм.</div>
              </button>
            );
          })}
        </div>
        <div className="p-4">
          <div className="mb-3 text-sm font-medium text-white">{current.sheetName}</div>
          <div className="overflow-auto">
            <SizeTable sizes={current.sizes} />
          </div>
        </div>
      </div>
    </section>
  );
}

function AccordionVariant({ articles }: { articles: WarehouseArticle[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const first = articles.slice(0, 4).map((article) => [article.articleWB, true]);
    return Object.fromEntries(first);
  });

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={ChevronsUpDown} title="3. Компактный список с раскрытием" />
      <div className="max-h-[760px] overflow-auto border-t border-[var(--border)]">
        {articles.map((article) => (
          <div key={article.articleWB} className="border-b border-[var(--border)]">
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [article.articleWB]: !prev[article.articleWB] }))}
              className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-card-hover)] md:grid-cols-[150px_1fr_90px_90px_36px]"
            >
              <div className="font-mono text-sm text-[var(--accent)]">{article.articleWB}</div>
              <div className="min-w-0 text-sm text-white">
                <div className="truncate">{article.sheetName}</div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{article.sizes.length} размеров</div>
              </div>
              <div className="text-right text-sm tabular-nums">{formatNumber(article.unitsQty)} шт</div>
              <div className="text-right text-sm font-semibold tabular-nums text-[var(--accent)]">{formatNumber(article.boxesQty, 2)} кор.</div>
              <div className="text-right text-[var(--text-muted)]">{open[article.articleWB] ? "−" : "+"}</div>
            </button>
            {open[article.articleWB] && (
              <div className="overflow-auto px-4 pb-4">
                <SizeTable sizes={article.sizes} compact />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CardsVariant({ articles }: { articles: WarehouseArticle[] }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Grid3X3} title="2. Карточки артикула с мини-таблицей" />
      <div className="grid gap-3 border-t border-[var(--border)] p-4 xl:grid-cols-2">
        {articles.map((article) => (
          <article key={article.articleWB} className="rounded-lg border border-[var(--border)] bg-[var(--bg)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-[var(--accent)]">{article.articleWB}</div>
                  <div className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">{article.sheetName}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-white">{formatNumber(article.boxesQty, 2)} кор.</div>
                  <div className="text-xs text-[var(--text-muted)]">{formatNumber(article.unitsQty)} шт</div>
                </div>
              </div>
            </div>
            <div className="overflow-auto p-3">
              <SizeTable sizes={article.sizes} compact />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TabsVariant({ articles }: { articles: WarehouseArticle[] }) {
  const [selected, setSelected] = useState(articles[0]?.articleWB || "");
  const current = articles.find((article) => article.articleWB === selected) || articles[0];

  useEffect(() => {
    if (!selected && articles[0]) setSelected(articles[0].articleWB);
  }, [articles, selected]);

  if (!current) return null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Rows3} title="4. Горизонтальные вкладки артикулов" />
      <div className="border-t border-[var(--border)]">
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] p-3">
          {articles.map((article) => (
            <button
              key={article.articleWB}
              type="button"
              onClick={() => setSelected(article.articleWB)}
              className={`shrink-0 rounded-md border px-3 py-2 text-left transition-colors ${article.articleWB === current.articleWB ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--border)] hover:bg-[var(--bg-card-hover)]"}`}
            >
              <div className="font-mono text-xs text-[var(--accent)]">{article.articleWB}</div>
              <div className="mt-1 text-[11px] font-semibold text-white">{formatNumber(article.boxesQty, 2)} кор.</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="font-mono text-base font-semibold text-[var(--accent)]">{current.articleWB}</div>
            <div className="mt-2 text-sm text-white">{current.sheetName}</div>
            <div className="mt-4 grid gap-2">
              <MetricPill label="Штук" value={formatNumber(current.unitsQty)} />
              <MetricPill label="Коробов" value={formatNumber(current.boxesQty, 2)} />
              <MetricPill label="Размеров" value={formatNumber(current.sizes.length)} />
            </div>
          </div>
          <div className="overflow-auto">
            <SizeTable sizes={current.sizes} />
          </div>
        </div>
      </div>
    </section>
  );
}

function GroupedVariant({ articles }: { articles: WarehouseArticle[] }) {
  const groups = [
    { key: "large", title: "Крупные", hint: "от 20 коробов", items: articles.filter((article) => article.boxesQty >= 20) },
    { key: "medium", title: "Средние", hint: "от 5 до 20 коробов", items: articles.filter((article) => article.boxesQty >= 5 && article.boxesQty < 20) },
    { key: "small", title: "Мелкие", hint: "до 5 коробов", items: articles.filter((article) => article.boxesQty < 5) },
  ];

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={LayoutDashboard} title="5. Группы по объёму готовых коробов" />
      <div className="grid gap-4 border-t border-[var(--border)] p-4 xl:grid-cols-3">
        {groups.map((group) => (
          <div key={group.key} className="rounded-lg border border-[var(--border)] bg-[var(--bg)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{group.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{group.hint}</div>
                </div>
                <div className="rounded-md bg-[var(--bg-card)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">{group.items.length}</div>
              </div>
            </div>
            <div className="max-h-[680px] space-y-3 overflow-auto p-3">
              {group.items.length === 0 && <div className="px-2 py-8 text-center text-xs text-[var(--text-muted)]">Нет артикулов</div>}
              {group.items.map((article) => (
                <article key={article.articleWB} className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-[var(--accent)]">{article.articleWB}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{article.sheetName}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-white">{formatNumber(article.boxesQty, 2)}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">кор.</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sortSizeRows(article.sizes).map((size) => (
                      <div key={sizeKey(size)} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px]">
                        <span className="text-white">{sizeTitle(size)}</span>
                        <span className="ml-1 text-[var(--accent)] tabular-nums">{formatNumber(size.boxes_qty, 2)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function VariantHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
    </div>
  );
}

const variants: Array<{ key: VariantKey; label: string }> = [
  { key: "split", label: "Слева/справа" },
  { key: "cards", label: "Карточки" },
  { key: "accordion", label: "Раскрытие" },
  { key: "tabs", label: "Вкладки" },
  { key: "grouped", label: "Группы" },
];

export default function WarehouseTestPage() {
  const [data, setData] = useState<WarehouseResponse | null>(null);
  const [active, setActive] = useState<VariantKey>("split");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/warehouse/stock", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: WarehouseResponse) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить склад");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const articles = useMemo(() => data?.articles || [], [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Склад: тестовые таблицы</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            <span>{formatNumber(data?.meta.totalArticles || 0)} артикулов</span>
            <span>·</span>
            <span>{formatNumber(data?.meta.totalRows || 0)} строк</span>
            <span>·</span>
            <span>{formatNumber(data?.meta.totalBoxes || 0, 2)} коробов</span>
            <span>·</span>
            <span>{formatDateTime(data?.meta.lastRun?.finished_at)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => setActive(variant.key)}
              className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${active === variant.key ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"}`}
            >
              {variant.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
          Загрузка
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!loading && !error && active === "split" && <SplitVariant articles={articles} />}
      {!loading && !error && active === "cards" && <CardsVariant articles={articles} />}
      {!loading && !error && active === "accordion" && <AccordionVariant articles={articles} />}
      {!loading && !error && active === "tabs" && <TabsVariant articles={articles} />}
      {!loading && !error && active === "grouped" && <GroupedVariant articles={articles} />}
    </div>
  );
}
