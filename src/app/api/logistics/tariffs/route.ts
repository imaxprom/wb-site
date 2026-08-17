import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getWbApiKey } from "@/lib/wb-api-key";
import { isPostgresReadonlyConnection, pgGet, pgRows } from "@/lib/postgres";

const ORDER_WINDOW_DAYS = 90;

interface TariffCacheRow {
  date: string;
  cargo_type: string;
  payload_json: string;
  synced_at: string;
}

interface WbAcceptanceRow {
  date?: string;
  coefficient?: number;
  warehouseID?: number;
  warehouseName?: string;
  allowUnload?: boolean;
  boxTypeID?: number;
  storageCoef?: string | number | null;
  deliveryCoef?: string | number | null;
  deliveryBaseLiter?: string | number | null;
  deliveryAdditionalLiter?: string | number | null;
  storageBaseLiter?: string | number | null;
  storageAdditionalLiter?: string | number | null;
  isSortingCenter?: boolean;
}

interface WbTariffsResponse {
  response?: {
    data?: {
      dtNextBox?: string;
      dtNextPallet?: string;
      dtTillMax?: string;
      warehouseList?: unknown[];
    };
  };
}

interface WarehouseOrderRow {
  warehouse: string;
  order_qty: number;
}

interface SalesMaps {
  exact: Map<string, number>;
  family: Map<string, number>;
}

