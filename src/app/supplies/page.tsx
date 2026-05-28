"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, PackageOpen, RefreshCw, Search } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface SupplyDetail {
  statusID?: number;
  virtualTypeID?: number;
  boxTypeID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  warehouseID?: number | null;
  warehouseName?: string;
  actualWarehouseName?: string;
  supplierAssignName?: string;
  quantity?: number;
  packedQuantity?: number;
  packedQuantitySource?: "package" | "goods" | "detail";
  readyForSaleQuantity?: number;
  acceptedQuantity?: number;
  unloadingQuantity?: number;
  depersonalizedQuantity?: number;
  storageCoef?: string | null;
  deliveryCoef?: string | null;
  isBoxOnPallet?: boolean;
}

interface SupplyRow {
  supplyID: number | null;
  preorderID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  statusID?: number;
  boxTypeID?: number;
  isBoxOnPallet?: boolean;
  detail: SupplyDetail | null;
  detailError?: string;
}

interface SupplyPackageArticle {
  articleWB: string;
  name: string;
  quantity: number;
  acceptedQuantity?: number;
  barcodes: {
    barcode: string;
    size: string;
    quantity: number;
    acceptedQuantity?: number;
    boxes: string[];
  }[];
}

interface SupplyPackageResponse {
  supplyID: string;
  source?: "package" | "goods";
  articles: SupplyPackageArticle[];
  meta: {
    source?: "package" | "goods";
    packageCount: number;
    totalQuantity: number;
    totalAcceptedQuantity?: number;
    articleCount: number;
    barcodeCount: number;
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatSupplyDateRange(planned: string | null | undefined, actual: string | null | undefined) {
  return `${formatDate(planned)} → ${formatDate(actual)}`;
}

function statusLabel(statusID: number | undefined) {
  switch (statusID) {
    case 1:
      return "Не запланировано";
    case 2:
      return "Запланировано";
    case 3:
      return "Отгрузка разрешена";
    case 4:
      return "Идёт приёмка";
    case 5:
      return "Принято";
    case 6:
      return "Отгружено на воротах";
    default:
      return statusID ? `Статус ${statusID}` : "-";
  }
}

function statusBadgeClass(statusID: number | undefined) {
  switch (statusID) {
    case 1:
      return "border-[var(--text-muted)]/30 bg-[var(--text-muted)]/10 text-[var(--text-muted)]";
    case 2:
      return "border-[#42A5F5]/35 bg-[#42A5F5]/10 text-[#42A5F5]";
    case 3:
      return "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent-hover)]";
    case 4:
      return "border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]";
    case 5:
      return "border-[var(--success)]/35 bg-[var(--success)]/10 text-[var(--success)]";
    case 6:
      return "border-cyan-400/35 bg-cyan-400/10 text-cyan-300";
    default:
      return "border-[var(--border)] bg-[var(--bg)] text-white";
  }
}

function virtualTypeLabel(virtualTypeID: number | undefined) {
  switch (virtualTypeID) {
    case 5:
      return "Допринято";
    default:
      return null;
  }
}

function supplyTypeLabel(detail: SupplyDetail | null, supply: SupplyRow) {
  return virtualTypeLabel(detail?.virtualTypeID) || typeLabel(detail?.boxTypeID ?? supply.boxTypeID, detail?.isBoxOnPallet ?? supply.isBoxOnPallet);
}

function typeLabel(boxTypeID: number | undefined, isBoxOnPallet?: boolean) {
  if (boxTypeID === 2) return isBoxOnPallet ? "Короба на паллете" : "Короба";
  if (boxTypeID === 0) return "Без коробов";
  return boxTypeID === undefined ? "-" : `Тип ${boxTypeID}`;
}

function quantityPair(detail: SupplyDetail | null) {
  if (!detail) return "-";
  const packed = detail.packedQuantity ?? detail.quantity ?? 0;
  return `${formatNumber(packed)} / ${formatNumber(detail.acceptedQuantity || 0)}`;
}

export default function SuppliesPage() {
  const [supplies, setSupplies] = useState<SupplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expandedID, setExpandedID] = useState<number | null>(null);
  const [packageBySupply, setPackageBySupply] = useState<Record<string, SupplyPackageResponse>>({});
  const [packageLoading, setPackageLoading] = useState<Record<string, boolean>>({});
  const [packageErrors, setPackageErrors] = useState<Record<string, string>>({});

  const loadSupplies = useCallback(async () => {
    const res = await fetch("/api/supplies?limit=20", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    setSupplies(payload.supplies || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSupplies()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить поставки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSupplies]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await loadSupplies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить поставки");
    } finally {
      setRefreshing(false);
    }
  }, [loadSupplies]);

  const loadPackage = useCallback(async (supplyID: number) => {
    const key = String(supplyID);
    if (packageBySupply[key] || packageLoading[key]) return;

    setPackageLoading((prev) => ({ ...prev, [key]: true }));
    setPackageErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch(`/api/supplies/${supplyID}/package`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      setPackageBySupply((prev) => ({ ...prev, [key]: payload }));
    } catch (err) {
      setPackageErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Не удалось загрузить упаковку",
      }));
    } finally {
      setPackageLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [packageBySupply, packageLoading]);

