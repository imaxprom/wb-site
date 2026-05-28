"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Columns3, LayoutGrid, ListTree, PanelTop, Search, Table2 } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

interface BarcodeItem {
  barcode: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
  quantity: number;
}

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

type VariantId = "aligned" | "alignedSizeOnly" | "nested" | "cards" | "split" | "compact";

const VARIANTS: Array<{ id: VariantId; title: string; icon: typeof Table2 }> = [
  { id: "aligned", title: "1. Выравнивание колонок", icon: Table2 },
  { id: "alignedSizeOnly", title: "1.1. Выравнивание колонок", icon: Table2 },
  { id: "nested", title: "2. Вложенная таблица", icon: PanelTop },
  { id: "cards", title: "3. Карточки размеров", icon: LayoutGrid },
  { id: "split", title: "4. Сводка + детали", icon: Columns3 },
  { id: "compact", title: "5. Компактный список", icon: ListTree },
];

const RUB = (value: number) => `${formatNumber(value, value % 1 !== 0 ? 2 : 0)} ₽`;

function hasCost(row: RowData) {
  return row.cost !== null && row.cost > 0;
}

function getGroupKey(row: RowData) {
  return row.nm_id > 0 ? `nm:${row.nm_id}` : `barcode:${row.barcode}`;
}

function isRealSizeName(sizeName: string) {
  const normalized = sizeName.trim().toLowerCase();
  return Boolean(normalized && normalized !== "-" && normalized !== "—" && normalized !== "–" && normalized !== "нет" && normalized !== "без размера");
}

function compareSizeRows(a: RowData, b: RowData) {
  const aReal = isRealSizeName(a.ts_name);
  const bReal = isRealSizeName(b.ts_name);
  if (aReal !== bReal) return aReal ? -1 : 1;

  const size = a.ts_name.localeCompare(b.ts_name, "ru", { numeric: true });
  if (size !== 0) return size;
  return a.barcode.localeCompare(b.barcode, "ru");
}

function countRealSizes(rows: RowData[]) {
  return new Set(rows.map((row) => row.ts_name.trim()).filter(isRealSizeName)).size;
}

function rowMatches(row: RowData, query: string) {
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
    const sellerArticles = Array.from(new Set(sortedRows.map((row) => row.sa_name).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ru"));
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
    if ((a.withoutCost > 0) !== (b.withoutCost > 0)) return a.withoutCost > 0 ? -1 : 1;
    if (a.nm_id !== b.nm_id) return a.nm_id - b.nm_id;
    return a.sellerArticle.localeCompare(b.sellerArticle, "ru");
  });
}

function CostPill({ row, align = "right" }: { row: RowData; align?: "right" | "center" }) {
  const rowHasCost = hasCost(row);
  return (
    <span
      className={cn(
        "inline-flex min-w-[104px] rounded-md border px-2.5 py-1 text-sm tabular-nums",
        align === "center" ? "justify-center" : "justify-end",
        rowHasCost
          ? "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)]"
          : "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]"
      )}
    >
      {rowHasCost ? RUB(row.cost!) : "не задана"}
    </span>
  );
}

