"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Search, Settings2, Truck, X } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { getWbImageUrlCandidates } from "@/lib/wb-image";

interface LogisticsProduct {
  articleWB: string;
  articleSeller: string;
  brand: string;
  category: string;
  size: string;
  barcode: string;
  volumeLiters: number | null;
  cardVolumeLiters: number | null;
  storageVolumeLiters: number | null;
  remainsVolumeLiters: number | null;
  measurementHistory: MeasurementEntry[];
  volumeSource: "card_dimensions" | "paid_storage" | null;
  dimensions: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  stockQty: number;
  localization: LocalizationMetrics | null;
}

interface LogisticsArticleRow {
  articleWB: string;
  articleSeller: string;
  brand: string;
  category: string;
  volumeLiters: number | null;
  cardVolumeLiters: number | null;
  storageVolumeLiters: number | null;
  remainsVolumeLiters: number | null;
  measurementHistory: MeasurementEntry[];
  volumeSource: "card_dimensions" | "paid_storage" | null;
  dimensions: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  stockQty: number;
  variants: number;
  missingVolumeVariants: number;
  localization: LocalizationMetrics | null;
}

interface LogisticsWarehouse {
  warehouseName: string;
  geoName: string;
  deliveryCoefPercent: number | null;
  storageCoefPercent: number | null;
  deliveryBase: number | null;
  deliveryLiter: number | null;
  storageBase: number | null;
  storageLiter: number | null;
  salesQty: number;
}

interface MeasurementEntry {
  dimId: number;
  volumeLiters: number | null;
  dimensions: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  measuredAt: string;
}

interface ProductsResponse {
  products: LogisticsProduct[];
  meta: {
    total: number;
    withVolume: number;
    withCardDimensions: number;
    withStorageVolume: number;
    withRemainsVolume: number;
    withMeasurements?: number;
    volumeSource: string;
    fallbackVolumeSource: string;
    remainsVolumeSource?: string;
    measurementsSource?: string;
    localization?: LocalizationMeta | null;
  };
}

interface LocalizationMetrics {
  orderQty: number;
  localOrderQty: number;
  localizationSharePercent: number;
  localizationIndex: number;
  salesDistributionIndexPercent: number;
  unmappedWarehouseQty: number;
  tariffOrderQty?: number;
  tariffLocalOrderQty?: number;
  tariffLocalizationSharePercent?: number;
}

interface LocalizationMeta {
  orderWindowDays: number;
  orderWindowStartDate: string;
  orderWindowEndDate: string;
  eligibleOrderQty: number;
  localOrderQty: number;
  localizationSharePercent: number;
  tariffEligibleOrderQty?: number;
  tariffLocalOrderQty?: number;
  tariffLocalizationSharePercent?: number;
  localizationIndex: number;
  localizationIndexRaw?: number;
  salesDistributionIndexPercent: number;
  salesDistributionIndexPercentRaw?: number;
  unmappedWarehouseOrderQty: number;
  tariffUnmappedWarehouseOrderQty?: number;
  excludedForeignOrderQty?: number;
  exceptionOrderQty: number;
  model: string;
  ktrSource: string;
  krpSource: string;
}

interface TariffsResponse {
  date: string;
  effectiveDate?: string;
  cargoType: "box" | "pallet";
  source: "wb" | "cache";
  syncedAt: string;
  salesWindowDays: number;
  dtNext: string | null;
  dtTillMax: string | null;
  warning?: string;
  warehouses: LogisticsWarehouse[];
}

type CargoType = "box" | "pallet";

const WAREHOUSE_LIMIT_OPTIONS = [6, 10, 16, 24];
const NEW_MEASUREMENT_DAYS = 7;