  const toggleSupply = useCallback((supplyID: number | null) => {
    if (!Number.isSafeInteger(supplyID)) return;

    setExpandedID((current) => {
      const next = current === supplyID ? null : supplyID;
      if (next) void loadPackage(next);
      return next;
    });
  }, [loadPackage]);

  const visibleSupplies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return supplies;
    return supplies.filter((supply) => {
      const detail = supply.detail;
      return [
        supply.supplyID,
        supply.preorderID,
        detail?.warehouseName,
        detail?.actualWarehouseName,
        detail?.supplierAssignName,
        statusLabel(detail?.statusID ?? supply.statusID),
        supplyTypeLabel(detail, supply),
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [query, supplies]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Поставки</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Поставки WB: принятое количество и расшифровка по упаковке
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading || refreshing ? "animate-spin" : ""} />
          {loading || refreshing ? "Загрузка" : "Обновить"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Поставки Wildberries</h3>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {formatNumber(visibleSupplies.length)} из {formatNumber(supplies.length)} поставок
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 md:w-80">
            <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Номер, склад, статус"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead className="bg-[var(--bg)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Номер и тип</th>
                <th className="px-4 py-3 text-left font-medium">Дата поставки</th>
                <th className="px-4 py-3 text-left font-medium">Склад</th>
                <th className="px-4 py-3 text-center font-medium">Статус</th>
                <th className="px-4 py-3 text-center font-medium">Упаковано / принято</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    <RefreshCw size={18} className="mx-auto mb-3 animate-spin" />
                    Загружаю поставки и детали
                  </td>
                </tr>
              ) : visibleSupplies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    Поставки не найдены
                  </td>
                </tr>
              ) : (
                visibleSupplies.map((supply) => {
                  const detail = supply.detail;
                  const statusID = detail?.statusID ?? supply.statusID;
                  const supplyTypeText = supplyTypeLabel(detail, supply);
                  const hasSupplyID = Number.isSafeInteger(supply.supplyID);
                  const expanded = hasSupplyID && expandedID === supply.supplyID;
                  const supplyKey = hasSupplyID ? String(supply.supplyID) : `preorder:${supply.preorderID || "unknown"}`;
                  const packageData = hasSupplyID ? packageBySupply[String(supply.supplyID)] : undefined;
                  const packageIsLoading = hasSupplyID ? packageLoading[String(supply.supplyID)] : false;
                  const packageError = hasSupplyID ? packageErrors[String(supply.supplyID)] : "";

                  return (
                    <Fragment key={supplyKey}>
                      <tr
                        onClick={() => toggleSupply(supply.supplyID)}
                        className={`border-t border-[var(--border)] transition-colors ${hasSupplyID ? "cursor-pointer hover:bg-[var(--bg-card-hover)]" : "cursor-default"}`}
                      >
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            {hasSupplyID ? (
                              expanded ? <ChevronDown size={16} className="text-[var(--accent)]" /> : <ChevronRight size={16} className="text-[var(--text-muted)]" />
                            ) : (
                              <span className="h-4 w-4 shrink-0" />
                            )}
                            <div>
                              <div className="font-mono font-semibold text-white">
                                {hasSupplyID ? supply.supplyID : supply.preorderID ? `Заявка ${supply.preorderID}` : "-"}
                              </div>
                              <div className="text-xs text-[var(--text-muted)]">
                                {supplyTypeText}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="font-mono tabular-nums text-white">
                            {formatSupplyDateRange(detail?.supplyDate || supply.supplyDate, detail?.factDate || supply.factDate)}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="text-white">{detail?.actualWarehouseName || detail?.warehouseName || "-"}</div>
                          {supply.detailError && <div className="text-xs text-[var(--text-muted)]">{supply.detailError}</div>}
                        </td>
                        <td className="px-4 py-3 text-center align-middle">
                          <span className={`inline-flex min-w-24 justify-center rounded-full border px-3 py-1 text-xs font-medium ${statusBadgeClass(statusID)}`}>
                            {statusLabel(statusID)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center align-middle">
                          <div className="font-mono text-base font-semibold tabular-nums text-white">
                            {quantityPair(detail)}
                          </div>
                          <div className="text-xs text-[var(--text-muted)]">шт</div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-[var(--border)] bg-[var(--bg)]/45">
                          <td colSpan={5} className="px-4 py-4">
                            {packageIsLoading ? (
                              <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
                                <RefreshCw size={16} className="animate-spin" />
                                Загружаю упаковку
                              </div>
                            ) : packageError ? (
                              <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
                                <AlertCircle size={16} />
                                {packageError}
                              </div>
                            ) : packageData ? (
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                                  <PackageOpen size={15} className="text-[var(--accent)]" />
                                  {packageData.meta.source === "goods" ? (
                                    <>
                                      <span>{formatNumber(packageData.meta.totalQuantity)} шт в поставке</span>
                                      <span>·</span>
                                      <span>{formatNumber(packageData.meta.totalAcceptedQuantity || 0)} принято</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>{formatNumber(packageData.meta.packageCount)} коробов</span>
                                      <span>·</span>
                                      <span>{formatNumber(packageData.meta.totalQuantity)} шт в упаковке</span>
                                    </>
                                  )}
                                  <span>·</span>
                                  <span>{formatNumber(packageData.meta.articleCount)} артикулов</span>
                                  <span>·</span>
                                  <span>{formatNumber(packageData.meta.barcodeCount)} баркодов</span>
                                </div>
                                <div className="overflow-auto rounded-lg border border-[var(--border)]">
                                  <table className="w-full min-w-[720px] border-collapse text-xs">
                                    <thead className="bg-[var(--bg-card)] text-[var(--text-muted)]">
                                      <tr>
                                        <th className="px-3 py-2 text-left font-medium">Артикул</th>
                                        <th className="px-3 py-2 text-left font-medium">Баркоды и размеры</th>
                                        <th className="px-3 py-2 text-center font-medium">
                                          {packageData.meta.source === "goods" ? "В поставке / принято" : "Количество"}
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {packageData.articles.map((article) => (
                                        <tr key={`${article.articleWB}:${article.name}`} className="border-t border-[var(--border)]">
                                          <td className="px-3 py-3 align-top">
                                            <div className="font-mono text-sm font-semibold text-[var(--accent)]">{article.articleWB}</div>
                                            <div className="mt-1 max-w-sm text-[var(--text-muted)]">{article.name || "-"}</div>
                                          </td>
                                          <td className="px-3 py-3 align-top">
                                            <div className="grid gap-1.5">
                                              {article.barcodes.map((barcode) => (
                                                <div key={barcode.barcode} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                  <span className="font-mono text-white">{barcode.barcode}</span>
                                                  <span className="text-[var(--text-muted)]">{barcode.size || "-"}</span>
                                                  <span className="font-mono tabular-nums text-[var(--accent)]">
                                                    {packageData.meta.source === "goods"
                                                      ? `${formatNumber(barcode.quantity)} / ${formatNumber(barcode.acceptedQuantity || 0)} шт`
                                                      : `${formatNumber(barcode.quantity)} шт`}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </td>
                                          <td className="px-3 py-3 text-center align-top font-mono text-sm font-semibold tabular-nums text-white">
                                            {packageData.meta.source === "goods"
                                              ? `${formatNumber(article.quantity)} / ${formatNumber(article.acceptedQuantity || 0)}`
                                              : formatNumber(article.quantity)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