function StatusBadge({ withoutCost }: { withoutCost: number }) {
  if (withoutCost > 0) {
    return (
      <span className="inline-flex items-center rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-2 py-1 text-xs font-medium text-[var(--danger)]">
        Нужно заполнить
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-2 py-1 text-xs font-medium text-[var(--success)]">
      Заполнено
    </span>
  );
}

function GroupSummaryRow({
  group,
  expanded,
  onToggle,
}: {
  group: ArticleGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasMissingCost = group.withoutCost > 0;
  return (
    <tr
      className={cn(
        "cursor-pointer",
        hasMissingCost && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
      )}
      onClick={onToggle}
    >
      <td className="font-mono text-sm text-[var(--text)]">
        <button type="button" className="inline-flex items-center gap-2 text-left" aria-expanded={expanded}>
          {expanded ? (
            <ChevronDown size={16} className="text-[var(--text-muted)]" />
          ) : (
            <ChevronRight size={16} className="text-[var(--text-muted)]" />
          )}
          <span>{group.nm_id || "-"}</span>
        </button>
      </td>
      <td className="font-mono text-[var(--accent)]">
        <span title={group.sellerArticles.join(", ")}>
          {group.sellerArticle || "-"}
          {group.sellerArticles.length > 1 && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">+{group.sellerArticles.length - 1}</span>
          )}
        </span>
      </td>
      <td className="text-center tabular-nums">{formatNumber(group.realSizeCount)}</td>
      <td className="text-center tabular-nums">{formatNumber(group.total)}</td>
      <td className={cn("text-center tabular-nums", hasMissingCost ? "text-[var(--danger)]" : "text-[var(--success)]")}>
        {formatNumber(group.withoutCost)}
      </td>
      <td className="text-center">
        <StatusBadge withoutCost={group.withoutCost} />
      </td>
    </tr>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="data-table-wrapper">
      <table className="data-table table-fixed min-w-[1040px]">
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
            <th className="text-center">Размеры</th>
            <th className="text-center">Баркоды</th>
            <th className="text-center">Себестоимость</th>
            <th className="text-center">Статус</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function VariantAligned({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <TableShell>
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <Fragment key={group.key}>
            <GroupSummaryRow group={group} expanded={expanded} onToggle={() => toggleGroup(group.key)} />
            {expanded && (
              <>
                {group.rows.map((row, rowIndex) => (
                  <tr
                    key={`${group.key}:${row.barcode}`}
                    className={cn(
                      "bg-[var(--bg)]/45 text-sm",
                      rowIndex === 0 && "[&>td]:border-t [&>td]:border-t-[var(--border)]",
                      !hasCost(row) && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                    )}
                  >
                    <td className="pl-12 text-[var(--text)]">{row.ts_name || "-"}</td>
                    <td className="font-mono text-[var(--accent)]">{row.sa_name || group.sellerArticle || "-"}</td>
                    <td aria-hidden="true" />
                    <td className="num font-mono text-[var(--text-muted)]">{row.barcode}</td>
                    <td className="num"><CostPill row={row} /></td>
                    <td className="text-center"><StatusBadge withoutCost={hasCost(row) ? 0 : 1} /></td>
                  </tr>
                ))}
              </>
            )}
          </Fragment>
        );
      })}
    </TableShell>
  );
}

function VariantAlignedSizeOnly({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <TableShell>
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <Fragment key={group.key}>
            <GroupSummaryRow group={group} expanded={expanded} onToggle={() => toggleGroup(group.key)} />
            {expanded && (
              <>
                {group.rows.map((row, rowIndex) => (
                  <tr
                    key={`${group.key}:${row.barcode}`}
                    className={cn(
                      "bg-[var(--bg)]/45 text-sm",
                      rowIndex === 0 && "[&>td]:border-t [&>td]:border-t-[var(--border)]",
                      !hasCost(row) && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
                    )}
                  >
                    <td aria-hidden="true" />
                    <td aria-hidden="true" />
                    <td className="text-center text-[var(--text)]">
                      <span className="inline-block min-w-10 text-left">{row.ts_name || "-"}</span>
                    </td>
                    <td className="text-center font-mono text-[var(--text-muted)]">{row.barcode}</td>
                    <td className="text-center"><CostPill row={row} align="center" /></td>
                    <td className="text-center"><StatusBadge withoutCost={hasCost(row) ? 0 : 1} /></td>
                  </tr>
                ))}
              </>
            )}
          </Fragment>
        );
      })}
    </TableShell>
  );
}