function LogisticsProductThumb({ articleWB }: { articleWB: string }) {
  const candidates = useMemo(
    () => getWbImageUrlCandidates(articleWB, "small"),
    [articleWB],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [articleWB]);

  if (!candidates[index]) {
    return <div className="h-32 w-24 shrink-0 rounded-lg bg-[var(--border)]" />;
  }

  return (
    <img
      src={candidates[index]}
      alt=""
      width={96}
      height={128}
      className="h-32 w-24 shrink-0 rounded-lg object-cover"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function todayMsk(): string {
  const dt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

function rub(value: number): string {
  return `${formatNumber(Math.round(value * 100) / 100, value % 1 === 0 ? 0 : 2)} ₽`;
}

function liters(value: number | null): string {
  if (!value || value <= 0) return "нет объёма";
  return `${formatNumber(Math.round(value * 1000) / 1000, value >= 10 ? 1 : 3)} л`;
}

function measurementDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function dimensionsLine(dimensions: MeasurementEntry["dimensions"]): string {
  const length = dimensions.lengthCm || 0;
  const width = dimensions.widthCm || 0;
  const height = dimensions.heightCm || 0;
  if (length <= 0 || width <= 0 || height <= 0) return "";
  return `${formatNumber(length, 1)}x${formatNumber(width, 1)}x${formatNumber(height, 1)} см`;
}

function mergeMeasurements(current: MeasurementEntry[], next: MeasurementEntry[]): MeasurementEntry[] {
  const byKey = new Map<string, MeasurementEntry>();
  for (const item of [...current, ...next]) {
    const key = `${item.dimId}:${item.measuredAt}`;
    byKey.set(key, item);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const byDate = new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime();
    if (Number.isNaN(byDate) || byDate === 0) return a.dimId - b.dimId;
    return byDate;
  });
}

function coef(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${formatNumber(value, value % 1 === 0 ? 0 : 1)}%`;
}

function compactNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return formatNumber(value, value % 1 === 0 ? 0 : digits);
}

function fixedNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatNumber(value, value % 1 === 0 ? 0 : digits)}%`;
}

function calcDelivery(volume: number | null, warehouse: LogisticsWarehouse): number | null {
  if (!volume || volume <= 0) return null;

  const base = warehouse.deliveryBase;
  const liter = warehouse.deliveryLiter;

  if (base === null) return null;
  return base + Math.max(volume - 1, 0) * (liter || 0);
}

function calcStorage(volume: number | null, warehouse: LogisticsWarehouse): number | null {
  if (!volume || volume <= 0 || warehouse.storageBase === null) return null;
  return warehouse.storageBase + Math.max(volume - 1, 0) * (warehouse.storageLiter || 0);
}

function cellTone(value: number | null, rowValues: (number | null)[]): string {
  if (value === null) return "bg-[var(--bg)]/50 text-[var(--text-muted)]";
  const values = rowValues.filter((v): v is number => v !== null);
  if (values.length < 2) return "bg-[var(--bg-card)]";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (value === min) return "bg-[var(--success)]/10 text-[var(--success)]";
  if (value === max) return "bg-[var(--danger)]/10 text-[var(--danger)]";
  return "bg-[var(--bg-card)]";
}

function latestMeasurement(measurements: MeasurementEntry[]): MeasurementEntry | null {
  for (let index = measurements.length - 1; index >= 0; index -= 1) {
    const measurement = measurements[index];
    if (measurement.volumeLiters && measurement.volumeLiters > 0) return measurement;
  }
  return null;
}

function latestMeasurementVolume(measurements: MeasurementEntry[]): number | null {
  return latestMeasurement(measurements)?.volumeLiters || null;
}

function isCriticalMeasurement(row: Pick<LogisticsArticleRow, "cardVolumeLiters" | "remainsVolumeLiters" | "measurementHistory">): boolean {
  const measuredVolume = latestMeasurementVolume(row.measurementHistory);
  if (!row.cardVolumeLiters || !measuredVolume || measuredVolume <= row.cardVolumeLiters) return false;
  return !row.remainsVolumeLiters || row.remainsVolumeLiters > row.cardVolumeLiters;
}

function measurementDeltaLiters(row: Pick<LogisticsArticleRow, "cardVolumeLiters" | "remainsVolumeLiters" | "measurementHistory">): number {
  if (!isCriticalMeasurement(row)) return 0;
  const measuredVolume = latestMeasurementVolume(row.measurementHistory);
  if (!row.cardVolumeLiters || !measuredVolume) return 0;
  return measuredVolume - row.cardVolumeLiters;
}

function isRecentMeasurement(measurement: MeasurementEntry | null): boolean {
  if (!measurement?.measuredAt) return false;
  const measuredAt = new Date(measurement.measuredAt).getTime();
  if (Number.isNaN(measuredAt)) return false;
  return Date.now() - measuredAt <= NEW_MEASUREMENT_DAYS * 24 * 60 * 60 * 1000;
}

export default function LogisticsPage() {
  const [date, setDate] = useState(todayMsk());
  const [cargoType, setCargoType] = useState<CargoType>("box");
  const [query, setQuery] = useState("");
  const [warehouseQuery, setWarehouseQuery] = useState("");
  const [warehouseLimit, setWarehouseLimit] = useState(10);
  const [selectedWarehouseNames, setSelectedWarehouseNames] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showWarehouseSettings, setShowWarehouseSettings] = useState(false);
  const [measurementFilter, setMeasurementFilter] = useState<"all" | "new">("all");
  const [productsData, setProductsData] = useState<ProductsResponse | null>(null);
  const [tariffsData, setTariffsData] = useState<TariffsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData(refreshTariffs = false) {
    setError(null);
    if (refreshTariffs) setRefreshing(true);
    else setLoading(true);

    try {
      const [productsRes, tariffsRes] = await Promise.all([
        fetch("/api/logistics/products"),
        fetch(`/api/logistics/tariffs?date=${encodeURIComponent(date)}&cargoType=${cargoType}${refreshTariffs ? "&refresh=1" : ""}`),
      ]);

      if (!productsRes.ok) throw new Error(`Товары: HTTP ${productsRes.status}`);
      if (!tariffsRes.ok) {
        const body = await tariffsRes.json().catch(() => null);
        throw new Error(body?.error || `Тарифы: HTTP ${tariffsRes.status}`);
      }

      setProductsData(await productsRes.json());
      setTariffsData(await tariffsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData(false);
  }, [date, cargoType]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((settings: { logisticsSelectedWarehouseNames?: unknown; logisticsWarehouseLimit?: unknown }) => {
        if (cancelled) return;

        const names = Array.isArray(settings.logisticsSelectedWarehouseNames)
          ? settings.logisticsSelectedWarehouseNames.filter((value): value is string => typeof value === "string")
          : [];
        const limit = Number(settings.logisticsWarehouseLimit);

        setSelectedWarehouseNames(names);
        setWarehouseLimit(WAREHOUSE_LIMIT_OPTIONS.includes(limit) ? limit : 10);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logisticsSelectedWarehouseNames: selectedWarehouseNames,
        logisticsWarehouseLimit: warehouseLimit,
      }),
    }).catch(() => undefined);
  }, [settingsLoaded, selectedWarehouseNames, warehouseLimit]);

  const allWarehouses = useMemo(() => {
    return [...(tariffsData?.warehouses || [])].sort((a, b) => {
      if (a.salesQty !== b.salesQty) return b.salesQty - a.salesQty;
      return a.warehouseName.localeCompare(b.warehouseName, "ru");
    });
  }, [tariffsData]);

  const warehouseOptions = useMemo(() => {
    const q = warehouseQuery.trim().toLowerCase();
    return q
      ? allWarehouses.filter((warehouse) =>
        warehouse.warehouseName.toLowerCase().includes(q) ||
        warehouse.geoName.toLowerCase().includes(q)
      )
      : allWarehouses;
  }, [allWarehouses, warehouseQuery]);

  const warehouses = useMemo(() => {
    if (selectedWarehouseNames.length > 0) {
      const byName = new Map(allWarehouses.map((warehouse) => [warehouse.warehouseName, warehouse]));
      return selectedWarehouseNames
        .map((name) => byName.get(name))
        .filter((warehouse): warehouse is LogisticsWarehouse => Boolean(warehouse));
    }
    return allWarehouses.slice(0, warehouseLimit);
  }, [allWarehouses, selectedWarehouseNames, warehouseLimit]);

  const allArticleRows = useMemo(() => {
    const source = productsData?.products || [];
    const byArticle = new Map<string, LogisticsArticleRow>();

    for (const row of source) {
      const key = row.articleWB || row.articleSeller;
      const current = byArticle.get(key);
      if (!current) {
        byArticle.set(key, {
          articleWB: row.articleWB,
          articleSeller: row.articleSeller,
          brand: row.brand,
          category: row.category,
          volumeLiters: row.volumeLiters,
          cardVolumeLiters: row.cardVolumeLiters,
          storageVolumeLiters: row.storageVolumeLiters,
          remainsVolumeLiters: row.remainsVolumeLiters,
          measurementHistory: row.measurementHistory || [],
          volumeSource: row.volumeSource,
          dimensions: row.dimensions,
          stockQty: row.stockQty,
          variants: 1,
          missingVolumeVariants: row.volumeLiters ? 0 : 1,
          localization: row.localization,
        });
        continue;
      }

      current.stockQty += row.stockQty;
      current.variants += 1;
      if (!row.volumeLiters) current.missingVolumeVariants += 1;
      if (!current.volumeLiters && row.volumeLiters) {
        current.volumeLiters = row.volumeLiters;
        current.volumeSource = row.volumeSource;
        current.dimensions = row.dimensions;
      } else if (current.volumeLiters && row.volumeLiters) {
        if (row.volumeLiters > current.volumeLiters) {
          current.volumeLiters = row.volumeLiters;
          current.volumeSource = row.volumeSource;
          current.dimensions = row.dimensions;
        }
      }
      if (!current.cardVolumeLiters && row.cardVolumeLiters) current.cardVolumeLiters = row.cardVolumeLiters;
      if (row.storageVolumeLiters && (!current.storageVolumeLiters || row.storageVolumeLiters > current.storageVolumeLiters)) {
        current.storageVolumeLiters = row.storageVolumeLiters;
      }
      if (row.remainsVolumeLiters && (!current.remainsVolumeLiters || row.remainsVolumeLiters > current.remainsVolumeLiters)) {
        current.remainsVolumeLiters = row.remainsVolumeLiters;
      }
      current.measurementHistory = mergeMeasurements(current.measurementHistory, row.measurementHistory || []);
      if (!current.localization && row.localization) current.localization = row.localization;
    }

    return Array.from(byArticle.values());
  }, [productsData]);

  const measurementSummary = useMemo(() => {
    let newCount = 0;
    let criticalCount = 0;

    for (const row of allArticleRows) {
      const latest = latestMeasurement(row.measurementHistory);
      if (isRecentMeasurement(latest)) newCount++;
      if (isCriticalMeasurement(row)) criticalCount++;
    }

    return { newCount, criticalCount };
  }, [allArticleRows]);

  const products = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allArticleRows.filter((row) => {
      const matchesQuery = !q ||
        row.articleSeller.toLowerCase().includes(q) ||
        row.articleWB.includes(q) ||
        row.brand.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (measurementFilter === "new") return isRecentMeasurement(latestMeasurement(row.measurementHistory));
      return true;
    });

    return filtered
      .sort((a, b) => {
        const criticalDelta = measurementDeltaLiters(b) - measurementDeltaLiters(a);
        if (criticalDelta !== 0) return criticalDelta;
        if ((a.volumeLiters === null) !== (b.volumeLiters === null)) return a.volumeLiters === null ? 1 : -1;
        const stock = b.stockQty - a.stockQty;
        if (stock !== 0) return stock;
        return a.articleSeller.localeCompare(b.articleSeller, "ru");
      })
      .slice(0, 120);
  }, [allArticleRows, measurementFilter, query]);

  const localizationMeta = productsData?.meta.localization || null;
  const tariffOrderQty = localizationMeta?.tariffEligibleOrderQty ?? localizationMeta?.eligibleOrderQty ?? 0;
  const tariffLocalOrderQty = localizationMeta?.tariffLocalOrderQty ?? localizationMeta?.localOrderQty ?? 0;
  const tariffLocalizationSharePercent = localizationMeta?.tariffLocalizationSharePercent ?? localizationMeta?.localizationSharePercent ?? 0;

  function toggleWarehouse(name: string) {
    setSelectedWarehouseNames((prev) => {
      if (prev.includes(name)) return prev.filter((item) => item !== name);
      return [...prev, name];
    });
  }

  function removeSelectedWarehouse(name: string) {
    setSelectedWarehouseNames((prev) => prev.filter((item) => item !== name));
  }

  function resetWarehouseSelection() {
    setSelectedWarehouseNames([]);
    setWarehouseQuery("");
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--text-muted)]">
        Загрузка расчёта логистики...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Truck size={18} aria-hidden="true" />
            <span className="text-sm">WB тарифы складов</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold">Расчёт логистики</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Матрица стоимости по артикулам и складам. Объём рассчитывается из длины, ширины и высоты карточки товара.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={cargoType}
            onChange={(event) => setCargoType(event.target.value as CargoType)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="box">Короба</option>
            <option value="pallet">Паллеты</option>
          </select>
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            Обновить WB
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {!error && tariffsData?.warning && (
        <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-sm text-[var(--warning)]">
          {tariffsData.warning}
        </div>
      )}

      {localizationMeta && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Индекс локализации</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {fixedNumber(localizationMeta.localizationIndex, 2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              РФ-локальность {percent(tariffLocalizationSharePercent, 1)}
              {localizationMeta.localizationIndexRaw !== undefined ? ` · точно ${compactNumber(localizationMeta.localizationIndexRaw, 4)}` : ""}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Индекс распределения продаж</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {percent(localizationMeta.salesDistributionIndexPercent, 2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              оценка по РФ-заказам
              {localizationMeta.salesDistributionIndexPercentRaw !== undefined ? ` · точно ${percent(localizationMeta.salesDistributionIndexPercentRaw, 4)}` : ""}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Заказы в расчёте</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {formatNumber(tariffOrderQty)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              РФ локальных {formatNumber(tariffLocalOrderQty)} · {localizationMeta.orderWindowStartDate} — {localizationMeta.orderWindowEndDate}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Локальность отчёта WB</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {percent(localizationMeta.localizationSharePercent, 1)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {formatNumber(localizationMeta.localOrderQty)}/{formatNumber(localizationMeta.eligibleOrderQty)} локальных, включая СНГ
            </p>
          </div>
        </div>
      )}

      {(measurementSummary.newCount > 0 || measurementSummary.criticalCount > 0) && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-2 text-[var(--text)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#42A5F5]" aria-hidden="true" />
              Новые замеры WB: <span className="font-semibold tabular-nums">{measurementSummary.newCount}</span> за {NEW_MEASUREMENT_DAYS} дней
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className={measurementSummary.criticalCount > 0 ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>
              критичных: <span className="font-semibold tabular-nums">{measurementSummary.criticalCount}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMeasurementFilter((value) => value === "new" ? "all" : "new")}
            className={
              "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors " +
              (measurementFilter === "new"
                ? "border-[#42A5F5]/60 bg-[#42A5F5]/15 text-[#90CAF9]"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--bg-card-hover)]")
            }
          >
            {measurementFilter === "new" ? "Показать все" : "Посмотреть новые"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowWarehouseSettings((value) => !value)}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-card-hover)]"
        >
          <Settings2 size={16} aria-hidden="true" />
          Склады
          {selectedWarehouseNames.length > 0 && (
            <span className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-xs text-[var(--accent)]">
              {selectedWarehouseNames.length}
            </span>
          )}
        </button>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>Колонок складов</span>
          <select
            value={warehouseLimit}
            onChange={(event) => setWarehouseLimit(Number(event.target.value))}
            disabled={selectedWarehouseNames.length > 0}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value={6}>6</option>
            <option value={10}>10</option>
            <option value={16}>16</option>
            <option value={24}>24</option>
          </select>
        </label>
      </div>

      {showWarehouseSettings && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Настройка складов
              </h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Если ничего не выбрано, показываются топ-склады по заказам за последние {tariffsData?.salesWindowDays || 90} дней. Выбранные вручную склады сохраняются в настройках пользователя и показываются вместо авто-списка.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedWarehouseNames(allWarehouses.slice(0, warehouseLimit).map((warehouse) => warehouse.warehouseName))}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
              >
                Выбрать топ {warehouseLimit}
              </button>
              <button
                type="button"
                onClick={resetWarehouseSelection}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]"
              >
                Авто по заказам
              </button>
            </div>
          </div>

          {selectedWarehouseNames.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedWarehouseNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => removeSelectedWarehouse(name)}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-xs text-[var(--accent)]"
                  title="Убрать склад из таблицы"
                >
                  {name}
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          <div className="relative mt-4">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              value={warehouseQuery}
              onChange={(event) => setWarehouseQuery(event.target.value)}
              placeholder="Найти склад: Рязань, Коледино, Подольск..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="mt-4 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {warehouseOptions.map((warehouse) => {
              const checked = selectedWarehouseNames.includes(warehouse.warehouseName);
              return (
                <button
                  key={warehouse.warehouseName}
                  type="button"
                  onClick={() => toggleWarehouse(warehouse.warehouseName)}
                  className={
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors " +
                    (checked
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]"
                      : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]")
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate">{warehouse.warehouseName}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      заказы: {formatNumber(warehouse.salesQty)} · лог. {coef(warehouse.deliveryCoefPercent)}
                    </span>
                  </span>
                  {checked && <Check size={16} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="data-table-wrapper max-h-[70vh]">
          <table className="data-table logistics-table min-w-[1720px]">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[250px] bg-[var(--bg-card)]">Артикул</th>
                <th className="num min-w-[112px]">Объём из карточки</th>
                <th className="num min-w-[132px]">Объём из отчёта остатков</th>
                <th className="min-w-[190px] text-center">Замеры</th>
                <th className="num min-w-[76px]">Остаток</th>
                <th className="num min-w-[90px]">ИЛ</th>
                <th className="num min-w-[90px]">ИРП</th>
                {warehouses.map((warehouse) => (
                  <th key={warehouse.warehouseName} className="min-w-[154px] text-left">
                    <div className="space-y-1.5">
                      <p className="whitespace-normal text-sm leading-4 text-[var(--text)]" title={warehouse.warehouseName}>
                        {warehouse.warehouseName}
                      </p>
                      <p className="text-xs normal-case tracking-normal text-[var(--text-muted)]">
                        лог. {coef(warehouse.deliveryCoefPercent)}
                      </p>
                      <p className="text-xs normal-case tracking-normal text-[var(--text-muted)]">
                        хран. {coef(warehouse.storageCoefPercent)}
                      </p>
                      <p className="text-xs normal-case tracking-normal text-[var(--text-muted)]">
                        зак. {formatNumber(warehouse.salesQty)}
                      </p>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const deliveryValues = warehouses.map((warehouse) => calcDelivery(product.volumeLiters, warehouse));
                const measurementOverCard = isCriticalMeasurement(product);
                return (
                  <tr key={product.articleWB || product.articleSeller}>
                    <td className="sticky left-0 z-10 min-w-[250px] bg-[var(--bg-card)] align-middle">
                      <div className="flex items-center gap-3">
                        <LogisticsProductThumb articleWB={product.articleWB} />
                        <div className="min-w-0">
                          <p className="break-words font-mono text-sm leading-5 text-[var(--accent)]">
                            {product.articleSeller || "—"}
                          </p>
                          <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">WB {product.articleWB}</p>
                        </div>
                      </div>
                    </td>
                    <td className="num tabular-nums align-middle">
                      <div>
                        <span className={(product.cardVolumeLiters ? "text-[var(--text)]" : "text-[var(--warning)]") + " block leading-5"}>
                          {liters(product.cardVolumeLiters)}
                        </span>
                        {product.cardVolumeLiters && (
                          <span className="mt-1 block text-xs leading-4 text-[var(--text-muted)]">
                            {formatNumber(product.dimensions.lengthCm, 1)}x{formatNumber(product.dimensions.widthCm, 1)}x{formatNumber(product.dimensions.heightCm, 1)} см
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num tabular-nums align-middle">
                      <span className={(product.remainsVolumeLiters ? "text-[var(--text)]" : "text-[var(--text-muted)]") + " block leading-5"}>
                        {product.remainsVolumeLiters ? liters(product.remainsVolumeLiters) : "—"}
                      </span>
                    </td>
                    <td className={"align-middle " + (measurementOverCard ? "bg-[var(--danger)]/10" : "")}>
                      {product.measurementHistory.length > 0 ? (
                        <div className="space-y-1.5 text-center">
                          {product.measurementHistory.slice(-3).map((measurement) => {
                            const dimensions = dimensionsLine(measurement.dimensions);
                            const isNewMeasurement = isRecentMeasurement(measurement);
                            return (
                              <div key={`${measurement.dimId}:${measurement.measuredAt}`} className="border-b border-[var(--border)]/60 pb-1.5 last:border-b-0 last:pb-0">
                                <div className="flex items-center justify-center gap-1.5 text-sm leading-5 tabular-nums text-[var(--text)]">
                                  <span>{measurement.volumeLiters ? liters(measurement.volumeLiters) : "—"}</span>
                                  {isNewMeasurement && (
                                    <span className="rounded-full border border-[#42A5F5]/40 bg-[#42A5F5]/15 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#90CAF9]">
                                      NEW
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs leading-4 tabular-nums text-[var(--text-muted)]">
                                  {measurementDate(measurement.measuredAt)}
                                  {dimensions ? ` · ${dimensions}` : ""}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="block text-xs leading-5 text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="num tabular-nums align-middle">{formatNumber(product.stockQty)}</td>
                    <td className="num tabular-nums align-middle">
                      {product.localization ? (
                        <div>
                          <span className="block leading-5 text-[var(--text)]">
                            {compactNumber(product.localization.localizationIndex, 2)}
                          </span>
                          <span className="mt-1 block text-xs leading-4 text-[var(--text-muted)]">
                            РФ {percent(product.localization.tariffLocalizationSharePercent, 1)}
                          </span>
                          <span className="block text-[10px] leading-4 text-[var(--text-muted)]">
                            отчёт {percent(product.localization.localizationSharePercent, 1)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="num tabular-nums align-middle">
                      {product.localization ? (
                        <div>
                          <span className="block leading-5 text-[var(--text)]">
                            {percent(product.localization.salesDistributionIndexPercent, 2)}
                          </span>
                          <span className="mt-1 block text-xs leading-4 text-[var(--text-muted)]">
                            РФ {formatNumber(product.localization.tariffLocalOrderQty || 0)}/{formatNumber(product.localization.tariffOrderQty || 0)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    {warehouses.map((warehouse, index) => {
                      const delivery = deliveryValues[index];
                      const storage = calcStorage(product.volumeLiters, warehouse);
                      return (
                        <td key={`${product.articleWB}:${warehouse.warehouseName}`} className={cellTone(delivery, deliveryValues)}>
                          {delivery === null ? (
                            <span className="text-xs text-[var(--text-muted)]">нет расчёта</span>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-lg font-bold tabular-nums">{rub(delivery)}</p>
                              <p className="text-sm text-[var(--text-muted)]">хранение {storage === null ? "—" : rub(storage)}/день</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                1 л: {warehouse.deliveryBase === null ? "—" : rub(warehouse.deliveryBase)}
                                {warehouse.deliveryLiter !== null ? ` · доп. ${rub(warehouse.deliveryLiter)}` : ""}
                              </p>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={7 + warehouses.length} className="py-10 text-center text-[var(--text-muted)]">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