function todayMsk(): string {
  const dt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

async function readCachePg(date: string, cargoType: string): Promise<TariffCacheRow | null> {
  try {
    const row = await pgGet<TariffCacheRow>(`
      SELECT date, cargo_type, payload_json, synced_at
      FROM logistics_tariff_cache
      WHERE date = ? AND cargo_type = ?
    `, [date, cargoType]);
    return row || null;
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return null;
    throw error;
  }
}

async function readLatestCachePg(date: string, cargoType: string): Promise<TariffCacheRow | null> {
  try {
    const row = await pgGet<TariffCacheRow>(`
      SELECT date, cargo_type, payload_json, synced_at
      FROM logistics_tariff_cache
      WHERE date <= ? AND cargo_type = ?
      ORDER BY date DESC
      LIMIT 1
    `, [date, cargoType]);
    return row || null;
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return null;
    throw error;
  }
}

function parseCachedPayload<T>(row: TariffCacheRow): T {
  return (typeof row.payload_json === "string"
    ? JSON.parse(row.payload_json)
    : row.payload_json) as T;
}

async function writeCachePg(date: string, cargoType: string, payload: unknown): Promise<void> {
  if (isPostgresReadonlyConnection()) return;

  await pgGet(`
    INSERT INTO logistics_tariff_cache (date, cargo_type, payload_json, synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, cargo_type) DO UPDATE SET
      payload_json = EXCLUDED.payload_json,
      synced_at = EXCLUDED.synced_at
    RETURNING date
  `, [date, cargoType, JSON.stringify(payload), new Date().toISOString()]);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = num(row[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeWarehouseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getWarehouseFamilyKey(value: string): string {
  const normalized = normalizeWarehouseName(value);

  if (normalized.includes("новосемейкино")) return "самара";
  if (normalized.includes("шушар")) return "шушары";
  if (normalized.includes("спб") || normalized.includes("санкт петербург")) return "санкт петербург";

  const knownFamilies = [
    "рязань",
    "екатеринбург",
    "самара",
    "невинномысск",
    "коледино",
    "тула",
    "электросталь",
    "краснодар",
    "подольск",
    "казань",
    "котовск",
    "сарапул",
    "владимир",
    "волгоград",
    "воронеж",
    "новосибирск",
    "пенза",
    "владивосток",
    "астана",
    "белая дача",
    "атакент",
    "актобе",
    "ереван",
    "ташкент",
    "красноярск",
    "калининград",
    "тверь",
    "вешки",
    "домодедово",
    "пермь",
    "радумля",
    "пушкино",
    "ногинск",
    "сургут",
    "петрозаводск",
    "уфа",
    "минск",
    "ростов",
    "ульяновск",
    "гродно",
    "гомель",
    "брест",
    "орша",
    "нижнекамск",
    "истра",
    "улан удэ",
    "тюмень",
    "старый оскол",
    "махачкала",
    "бийск",
    "архангельск",
  ];

  const family = knownFamilies.find((item) => normalized.includes(item));
  if (family) return family;

  return normalized
    .replace(/^(сц|ск|склад)\s+/g, "")
    .replace(/\bсгт\b/g, "")
    .replace(/\bмп\b/g, "")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");
}

function getWarehouseSales(rowName: string, salesByWarehouse: SalesMaps) {
  const exactSalesQty = salesByWarehouse.exact.get(normalizeWarehouseName(rowName)) || 0;
  const familySalesQty = salesByWarehouse.family.get(getWarehouseFamilyKey(rowName)) || 0;
  const salesQty = exactSalesQty > 0 ? exactSalesQty : familySalesQty;
  return { salesQty, exactSalesQty, familySalesQty };
}

function fallbackOwnerRank(warehouseName: string): number {
  const normalized = normalizeWarehouseName(warehouseName);
  let rank = 0;
  if (normalized.startsWith("склад ")) rank -= 5;
  if (normalized.startsWith("сц ")) rank += 100;
  if (normalized.includes(" сгт") || normalized.endsWith("сгт")) rank += 60;
  if (normalized.includes("питание") || normalized.includes("горючее")) rank += 40;
  if (warehouseName.includes(":")) rank += 20;
  return rank;
}

function hasTariffValues(row: Record<string, unknown>): boolean {
  return row.deliveryCoefPercent !== null && row.deliveryCoefPercent !== undefined
    || row.storageCoefPercent !== null && row.storageCoefPercent !== undefined
    || row.deliveryBase !== null && row.deliveryBase !== undefined
    || row.storageBase !== null && row.storageBase !== undefined;
}

async function getSalesByWarehousePg(): Promise<SalesMaps> {
  const rows = await pgRows<WarehouseOrderRow>(`
    WITH latest AS (
      SELECT MAX(SUBSTR(date, 1, 10)) AS max_order_date
      FROM shipment_orders
    ),
    orders AS (
      SELECT
        TRIM(COALESCE(warehouse, '')) AS warehouse,
        SUBSTR(date, 1, 10) AS order_date
      FROM shipment_orders
      WHERE TRIM(COALESCE(warehouse, '')) != ''
    )
    SELECT warehouse, COUNT(*) AS order_qty
    FROM orders, latest
    WHERE latest.max_order_date IS NOT NULL
      AND order_date::date >= latest.max_order_date::date - (? || ' days')::interval
    GROUP BY warehouse
  `, [ORDER_WINDOW_DAYS]);

  const exact = new Map<string, number>();
  const family = new Map<string, number>();
  for (const row of rows) {
    const qty = Number(row.order_qty) || 0;
    if (qty <= 0) continue;
    const exactKey = normalizeWarehouseName(row.warehouse);
    const familyKey = getWarehouseFamilyKey(row.warehouse);
    exact.set(exactKey, (exact.get(exactKey) || 0) + qty);
    family.set(familyKey, (family.get(familyKey) || 0) + qty);
  }
  return { exact, family };
}

function normalizeWarehouse(row: unknown, cargoType: "box" | "pallet") {
  const source = row && typeof row === "object" ? row as Record<string, unknown> : {};
  if (cargoType === "pallet") {
    return {
      warehouseName: text(source.warehouseName),
      geoName: text(source.geoName),
      deliveryCoefPercent: pickNumber(source, ["palletDeliveryExpr"]),
      storageCoefPercent: pickNumber(source, ["palletStorageExpr"]),
      deliveryBase: pickNumber(source, ["palletDeliveryValueBase"]),
      deliveryLiter: pickNumber(source, ["palletDeliveryValueLiter"]),
      storageBase: pickNumber(source, ["palletStorageValueExpr"]),
      storageLiter: null,
      fbsDeliveryCoefPercent: null,
      fbsDeliveryBase: null,
      fbsDeliveryLiter: null,
      raw: source,
    };
  }

  return {
    warehouseName: text(source.warehouseName),
    geoName: text(source.geoName),
    deliveryCoefPercent: pickNumber(source, ["boxDeliveryCoefExpr", "boxDeliveryAndStorageExpr"]),
    storageCoefPercent: pickNumber(source, ["boxStorageCoefExpr", "boxDeliveryAndStorageExpr"]),
    deliveryBase: pickNumber(source, ["boxDeliveryBase", "boxDeliveryValueBase"]),
    deliveryLiter: pickNumber(source, ["boxDeliveryLiter", "boxDeliveryValueLiter"]),
    storageBase: pickNumber(source, ["boxStorageBase", "boxStorageValueBase"]),
    storageLiter: pickNumber(source, ["boxStorageLiter", "boxStorageValueLiter"]),
    fbsDeliveryCoefPercent: pickNumber(source, ["boxDeliveryMarketplaceCoefExpr"]),
    fbsDeliveryBase: pickNumber(source, ["boxDeliveryMarketplaceBase"]),
    fbsDeliveryLiter: pickNumber(source, ["boxDeliveryMarketplaceLiter"]),
    raw: source,
  };
}

function normalizeTariffWarehouse(row: WbAcceptanceRow) {
  return {
    warehouseName: text(row.warehouseName),
    warehouseID: row.warehouseID || null,
    geoName: "",
    deliveryCoefPercent: num(row.deliveryCoef),
    storageCoefPercent: num(row.storageCoef),
    deliveryBase: num(row.deliveryBaseLiter),
    deliveryLiter: num(row.deliveryAdditionalLiter),
    storageBase: num(row.storageBaseLiter),
    storageLiter: num(row.storageAdditionalLiter),
    fbsDeliveryCoefPercent: null,
    fbsDeliveryBase: null,
    fbsDeliveryLiter: null,
    acceptanceCoefficient: typeof row.coefficient === "number" ? row.coefficient : null,
    allowUnload: Boolean(row.allowUnload),
    boxTypeID: row.boxTypeID || null,
    raw: row,
  };
}

function withSalesRanking<T extends { warehouseName: string }>(rows: T[], salesByWarehouse: SalesMaps) {
  const rankedRows = rows
    .filter((row) => row.warehouseName)
    .map((row) => {
      const sales = getWarehouseSales(row.warehouseName, salesByWarehouse);
      return {
        ...row,
        salesQty: sales.exactSalesQty,
        exactSalesQty: sales.exactSalesQty,
        familySalesQty: sales.familySalesQty,
        familyKey: getWarehouseFamilyKey(row.warehouseName),
      };
    });

  const familyExactTotals = new Map<string, number>();
  const familyOwners = new Map<string, typeof rankedRows[number]>();
  for (const row of rankedRows) {
    familyExactTotals.set(row.familyKey, (familyExactTotals.get(row.familyKey) || 0) + row.exactSalesQty);

    const current = familyOwners.get(row.familyKey);
    if (!current) {
      familyOwners.set(row.familyKey, row);
      continue;
    }

    const rowHasTariff = hasTariffValues(row);
    const currentHasTariff = hasTariffValues(current);
    if (rowHasTariff !== currentHasTariff) {
      if (rowHasTariff) familyOwners.set(row.familyKey, row);
      continue;
    }

    const rowRank = fallbackOwnerRank(row.warehouseName);
    const currentRank = fallbackOwnerRank(current.warehouseName);
    if (rowRank !== currentRank) {
      if (rowRank < currentRank) familyOwners.set(row.familyKey, row);
      continue;
    }

    if (row.exactSalesQty !== current.exactSalesQty) {
      if (row.exactSalesQty > current.exactSalesQty) familyOwners.set(row.familyKey, row);
      continue;
    }

    if (row.warehouseName.length < current.warehouseName.length) {
      familyOwners.set(row.familyKey, row);
    }
  }

  return rankedRows
    .map((row) => {
      const owner = familyOwners.get(row.familyKey);
      const unmatchedFamilySales = Math.max(row.familySalesQty - (familyExactTotals.get(row.familyKey) || 0), 0);
      return {
        ...row,
        salesQty: row.exactSalesQty + (owner === row ? unmatchedFamilySales : 0),
      };
    })
    .sort((a, b) => {
      if (a.salesQty !== b.salesQty) return b.salesQty - a.salesQty;
      if (a.exactSalesQty !== b.exactSalesQty) return b.exactSalesQty - a.exactSalesQty;
      return a.warehouseName.localeCompare(b.warehouseName, "ru");
    })
}

function normalizeAcceptancePayload(payload: WbAcceptanceRow[], date: string, cargoType: "box" | "pallet", source: string, syncedAt: string | undefined, salesByWarehouse: SalesMaps) {
  const boxTypeID = cargoType === "pallet" ? 5 : 2;
  const byWarehouse = new Map<string, ReturnType<typeof normalizeTariffWarehouse>>();

  for (const row of payload) {
    if (row.date && row.date.slice(0, 10) !== date) continue;
    if (row.boxTypeID !== boxTypeID) continue;
    const normalized = normalizeTariffWarehouse(row);
    if (!normalized.warehouseName) continue;

    const current = byWarehouse.get(normalized.warehouseName);
    if (!current) {
      byWarehouse.set(normalized.warehouseName, normalized);
      continue;
    }

    const currentAvailable = current.allowUnload && (current.acceptanceCoefficient === 0 || current.acceptanceCoefficient === 1);
    const nextAvailable = normalized.allowUnload && (normalized.acceptanceCoefficient === 0 || normalized.acceptanceCoefficient === 1);
    if (nextAvailable && !currentAvailable) {
      byWarehouse.set(normalized.warehouseName, normalized);
    }
  }

  return {
    date,
    cargoType,
    source,
    tariffKind: "acceptance",
    boxTypeID,
    syncedAt: syncedAt || new Date().toISOString(),
    salesWindowDays: ORDER_WINDOW_DAYS,
    dtNext: null,
    dtTillMax: null,
    warehouses: withSalesRanking(Array.from(byWarehouse.values()), salesByWarehouse),
  };
}

function normalizeStockPayload(
  payload: WbTariffsResponse,
  requestedDate: string,
  effectiveDate: string,
  cargoType: "box" | "pallet",
  source: string,
  syncedAt: string | undefined,
  salesByWarehouse: SalesMaps,
) {
  const data = payload.response?.data || {};
  const warehouses = Array.isArray(data.warehouseList)
    ? withSalesRanking(data.warehouseList
      .map((row) => normalizeWarehouse(row, cargoType))
      .filter((row) => row.warehouseName), salesByWarehouse)
    : [];

  return {
    date: requestedDate,
    effectiveDate,
    cargoType,
    source,
    tariffKind: "stock",
    syncedAt: syncedAt || new Date().toISOString(),
    salesWindowDays: ORDER_WINDOW_DAYS,
    dtNext: cargoType === "box" ? data.dtNextBox || null : data.dtNextPallet || null,
    dtTillMax: data.dtTillMax || null,
    warehouses,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayMsk();
    const cargoType = searchParams.get("cargoType") === "pallet" ? "pallet" : "box";
    const stockCacheType = `${cargoType}_stock`;
    const refresh = searchParams.get("refresh") === "1";
    const salesByWarehouse = await getSalesByWarehousePg();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const cached = refresh ? null : await readCachePg(date, stockCacheType);
    if (cached) {
      const payload = parseCachedPayload<WbTariffsResponse>(cached);
      const effectiveDate = payload.response?.data?.dtTillMax || cached.date;
      return NextResponse.json(normalizeStockPayload(payload, date, effectiveDate, cargoType, "cache", cached.synced_at, salesByWarehouse));
    }

    if (isPostgresReadonlyConnection()) {
      const fallback = await readLatestCachePg(date, stockCacheType) || await readLatestCachePg(date, cargoType);
      if (fallback) {
        if (fallback.cargo_type === stockCacheType) {
          const payload = parseCachedPayload<WbTariffsResponse>(fallback);
          const effectiveDate = payload.response?.data?.dtTillMax || fallback.date;
          return NextResponse.json(normalizeStockPayload(payload, date, effectiveDate, cargoType, "cache", fallback.synced_at, salesByWarehouse));
        }
        return NextResponse.json(normalizeAcceptancePayload(parseCachedPayload<WbAcceptanceRow[]>(fallback), fallback.date, cargoType, "cache", fallback.synced_at, salesByWarehouse));
      }
      return NextResponse.json({ error: "Для выбранной даты нет сохранённых тарифов WB" }, { status: 404 });
    }

    const apiKey = getWbApiKey();
    if (!apiKey) {
      const fallback = await readLatestCachePg(date, stockCacheType) || await readLatestCachePg(date, cargoType);
      if (fallback) {
        if (fallback.cargo_type === stockCacheType) {
          const payload = parseCachedPayload<WbTariffsResponse>(fallback);
          const effectiveDate = payload.response?.data?.dtTillMax || fallback.date;
          return NextResponse.json(normalizeStockPayload(payload, date, effectiveDate, cargoType, "cache", fallback.synced_at, salesByWarehouse));
        }
        return NextResponse.json(normalizeAcceptancePayload(parseCachedPayload<WbAcceptanceRow[]>(fallback), fallback.date, cargoType, "cache", fallback.synced_at, salesByWarehouse));
      }
      return NextResponse.json({ error: "WB API key missing" }, { status: 401 });
    }

    const fetchStockTariffs = async (targetDate: string) => {
      const response = await fetch(`https://common-api.wildberries.ru/api/v1/tariffs/${cargoType}?date=${encodeURIComponent(targetDate)}`, {
        headers: { Authorization: apiKey },
        cache: "no-store",
      });
      const payload = response.ok ? await response.json() as WbTariffsResponse : null;
      return { response, payload };
    };

    let effectiveDate = date;
    let { response: res, payload } = await fetchStockTariffs(date);
    const initialData = payload?.response?.data;
    if (res.ok && payload && (!Array.isArray(initialData?.warehouseList) || initialData.warehouseList.length === 0)) {
      const lastAvailableDate = cargoType === "box"
        ? initialData?.dtTillMax
        : initialData?.dtTillMax;
      if (lastAvailableDate && /^\d{4}-\d{2}-\d{2}$/.test(lastAvailableDate) && lastAvailableDate < date) {
        effectiveDate = lastAvailableDate;
        ({ response: res, payload } = await fetchStockTariffs(lastAvailableDate));
      }
    }

    const warehouseList = payload?.response?.data?.warehouseList;
    if (!res.ok || !payload || !Array.isArray(warehouseList) || warehouseList.length === 0) {
      const fallback = await readLatestCachePg(date, stockCacheType) || await readLatestCachePg(date, cargoType);
      if (fallback) {
        if (fallback.cargo_type === stockCacheType) {
          const cachedPayload = parseCachedPayload<WbTariffsResponse>(fallback);
          const fallbackDate = cachedPayload.response?.data?.dtTillMax || fallback.date;
          const normalized = normalizeStockPayload(cachedPayload, date, fallbackDate, cargoType, "cache", fallback.synced_at, salesByWarehouse);
          return NextResponse.json({ ...normalized, warning: `WB API ${res.status || 200}: использованы последние сохранённые тарифы` });
        }
        const normalized = normalizeAcceptancePayload(parseCachedPayload<WbAcceptanceRow[]>(fallback), fallback.date, cargoType, "cache", fallback.synced_at, salesByWarehouse);
        return NextResponse.json({ ...normalized, requestedDate: date, warning: `WB API ${res.status || 200}: использованы последние сохранённые тарифы` });
      }
      const body = res.ok ? "WB вернул пустой список тарифов" : await res.text().catch(() => "");
      return NextResponse.json({ error: `WB API ${res.status}: ${body}` }, { status: res.ok ? 503 : res.status });
    }

    await writeCachePg(date, stockCacheType, payload);
    const normalized = normalizeStockPayload(payload, date, effectiveDate, cargoType, "wb", undefined, salesByWarehouse);
    return NextResponse.json(effectiveDate === date
      ? normalized
      : { ...normalized, warning: `WB пока не опубликовал тарифы на ${date}; используются последние доступные за ${effectiveDate}` });
  } catch (error) {
    return apiError(error);
  }
}