function VariantNested({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <TableShell>
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <Fragment key={group.key}>
            <GroupSummaryRow group={group} expanded={expanded} onToggle={() => toggleGroup(group.key)} />
            {expanded && (
              <tr>
                <td colSpan={6} className="bg-[var(--bg)]/60 p-0 whitespace-normal">
                  <div className="px-5 py-4">
                    <table className="w-full min-w-[760px] border-collapse text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          <th className="border-b border-[var(--border)] px-3 py-2 text-left">Размер</th>
                          <th className="border-b border-[var(--border)] px-3 py-2 text-left">Артикул продавца</th>
                          <th className="border-b border-[var(--border)] px-3 py-2 text-left">Баркод</th>
                          <th className="border-b border-[var(--border)] px-3 py-2 text-right">Себестоимость</th>
                          <th className="border-b border-[var(--border)] px-3 py-2 text-right">Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={`${group.key}:${row.barcode}`}>
                            <td className="border-b border-[var(--border)]/70 px-3 py-2 text-[var(--text)]">{row.ts_name || "-"}</td>
                            <td className="border-b border-[var(--border)]/70 px-3 py-2 font-mono text-[var(--accent)]">{row.sa_name || "-"}</td>
                            <td className="border-b border-[var(--border)]/70 px-3 py-2 font-mono text-[var(--text-muted)]">{row.barcode}</td>
                            <td className="border-b border-[var(--border)]/70 px-3 py-2 text-right"><CostPill row={row} /></td>
                            <td className="border-b border-[var(--border)]/70 px-3 py-2 text-right"><StatusBadge withoutCost={hasCost(row) ? 0 : 1} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </TableShell>
  );
}

function VariantCards({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <section key={group.key} className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className={cn(
                "grid w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-card-hover)] md:grid-cols-[150px_minmax(0,1fr)_110px_130px_120px]",
                group.withoutCost > 0 && "border-l-2 border-[var(--danger)] bg-[var(--danger)]/5"
              )}
            >
              <span className="inline-flex items-center gap-2 font-mono text-sm">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {group.nm_id || "-"}
              </span>
              <span className="min-w-0 truncate font-mono text-[var(--accent)]">{group.sellerArticle || "-"}</span>
              <span className="text-right text-sm text-[var(--text-muted)]">{formatNumber(group.total)} барк.</span>
              <span className={cn("text-right text-sm", group.withoutCost > 0 ? "text-[var(--danger)]" : "text-[var(--success)]")}>
                {formatNumber(group.withoutCost)} без цены
              </span>
              <span className="text-right"><StatusBadge withoutCost={group.withoutCost} /></span>
            </button>
            {expanded && (
              <div className="grid gap-3 border-t border-[var(--border)] bg-[var(--bg)]/50 p-4 md:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((row) => (
                  <article
                    key={`${group.key}:${row.barcode}`}
                    className={cn(
                      "rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3",
                      !hasCost(row) && "border-[var(--danger)]/40 bg-[var(--danger)]/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Размер</div>
                        <div className="mt-1 text-sm font-medium text-[var(--text)]">{row.ts_name || "-"}</div>
                      </div>
                      <StatusBadge withoutCost={hasCost(row) ? 0 : 1} />
                    </div>
                    <div className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                      <span className="text-[var(--text-muted)]">Артикул</span>
                      <span className="min-w-0 truncate font-mono text-[var(--accent)]">{row.sa_name || "-"}</span>
                      <span className="text-[var(--text-muted)]">Баркод</span>
                      <span className="font-mono text-[var(--text)]">{row.barcode}</span>
                      <span className="text-[var(--text-muted)]">Себест.</span>
                      <span><CostPill row={row} /></span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function VariantSplit({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        const missingRows = group.rows.filter((row) => !hasCost(row));
        return (
          <section key={group.key} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-card-hover)] lg:grid-cols-[170px_minmax(0,1fr)_220px]"
            >
              <span className="inline-flex items-center gap-2 font-mono text-sm">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {group.nm_id || "-"}
              </span>
              <span className="min-w-0 truncate font-mono text-[var(--accent)]">{group.sellerArticle || "-"}</span>
              <span className="flex items-center justify-end"><StatusBadge withoutCost={group.withoutCost} /></span>
            </button>
            {expanded && (
              <div className="grid gap-4 border-t border-[var(--border)] bg-[var(--bg)]/45 p-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Сводка артикула</div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <dt className="text-[var(--text-muted)]">Баркодов</dt>
                    <dd className="text-right font-medium">{formatNumber(group.total)}</dd>
                    <dt className="text-[var(--text-muted)]">С ценой</dt>
                    <dd className="text-right font-medium text-[var(--success)]">{formatNumber(group.withCost)}</dd>
                    <dt className="text-[var(--text-muted)]">Без цены</dt>
                    <dd className="text-right font-medium text-[var(--danger)]">{formatNumber(group.withoutCost)}</dd>
                  </dl>
                  {missingRows.length > 0 && (
                    <div className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
                      Заполнить себестоимость: {missingRows.length}
                    </div>
                  )}
                </div>
                <div className="data-table-wrapper rounded-lg border border-[var(--border)]">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={`${group.key}:${row.barcode}`} className="border-b border-[var(--border)] last:border-b-0">
                          <td className="px-3 py-2 text-[var(--text)]">{row.ts_name || "-"}</td>
                          <td className="px-3 py-2 font-mono text-[var(--accent)]">{row.sa_name || "-"}</td>
                          <td className="px-3 py-2 font-mono text-[var(--text-muted)]">{row.barcode}</td>
                          <td className="px-3 py-2 text-right"><CostPill row={row} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function VariantCompact({
  groups,
  expandedGroups,
  toggleGroup,
}: {
  groups: ArticleGroup[];
  expandedGroups: Set<string>;
  toggleGroup: (key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      {groups.map((group) => {
        const expanded = expandedGroups.has(group.key);
        return (
          <div key={group.key} className="border-b border-[var(--border)] last:border-b-0">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="grid w-full gap-3 px-4 py-3 text-left hover:bg-[var(--bg-card-hover)] md:grid-cols-[140px_minmax(0,1fr)_90px_110px]"
            >
              <span className="inline-flex items-center gap-2 font-mono text-sm">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {group.nm_id || "-"}
              </span>
              <span className="min-w-0 truncate font-mono text-[var(--accent)]">{group.sellerArticle || "-"}</span>
              <span className="text-right text-sm text-[var(--text-muted)]">{group.total} шт</span>
              <span className={cn("text-right text-sm", group.withoutCost > 0 ? "text-[var(--danger)]" : "text-[var(--success)]")}>
                -{group.withoutCost}
              </span>
            </button>
            {expanded && (
              <div className="space-y-1 bg-[var(--bg)]/45 px-4 py-3">
                {group.rows.map((row) => (
                  <div
                    key={`${group.key}:${row.barcode}`}
                    className={cn(
                      "grid items-center gap-3 rounded-md px-3 py-2 text-sm md:grid-cols-[92px_minmax(0,1fr)_150px_126px]",
                      hasCost(row) ? "bg-[var(--bg-card)]" : "bg-[var(--danger)]/8"
                    )}
                  >
                    <span className="text-[var(--text)]">{row.ts_name || "-"}</span>
                    <span className="min-w-0 truncate font-mono text-[var(--accent)]">{row.sa_name || "-"}</span>
                    <span className="font-mono text-[var(--text-muted)]">{row.barcode}</span>
                    <span className="justify-self-end"><CostPill row={row} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CogsSettingsTestPage() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [search, setSearch] = useState("");
  const [activeVariant, setActiveVariant] = useState<VariantId>("aligned");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError("");

      try {
        const [cogsResp, barcodesResp] = await Promise.all([
          fetch("/api/finance/cogs", { cache: "no-store" }),
          fetch("/api/finance/barcodes", { cache: "no-store" }),
        ]);

        if (!cogsResp.ok || !barcodesResp.ok) throw new Error("Не удалось загрузить данные себестоимости");

        const cogsRows = await cogsResp.json() as { barcode: string; cost: number | null }[];
        const barcodeRows = await barcodesResp.json() as BarcodeItem[];
        const cogsByBarcode = new Map(cogsRows.map((row) => [row.barcode, Number(row.cost || 0)]));
        const merged = barcodeRows.map((row) => ({
          ...row,
          cost: cogsByBarcode.get(row.barcode) || null,
        }));

        if (!cancelled) setRows(merged);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const articleGroups = useMemo(() => buildArticleGroups(rows), [rows]);
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return articleGroups;

    return articleGroups.flatMap((group) => {
      const groupMatches =
        String(group.nm_id).includes(query) ||
        group.sellerArticles.some((article) => article.toLowerCase().includes(query));

      if (groupMatches) return [group];

      const matchedRows = group.rows.filter((row) => rowMatches(row, query));
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

  const previewGroups = visibleGroups.slice(0, 40);
  const total = rows.length;
  const totalArticles = articleGroups.length;
  const withoutCost = rows.filter((row) => !hasCost(row)).length;

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandProblemGroups() {
    setExpandedGroups(new Set(visibleGroups.filter((group) => group.withoutCost > 0).slice(0, 12).map((group) => group.key)));
  }

  function renderVariant() {
    const commonProps = { groups: previewGroups, expandedGroups, toggleGroup };
    if (activeVariant === "alignedSizeOnly") return <VariantAlignedSizeOnly {...commonProps} />;
    if (activeVariant === "nested") return <VariantNested {...commonProps} />;
    if (activeVariant === "cards") return <VariantCards {...commonProps} />;
    if (activeVariant === "split") return <VariantSplit {...commonProps} />;
    if (activeVariant === "compact") return <VariantCompact {...commonProps} />;
    return <VariantAligned {...commonProps} />;
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-[var(--text-muted)]">Загрузка тестовых вариантов...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-5 text-[var(--danger)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/finance/settings" className="text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]">
            Назад к себестоимости
          </Link>
          <h2 className="mt-1 text-2xl font-bold">Тест таблицы себестоимости</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Тестовые варианты раскрытия артикула на реальных данных. Страница только для выбора раскладки.
          </p>
        </div>
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
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
        <div className="flex flex-wrap gap-2">
          {VARIANTS.map((variant) => {
            const Icon = variant.icon;
            const active = variant.id === activeVariant;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => setActiveVariant(variant.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
                )}
              >
                <Icon size={16} />
                {variant.title}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по NM ID, артикулу продавца, баркоду или размеру..."
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={expandProblemGroups}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--bg-card-hover)]"
            >
              Развернуть проблемные
            </button>
            <button
              type="button"
              onClick={() => setExpandedGroups(new Set())}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
            >
              Свернуть все
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
          <span>Показано групп: {formatNumber(previewGroups.length)} из {formatNumber(visibleGroups.length)}</span>
          <span>Клик по артикулу раскрывает одинаковый набор размеров во всех вариантах.</span>
        </div>
        {previewGroups.length > 0 ? (
          renderVariant()
        ) : (
          <div className="py-10 text-center text-sm text-[var(--text-muted)]">Ничего не найдено</div>
        )}
      </div>
    </div>
  );
}
