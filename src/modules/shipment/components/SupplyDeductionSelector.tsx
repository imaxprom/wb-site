"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, PackageOpen, RefreshCw, Search } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { RegionConfig } from "@/types";
import type { ManualSupplyDeductByBarcode, ManualSupplyDeductionEntry } from "@/modules/shipment/lib/manual-supply-deductions";

interface SupplyDetail {
  statusID?: number;
  virtualTypeID?: number;
  boxTypeID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  warehouseName?: string;
  actualWarehouseName?: string;
  quantity?: number;
  packedQuantity?: number;
  acceptedQuantity?: number;
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

interface SupplyDeductionRegion {
  regionId: string;
  label: string;
  warehouseName: string;
}

export interface ManualSupplyDeductionData {
  supplies: SupplyRow[];
  loadingSupplies: boolean;
  suppliesError: string;
  packageBySupply: Record<string, SupplyPackageResponse>;
  packageLoading: Record<string, boolean>;
  packageErrors: Record<string, string>;
  deductByBarcode: ManualSupplyDeductByBarcode;
  selectedCount: number;
  totalQuantity: number;
  matchedQuantity: number;
  unmatchedQuantity: number;
  loadedSelectedCount: number;
  regionBySupply: Record<string, SupplyDeductionRegion | null>;
  refreshSupplies: () => void;
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
  return virtualTypeID === 5 ? "Допринято" : null;
}

function typeLabel(boxTypeID: number | undefined, isBoxOnPallet?: boolean) {
  if (boxTypeID === 2) return isBoxOnPallet ? "Короба на паллете" : "Короба";
  if (boxTypeID === 0) return "Без коробов";
  return boxTypeID === undefined ? "-" : `Тип ${boxTypeID}`;
}

function supplyTypeLabel(detail: SupplyDetail | null, supply: SupplyRow) {
  return virtualTypeLabel(detail?.virtualTypeID) || typeLabel(detail?.boxTypeID ?? supply.boxTypeID, detail?.isBoxOnPallet ?? supply.isBoxOnPallet);
}

function quantityPair(detail: SupplyDetail | null) {
  if (!detail) return "-";
  const packed = detail.packedQuantity ?? detail.quantity ?? 0;
  return `${formatNumber(packed)} / ${formatNumber(detail.acceptedQuantity || 0)}`;
}

function normalizeWarehouseName(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function warehouseAliasKeys(normalized: string) {
  const keys = new Set<string>();
  if (!normalized) return keys;

  keys.add(normalized);

  if (normalized.includes("новосемейкино") || normalized === "самара") {
    keys.add("самара");
    keys.add("новосемейкино");
    keys.add("самарановосемейкино");
  }

  if (normalized.includes("шушар")) {
    keys.add("шушары");
    keys.add("спбшушары");
    keys.add("сцшушары");
  }

  return keys;
}

function warehouseNamesMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftNormalized = normalizeWarehouseName(left);
  const rightNormalized = normalizeWarehouseName(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;

  const leftKeys = warehouseAliasKeys(leftNormalized);
  const rightKeys = warehouseAliasKeys(rightNormalized);
  for (const key of leftKeys) {
    if (rightKeys.has(key)) return true;
  }

  return (
    (leftNormalized.length >= 6 && rightNormalized.includes(leftNormalized)) ||
    (rightNormalized.length >= 6 && leftNormalized.includes(rightNormalized))
  );
}

function fallbackRegionIdsForWarehouse(warehouseName: string | null | undefined) {
  const normalized = normalizeWarehouseName(warehouseName);
  if (!normalized) return [];

  if (normalized.includes("новосемейкино") || normalized === "самара") return ["volga"];
  if (normalized.includes("шушар")) return ["central-nw", "central"];

  return [];
}

function findRegionIdForWarehouse(warehouseName: string | null | undefined, regionConfigs: RegionConfig[]) {
  return findRegionForWarehouse(warehouseName, regionConfigs)?.id || "";
}

function regionLabel(region: RegionConfig) {
  const known: Record<string, string> = {
    central: "ЦФО",
    south: "ЮФО",
    volga: "ПФО",
    ural: "УФО",
    "central-nw": "ЦФО+СЗФО",
    "south-caucasus": "ЮФО+СКФО",
    east: "УФО+СФО+ДФО",
  };
  return known[region.id] || region.shortName || region.name;
}

function findRegionForWarehouse(warehouseName: string | null | undefined, regionConfigs: RegionConfig[]) {
  const target = normalizeWarehouseName(warehouseName);
  if (!target) return null;

  for (const region of regionConfigs) {
    for (const warehouse of region.warehouses) {
      if (warehouseNamesMatch(warehouseName, warehouse)) {
        return region;
      }
    }
  }

  const fallbackIds = fallbackRegionIdsForWarehouse(warehouseName);
  if (fallbackIds.length) {
    const fallbackRegion = regionConfigs.find((region) => fallbackIds.includes(region.id));
    if (fallbackRegion) return fallbackRegion;
  }

  return null;
}

function buildRegionBySupply(supplies: SupplyRow[], regionConfigs: RegionConfig[]) {
  const result: Record<string, SupplyDeductionRegion | null> = {};
  for (const supply of supplies) {
    const supplyID = Number(supply.supplyID);
    if (!Number.isSafeInteger(supplyID)) continue;
    const warehouseName = supply.detail?.actualWarehouseName || supply.detail?.warehouseName || "";
    const region = findRegionForWarehouse(warehouseName, regionConfigs);
    result[String(supplyID)] = region
      ? { regionId: region.id, label: regionLabel(region), warehouseName }
      : null;
  }
  return result;
}

function buildDeductByBarcode(
  packages: Record<string, SupplyPackageResponse>,
  selectedSupplyIds: Set<number>,
  supplies: SupplyRow[],
  regionConfigs: RegionConfig[],
) {
  const map: ManualSupplyDeductByBarcode = new Map();
  const supplyById = new Map(supplies.map((supply) => [Number(supply.supplyID), supply]));
  let totalQuantity = 0;
  let matchedQuantity = 0;
  let unmatchedQuantity = 0;
  let loadedSelectedCount = 0;

  for (const supplyID of selectedSupplyIds) {
    const payload = packages[String(supplyID)];
    if (!payload) continue;
    loadedSelectedCount++;
    const supply = supplyById.get(supplyID);
    const warehouseName = supply?.detail?.actualWarehouseName || supply?.detail?.warehouseName || "";
    const regionId = findRegionIdForWarehouse(warehouseName, regionConfigs);

    for (const article of payload.articles || []) {
      for (const row of article.barcodes || []) {
        const barcode = String(row.barcode || "").trim();
        const qty = Number(row.quantity || 0);
        if (!barcode || qty <= 0) continue;

        const currentRaw = map.get(barcode);
        const current: ManualSupplyDeductionEntry = typeof currentRaw === "number"
          ? { total: currentRaw, byRegion: {} }
          : currentRaw || { total: 0, byRegion: {} };

        if (regionId) {
          current.total += qty;
          current.byRegion[regionId] = (current.byRegion[regionId] || 0) + qty;
          matchedQuantity += qty;
        } else {
          current.unmatched = (current.unmatched || 0) + qty;
          unmatchedQuantity += qty;
        }

        map.set(barcode, current);
        totalQuantity += qty;
      }
    }
  }

  return { map, totalQuantity, matchedQuantity, unmatchedQuantity, loadedSelectedCount };
}

export function useManualSupplyDeductionData(
  enabled: boolean,
  selectedSupplyIds: Set<number>,
  regionConfigs: RegionConfig[],
): ManualSupplyDeductionData {
  const [supplies, setSupplies] = useState<SupplyRow[]>([]);
  const [loadingSupplies, setLoadingSupplies] = useState(false);
  const [suppliesError, setSuppliesError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [packageBySupply, setPackageBySupply] = useState<Record<string, SupplyPackageResponse>>({});
  const [packageLoading, setPackageLoading] = useState<Record<string, boolean>>({});
  const [packageErrors, setPackageErrors] = useState<Record<string, string>>({});
  const selectedKey = useMemo(() => [...selectedSupplyIds].sort((a, b) => a - b).join(","), [selectedSupplyIds]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoadingSupplies(true);
    setSuppliesError("");

    fetch("/api/supplies?limit=50", { cache: "no-store" })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        return payload.supplies || [];
      })
      .then((rows: SupplyRow[]) => {
        if (!cancelled) setSupplies(rows.filter((row) => Number.isSafeInteger(row.supplyID)));
      })
      .catch((error) => {
        if (!cancelled) setSuppliesError(error instanceof Error ? error.message : "Не удалось загрузить поставки");
      })
      .finally(() => {
        if (!cancelled) setLoadingSupplies(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  useEffect(() => {
    if (!enabled) return;
    for (const supplyID of selectedSupplyIds) {
      const key = String(supplyID);
      if (packageBySupply[key] || packageLoading[key] || packageErrors[key]) continue;

      setPackageLoading((prev) => ({ ...prev, [key]: true }));
      setPackageErrors((prev) => ({ ...prev, [key]: "" }));
      fetch(`/api/supplies/${supplyID}/package`, { cache: "no-store" })
        .then(async (res) => {
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
          return payload as SupplyPackageResponse;
        })
        .then((payload) => setPackageBySupply((prev) => ({ ...prev, [key]: payload })))
        .catch((error) => {
          setPackageErrors((prev) => ({
            ...prev,
            [key]: error instanceof Error ? error.message : "Не удалось загрузить состав поставки",
          }));
        })
        .finally(() => setPackageLoading((prev) => ({ ...prev, [key]: false })));
    }
  }, [enabled, selectedKey, selectedSupplyIds, packageBySupply, packageLoading, packageErrors]);

  const totals = useMemo(
    () => buildDeductByBarcode(packageBySupply, selectedSupplyIds, supplies, regionConfigs),
    [packageBySupply, selectedSupplyIds, supplies, regionConfigs],
  );
  const regionBySupply = useMemo(
    () => buildRegionBySupply(supplies, regionConfigs),
    [supplies, regionConfigs],
  );

  return {
    supplies,
    loadingSupplies,
    suppliesError,
    packageBySupply,
    packageLoading,
    packageErrors,
    deductByBarcode: enabled ? totals.map : new Map(),
    selectedCount: enabled ? selectedSupplyIds.size : 0,
    totalQuantity: enabled ? totals.totalQuantity : 0,
    matchedQuantity: enabled ? totals.matchedQuantity : 0,
    unmatchedQuantity: enabled ? totals.unmatchedQuantity : 0,
    loadedSelectedCount: enabled ? totals.loadedSelectedCount : 0,
    regionBySupply,
    refreshSupplies: () => setRefreshKey((key) => key + 1),
  };
}

export function SupplyDeductionSelector({
  enabled,
  selectedSupplyIds,
  onEnabledChange,
  onSelectedSupplyIdsChange,
  data,
}: {
  enabled: boolean;
  selectedSupplyIds: Set<number>;
  onEnabledChange: (enabled: boolean) => void;
  onSelectedSupplyIdsChange: (ids: Set<number>) => void;
  data: ManualSupplyDeductionData;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);

  const visibleSupplies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data.supplies;
    return data.supplies.filter((supply) => {
      const detail = supply.detail;
      return [
        supply.supplyID,
        supply.preorderID,
        detail?.warehouseName,
        detail?.actualWarehouseName,
        statusLabel(detail?.statusID ?? supply.statusID),
        supplyTypeLabel(detail, supply),
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [data.supplies, query]);
  const selectedLoadingCount = useMemo(() => {
    return [...selectedSupplyIds].filter((supplyID) => data.packageLoading[String(supplyID)]).length;
  }, [data.packageLoading, selectedSupplyIds]);
  const selectedErrorCount = useMemo(() => {
    return [...selectedSupplyIds].filter((supplyID) => Boolean(data.packageErrors[String(supplyID)])).length;
  }, [data.packageErrors, selectedSupplyIds]);

  const toggleSupply = useCallback((supplyID: number) => {
    const next = new Set(selectedSupplyIds);
    if (next.has(supplyID)) next.delete(supplyID);
    else next.add(supplyID);
    onSelectedSupplyIdsChange(next);
  }, [onSelectedSupplyIdsChange, selectedSupplyIds]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <label className="flex cursor-pointer select-none items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block text-sm font-semibold text-white">Учитывать отгрузки</span>
            <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
              Выбранные поставки вычитаются по barcode только из ФО склада назначения.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1 text-[var(--text-muted)]">
            выбрано: <span className="font-semibold text-white">{formatNumber(data.selectedCount)}</span>
          </span>
          <span className="rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-3 py-1 text-[var(--accent-hover)]">
            вычитается: <span className="font-semibold text-white">{formatNumber(data.matchedQuantity)}</span> шт
          </span>
          {enabled && data.unmatchedQuantity > 0 && (
            <span className="rounded-full border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-3 py-1 text-[var(--warning)]">
              не сопоставлено: <span className="font-semibold text-white">{formatNumber(data.unmatchedQuantity)}</span> шт
            </span>
          )}
          {enabled && selectedLoadingCount > 0 && (
            <span className="rounded-full border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-3 py-1 text-[var(--warning)]">
              загружаю состав
            </span>
          )}
          {enabled && selectedErrorCount > 0 && (
            <span className="rounded-full border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-3 py-1 text-[var(--danger)]">
              ошибка состава: <span className="font-semibold text-white">{formatNumber(selectedErrorCount)}</span>
            </span>
          )}
        </div>
      </div>

      {enabled && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-white"
            >
              <ChevronDown size={16} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
              Последние поставки
            </button>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 md:w-72">
                <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Номер, склад, статус"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
              <button
                type="button"
                onClick={data.refreshSupplies}
                disabled={data.loadingSupplies}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={data.loadingSupplies ? "animate-spin" : ""} />
                Обновить
              </button>
            </div>
          </div>

          {data.suppliesError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
              <AlertCircle size={15} />
              {data.suppliesError}
            </div>
          )}

          {open && (
            <div className="max-h-80 overflow-auto rounded-lg border border-[var(--border)]">
              {data.loadingSupplies ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-[var(--text-muted)]">
                  <RefreshCw size={16} className="animate-spin" />
                  Загружаю поставки
                </div>
              ) : visibleSupplies.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Поставки не найдены</div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {visibleSupplies.map((supply) => {
                    const supplyID = Number(supply.supplyID);
                    const detail = supply.detail;
                    const statusID = detail?.statusID ?? supply.statusID;
                    const selected = selectedSupplyIds.has(supplyID);
                    const packageData = data.packageBySupply[String(supplyID)];
                    const packageLoading = data.packageLoading[String(supplyID)];
                    const packageError = data.packageErrors[String(supplyID)];
                    const supplyRegion = data.regionBySupply[String(supplyID)];

                    return (
                      <label
                        key={supplyID}
                        className={`flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-[var(--bg-card-hover)] ${selected ? "bg-[var(--accent)]/5" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSupply(supplyID)}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono text-sm font-semibold text-white">{supplyID}</span>
                            <span className="text-xs text-[var(--text-muted)]">{supplyTypeLabel(detail, supply)}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(statusID)}`}>
                              {statusLabel(statusID)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                            <span>{formatSupplyDateRange(detail?.supplyDate || supply.supplyDate, detail?.factDate || supply.factDate)}</span>
                            <span>{detail?.actualWarehouseName || detail?.warehouseName || "-"}</span>
                            <span className="font-mono text-white">{quantityPair(detail)} шт</span>
                            {packageData && (
                              <span className="inline-flex items-center gap-1 text-[var(--accent-hover)]">
                                <PackageOpen size={13} />
                                {formatNumber(packageData.meta.totalQuantity)} шт, {formatNumber(packageData.meta.barcodeCount)} баркодов
                              </span>
                            )}
                            {selected && packageData && supplyRegion && (
                              <span className="rounded-full border border-[var(--success)]/35 bg-[var(--success)]/10 px-2 py-0.5 text-[var(--success)]">
                                Вычитается из: <span className="font-semibold text-white">{supplyRegion.label}</span>
                              </span>
                            )}
                            {selected && packageData && !supplyRegion && (
                              <span className="rounded-full border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-2 py-0.5 text-[var(--warning)]">
                                ФО не найден, не вычитается
                              </span>
                            )}
                            {selected && packageLoading && <span className="text-[var(--warning)]">загружаю состав</span>}
                            {selected && packageError && <span className="text-[var(--danger)]">{packageError}</span>}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
