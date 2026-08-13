"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useData } from "@/components/DataProvider";
import type {
  CartStockApiResponse,
  CartStockProductGroup,
  CartStockWarehouse,
} from "@/types/cart-stock";

function formatDate(value: string | null | undefined): string {
  if (!value) return "ещё не обновлялось";
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CartProductThumb({ articleWB }: { articleWB: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [articleWB]);
  if (failed) {
    return <div className="h-[68px] w-[52px] shrink-0 rounded-lg bg-[var(--border)]" />;
  }

  return (
    <img
      src={`/api/shipment/product-photo/${encodeURIComponent(articleWB)}`}
      alt=""
      width={52}
      height={68}
      className="h-[68px] w-[52px] shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function StockCell({ quantity }: { quantity: number }) {
  return (
    <span className={quantity > 0 ? "font-semibold text-white" : "text-[var(--text-muted)]/45"}>
      {quantity > 0 ? quantity.toLocaleString("ru-RU") : "—"}
    </span>
  );
}

function warehouseGroup(warehouse: CartStockWarehouse): number {
  if (warehouse.isWb === false) return 1;
  // Old snapshots do not contain isWb, but WB names seller warehouses explicitly.
  return /^\s*склад продавца(?:\s|$)/iu.test(warehouse.name) ? 1 : 0;
}

function compareWarehouses(left: CartStockWarehouse, right: CartStockWarehouse): number {
  return warehouseGroup(left) - warehouseGroup(right)
    || right.quantity - left.quantity
    || left.name.localeCompare(right.name, "ru");
}

function sizeNumbers(value: string): number[] {
  return Array.from(value.matchAll(/\d+(?:[.,]\d+)?/g), (match) =>
    Number(match[0].replace(",", ".")),
  ).filter(Number.isFinite);
}

function compareProductSizes(
  left: { name: string; originalName: string },
  right: { name: string; originalName: string },
): number {
  const leftLabel = left.originalName || left.name;
  const rightLabel = right.originalName || right.name;
  const leftNumbers = sizeNumbers(leftLabel);
  const rightNumbers = sizeNumbers(rightLabel);
  if (leftNumbers.length === 0 && rightNumbers.length > 0) return 1;
  if (rightNumbers.length === 0 && leftNumbers.length > 0) return -1;
  for (let index = 0; index < Math.max(leftNumbers.length, rightNumbers.length); index += 1) {
    const difference = (leftNumbers[index] ?? Number.POSITIVE_INFINITY)
      - (rightNumbers[index] ?? Number.POSITIVE_INFINITY);
    if (difference !== 0) return difference;
  }
  return leftLabel.localeCompare(rightLabel, "ru", { numeric: true });
}

function isMeaningfulProductSize(size: { name: string; originalName: string }): boolean {
  const label = (size.originalName || size.name).trim();
  if (!label) return false;
  return !/^0+(?:[.,]0+)?$/.test(label);
}

export default function CartStockTab() {
  const { products, overrides } = useData();
  const [data, setData] = useState<CartStockApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [productGroup, setProductGroup] = useState<CartStockProductGroup>("rucksacks");
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/shipment/cart-stock?group=${productGroup}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CartStockApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [productGroup]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setQuery("");
    setExpandedArticles(new Set());
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeJob = data?.queue?.active || null;
  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [activeJob, load]);

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/shipment/cart-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productGroup }),
      });
      const payload = await response.json().catch(() => ({})) as CartStockApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setData(payload);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить данные");
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const snapshot = data?.snapshot || null;
  const orderedWarehouses = useMemo(
    () => snapshot ? [...snapshot.warehouses].sort(compareWarehouses) : [],
    [snapshot],
  );
  const productMeta = useMemo(
    () => new Map(products.map((product) => [String(product.articleWB), product])),
    [products],
  );

  const rows = useMemo(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return snapshot.products
      .map((row) => {
        const meta = productMeta.get(row.articleWB);
        const displayName = overrides[row.articleWB]?.customName?.trim()
          || row.wbName
          || meta?.name
          || "Без названия";
        return {
          ...row,
          displayName,
          category: meta?.category || "",
        };
      })
      .filter((row) => {
        if (!normalizedQuery) return true;
        return [
          row.articleWB,
          row.displayName,
          row.wbName,
          row.category,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) =>
        right.cartQuantity - left.cartQuantity
        || left.displayName.localeCompare(right.displayName, "ru"),
      );
  }, [overrides, productMeta, query, snapshot]);

  const warehouseIndex = useMemo(() => {
    const index = new Map<string, Map<number, number>>();
    for (const product of snapshot?.products || []) {
      index.set(
        product.articleWB,
        new Map(product.warehouses.map((warehouse) => [warehouse.warehouseId, warehouse.quantity])),
      );
    }
    return index;
  }, [snapshot]);

  const filteredTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const row of rows) {
      for (const warehouse of row.warehouses) {
        totals.set(
          warehouse.warehouseId,
          (totals.get(warehouse.warehouseId) || 0) + warehouse.quantity,
        );
      }
    }
    return totals;
  }, [rows]);

  const missingCount = snapshot?.products.filter((product) => product.missing).length || 0;
  const failedLocationCount = snapshot?.failedLocations?.length || 0;
  const productsWithStock = snapshot?.products.filter((product) => product.cartQuantity > 0).length || 0;
  const lastAttemptFailed = data?.lastAttempt?.status === "error";
  const worker = data?.queue?.worker || null;
  const workerProblem = Boolean(worker && (!worker.online || worker.authState === "error" || worker.lastError));
  const queuedBehindWorkerProblem = Boolean(
    activeJob?.status === "pending" && activeJob.attempts === 0 && workerProblem,
  );
  const refreshInProgress = refreshing || Boolean(activeJob);
  const productGroupLabel = productGroup === "rucksacks" ? "рюкзаков" : "трусов";

  const toggleArticle = (articleWB: string) => {
    setExpandedArticles((current) => {
      const next = new Set(current);
      if (next.has(articleWB)) next.delete(articleWB);
      else next.add(articleWB);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1">
              {([
                ["rucksacks", "Рюкзаки"],
                ["underwear", "Трусы"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setProductGroup(value)}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    productGroup === value
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "text-[var(--text-muted)] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <h2 className="text-xl font-semibold text-white">
              Остатки {productGroupLabel} через пользовательский сайт WB
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-muted)]">
              Авторизованный снимок покупательской карточки WB. Проверку выполняет WB‑Парсер своей постоянно
              обновляемой покупательской сессией; seller API не используется.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshInProgress}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshInProgress && !queuedBehindWorkerProblem ? "animate-spin" : ""} />
            {queuedBehindWorkerProblem
              ? "Обновление отложено"
              : activeJob?.status === "pending"
                ? "Ожидаем WB‑Парсер…"
              : activeJob?.status === "processing" || refreshing
                ? "Проверяем WB…"
                : "Обновить сейчас"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <p className="text-xs text-[var(--text-muted)]">Всего по складам</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {snapshot ? snapshot.totalCartQuantity.toLocaleString("ru-RU") : "—"}
              {snapshot && <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">шт.</span>}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <p className="text-xs text-[var(--text-muted)]">Артикулов с остатком</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {snapshot ? `${productsWithStock} / ${snapshot.requestedArticles}` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <p className="text-xs text-[var(--text-muted)]">Складов в выдаче</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {snapshot ? snapshot.warehouses.length.toLocaleString("ru-RU") : "—"}
            </p>
            {snapshot && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Источник: {snapshot.authenticated ? "авторизованный WB" : "анонимный WB"}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <p className="text-xs text-[var(--text-muted)]">Последняя проверка, МСК</p>
            <p className="mt-2 text-sm font-medium text-white">{formatDate(snapshot?.capturedAt)}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Авто: {(data?.schedule.timesMsk || ["06:00", "14:00", "22:00"]).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {(error || lastAttemptFailed || missingCount > 0 || failedLocationCount > 0 || workerProblem || activeJob) && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--warning)]/35 bg-[var(--warning)]/5 px-4 py-3 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--warning)]" />
          <div>
            {error && <p className="text-[var(--warning)]">{error}</p>}
            {activeJob && (
              <p className="text-[var(--text-muted)]">
                Задание №{activeJob.id} {activeJob.status === "pending" ? "ожидает worker" : "выполняется"}.
                Страница обновится автоматически.
              </p>
            )}
            {workerProblem && (
              <p className="text-[var(--warning)]">
                {!worker?.online
                  ? "WB‑Парсер не присылал heartbeat более двух минут. Задание сохранено и не потеряется."
                  : worker?.authState === "error"
                    ? `Покупательская авторизация WB требует внимания: ${worker.lastError || "неизвестная ошибка"}`
                    : `Автоматический запрос WB временно не выполняется: ${worker?.lastError || "неизвестная ошибка"}`}
              </p>
            )}
            {!error && lastAttemptFailed && (
              <p className="text-[var(--warning)]">
                Последняя попытка обновления завершилась ошибкой: {data?.lastAttempt?.error}
              </p>
            )}
            {missingCount > 0 && (
              <p className="text-[var(--text-muted)]">
                WB не вернул карточки для {missingCount} арт. — они отмечены в таблице.
              </p>
            )}
            {failedLocationCount > 0 && (
              <p className="text-[var(--text-muted)]">
                Не удалось проверить географии: {snapshot?.failedLocations?.join(", ")}.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <div className="relative w-full max-w-md">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию или артикулу"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Источник — авторизованная покупательская карточка WB. Колонка «Всего» рассчитана внутри MpHub как
            сумма показанных складов по каждому артикулу; неполные ответы не заменяют корректный снимок.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-16 text-[var(--text-muted)]">
            <RefreshCw size={20} className="animate-spin text-[var(--accent)]" />
            Загружаем последний снимок…
          </div>
        ) : !snapshot ? (
          <div className="p-16 text-center">
            <p className="text-white">Снимков остатков пока нет.</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Нажмите «Обновить сейчас», чтобы выполнить первую проверку.
            </p>
          </div>
        ) : (
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-max border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 w-[390px] min-w-[390px] border-b border-r border-[var(--border)] bg-[var(--bg-card-hover)] px-4 py-3 text-left font-medium text-white">
                    Товар
                  </th>
                  <th className="w-[84px] min-w-[84px] border-b border-r border-[var(--border)] bg-[var(--bg-card-hover)] px-3 py-3 text-right font-medium text-white">
                    Всего
                  </th>
                  {orderedWarehouses.map((warehouse) => (
                    <th
                      key={warehouse.id}
                      className="w-[136px] min-w-[136px] border-b border-r border-[var(--border)] bg-[var(--bg-card-hover)] px-3 py-3 text-right font-medium text-white last:border-r-0"
                    >
                      <span className="block whitespace-normal">{warehouse.name}</span>
                      <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">
                        {warehouse.quantity.toLocaleString("ru-RU")} шт.
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const byWarehouse = warehouseIndex.get(row.articleWB) || new Map<number, number>();
                  const sizes = (row.sizes || [])
                    .filter(isMeaningfulProductSize)
                    .sort(compareProductSizes);
                  const canExpandSizes = sizes.length > 1;
                  const expanded = canExpandSizes && expandedArticles.has(row.articleWB);
                  return (
                    <Fragment key={row.articleWB}>
                      <tr className="group hover:bg-[var(--bg-card-hover)]/45">
                        <td className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 group-hover:bg-[var(--bg-card-hover)]">
                          <div className="flex items-center gap-3">
                            <CartProductThumb articleWB={row.articleWB} />
                            <div className="min-w-0">
                              <p className="w-[290px] whitespace-normal break-words font-medium leading-5 text-white" title={row.displayName}>
                                {row.displayName}
                              </p>
                              {row.category && (
                                <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{row.category}</p>
                              )}
                              <p className="mt-1 font-mono text-xs text-[var(--accent)]">{row.articleWB}</p>
                              {canExpandSizes && (
                                <button
                                  type="button"
                                  onClick={() => toggleArticle(row.articleWB)}
                                  aria-expanded={expanded}
                                  className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-white"
                                >
                                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  Размеры: {sizes.length}
                                </button>
                              )}
                              {row.missing && (
                                <p className="mt-1 text-xs text-[var(--warning)]">Карточка не вернулась от WB</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="border-b border-r border-[var(--border)] bg-[var(--accent)]/5 px-3 py-2 text-right text-base tabular-nums">
                          <StockCell quantity={row.cartQuantity} />
                        </td>
                        {orderedWarehouses.map((warehouse) => (
                          <td
                            key={warehouse.id}
                            className="border-b border-r border-[var(--border)] px-3 py-2 text-right tabular-nums last:border-r-0"
                          >
                            <StockCell quantity={byWarehouse.get(warehouse.id) || 0} />
                          </td>
                        ))}
                      </tr>
                      {expanded && sizes.map((size, sizeIndex) => {
                        const sizeByWarehouse = new Map(
                          size.warehouses.map((warehouse) => [warehouse.warehouseId, warehouse.quantity]),
                        );
                        const sizeLabel = size.originalName || size.name || `Размер ${sizeIndex + 1}`;
                        return (
                          <tr
                            key={size.optionId || `${row.articleWB}-${size.name}-${sizeIndex}`}
                            className="bg-[var(--bg)]/75"
                          >
                            <td className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--bg)] px-4 py-2">
                              <div className="ml-[64px]">
                                <p className="font-medium text-white">Размер {sizeLabel}</p>
                                {size.originalName && size.name && size.originalName !== size.name && (
                                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">На WB: {size.name}</p>
                                )}
                              </div>
                            </td>
                            <td className="border-b border-r border-[var(--border)] bg-[var(--accent)]/5 px-3 py-2 text-right tabular-nums">
                              <StockCell quantity={size.cartQuantity} />
                            </td>
                            {orderedWarehouses.map((warehouse) => (
                              <td
                                key={warehouse.id}
                                className="border-b border-r border-[var(--border)] px-3 py-2 text-right tabular-nums last:border-r-0"
                              >
                                <StockCell quantity={sizeByWarehouse.get(warehouse.id) || 0} />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 border-r border-t border-[var(--border)] bg-[var(--bg-card-hover)] px-4 py-3 text-left text-white">
                    {query ? `Итого по найденным: ${rows.length}` : `Всего артикулов: ${rows.length}`}
                  </th>
                  <th className="border-r border-t border-[var(--border)] bg-[var(--bg-card-hover)] px-3 py-3 text-right tabular-nums text-white">
                    {rows.reduce((sum, row) => sum + row.cartQuantity, 0).toLocaleString("ru-RU")}
                  </th>
                  {orderedWarehouses.map((warehouse) => (
                    <th
                      key={warehouse.id}
                      className="border-r border-t border-[var(--border)] bg-[var(--bg-card-hover)] px-3 py-3 text-right tabular-nums text-white last:border-r-0"
                    >
                      {(filteredTotals.get(warehouse.id) || 0).toLocaleString("ru-RU")}
                    </th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
