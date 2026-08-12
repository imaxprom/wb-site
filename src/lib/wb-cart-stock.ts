import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { pgGet, pgQuery, pgRows } from "@/lib/postgres";
import type {
  CartStockApiResponse,
  CartStockAttempt,
  CartStockProduct,
  CartStockProductGroup,
  CartStockProductSize,
  CartStockSnapshot,
  CartStockWarehouse,
} from "@/types/cart-stock";
import { getOrganizationDataPath } from "@/lib/organization-paths";
import { getActiveOrganizationId } from "@/lib/organization-context";

const WB_STORES_URL = "https://static-basket-01.wbbasket.ru/vol0/data/stores-data.json";
const WB_GEO_URL = "https://user-geo-data.wildberries.ru/get-geo-info";
const DESTINATION_LABEL = "регионы России через пользовательский сайт WB";
const SNAPSHOT_LIMIT = 90;
const BATCH_SIZE = 20;
function localCachePath(): string {
  return getOrganizationDataPath("cart-stock-local.json");
}

const CLIENT_LOCATION_PROBES = [
  ["Москва", 55.7558, 37.6173],
  ["Санкт-Петербург", 59.9343, 30.3351],
  ["Калининград", 54.7104, 20.4522],
  ["Архангельск", 64.5393, 40.5187],
  ["Мурманск", 68.9707, 33.0749],
  ["Смоленск", 54.7826, 32.0453],
  ["Алексин", 54.5088, 37.0670],
  ["Тула", 54.1931, 37.6173],
  ["Воронеж", 51.6608, 39.2003],
  ["Нижний Новгород", 56.2965, 43.9361],
  ["Казань", 55.7961, 49.1064],
  ["Самара", 53.1959, 50.1002],
  ["Саратов", 51.5336, 46.0343],
  ["Волгоград", 48.7080, 44.5133],
  ["Ростов-на-Дону", 47.2357, 39.7015],
  ["Краснодар", 45.0355, 38.9753],
  ["Сочи", 43.5855, 39.7231],
  ["Ставрополь", 45.0428, 41.9734],
  ["Махачкала", 42.9849, 47.5047],
  ["Уфа", 54.7388, 55.9721],
  ["Оренбург", 51.7682, 55.0969],
  ["Пермь", 58.0105, 56.2502],
  ["Ижевск", 56.8527, 53.2115],
  ["Екатеринбург", 56.8380, 60.5975],
  ["Челябинск", 55.1644, 61.4368],
  ["Тюмень", 57.1522, 65.5272],
  ["Курган", 55.4443, 65.3161],
  ["Новосибирск", 55.0084, 82.9357],
  ["Омск", 54.9885, 73.3242],
  ["Томск", 56.5010, 84.9925],
  ["Красноярск", 56.0153, 92.8932],
  ["Иркутск", 52.2864, 104.2807],
  ["Якутск", 62.0355, 129.6755],
  ["Хабаровск", 48.4802, 135.0719],
  ["Владивосток", 43.1155, 131.8855],
] as const;

type WbClientStock = {
  wh?: number | string;
  qty?: number | string;
};

type WbClientProduct = {
  name?: string;
  dest?: number | string;
  totalQuantity?: number | string;
  sizes?: Array<{ stocks?: WbClientStock[] }>;
};

export type CartStockRawProduct = {
  articleWB: string;
  wbName: string;
  clientTotalQuantity: number;
  missing: boolean;
  stocks: Array<{ warehouseId: number; quantity: number }>;
  sizes?: Array<{
    optionId: string;
    name: string;
    originalName: string;
    stocks: Array<{ warehouseId: number; quantity: number }>;
  }>;
};

type ClientDestination = {
  id: string;
  labels: string[];
};

type SnapshotRow = {
  captured_at: Date | string;
  status: "success" | "error";
  error: string | null;
  payload_json: CartStockSnapshot | string | null;
};

type WarehouseDirectoryEntry = {
  name: string;
  isWb?: boolean;
};

let storesCache: { expiresAt: number; warehouses: Map<number, WarehouseDirectoryEntry> } | null = null;
let activeSync: Promise<CartStockSnapshot> | null = null;
let activeLocalSync: Promise<CartStockSnapshot> | null = null;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Unknown error")).slice(0, 2000);
}

async function getWarehouseDirectory(): Promise<Map<number, WarehouseDirectoryEntry>> {
  if (storesCache && storesCache.expiresAt > Date.now()) return storesCache.warehouses;

  const response = await fetch(WB_STORES_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`WB warehouse directory returned HTTP ${response.status}`);
  }

  const rows = await response.json() as Array<{
    id?: number | string;
    name?: string;
    isWb?: boolean;
  }>;
  const warehouses = new Map<number, WarehouseDirectoryEntry>();
  for (const row of rows) {
    const id = Number(row.id);
    if (Number.isFinite(id) && row.name) {
      warehouses.set(id, {
        name: row.name,
        isWb: typeof row.isWb === "boolean" ? row.isWb : undefined,
      });
    }
  }
  storesCache = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, warehouses };
  return warehouses;
}

function warehouseGroup(warehouse: Pick<CartStockWarehouse, "name" | "isWb">): number {
  if (warehouse.isWb === false) return 1;
  // Compatibility for snapshots saved before the directory's isWb flag was persisted.
  return /^\s*склад продавца(?:\s|$)/iu.test(warehouse.name) ? 1 : 0;
}

function compareWarehouses(left: CartStockWarehouse, right: CartStockWarehouse): number {
  return warehouseGroup(left) - warehouseGroup(right)
    || right.quantity - left.quantity
    || left.name.localeCompare(right.name, "ru");
}

async function getClientDestinations(): Promise<ClientDestination[]> {
  const resolved = await Promise.all(CLIENT_LOCATION_PROBES.map(async ([label, latitude, longitude]) => {
    try {
      const url = new URL(WB_GEO_URL);
      url.searchParams.set("currency", "RUB");
      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      url.searchParams.set("locale", "ru");
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const payload = await response.json() as { xinfo?: string };
      const destinationId = new URLSearchParams(payload.xinfo || "").get("dest");
      return destinationId ? { id: destinationId, label } : null;
    } catch {
      return null;
    }
  }));

  const unique = new Map<string, ClientDestination>();
  for (const item of resolved) {
    if (!item) continue;
    const current = unique.get(item.id);
    if (current) current.labels.push(item.label);
    else unique.set(item.id, { id: item.id, labels: [item.label] });
  }
  if (unique.size === 0) throw new Error("WB user geo service returned no destinations");
  return Array.from(unique.values());
}

async function collectFromWbClient(articleIds: string[]): Promise<{
  destinationIds: string[];
  checkedLocations: string[];
  failedLocations: string[];
    products: CartStockRawProduct[];
}> {
  const destinations = await getClientDestinations();
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      + "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    });

    await page.goto(`https://www.wildberries.ru/catalog/${articleIds[0]}/detail.aspx`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    }).catch(() => null);

    await page.waitForFunction(
      () => {
        const runtime = window as typeof window & {
          wb?: { xnm?: { getXnmProducts?: unknown } };
        };
        return typeof runtime.wb?.xnm?.getXnmProducts === "function";
      },
      { timeout: 30_000 },
    );
    // The WB shell exposes xnm before its own redirect/bootstrap cycle is fully
    // settled. Calling it immediately can destroy the evaluation context.
    await new Promise((resolve) => setTimeout(resolve, 8_000));

    const products = new Map<string, CartStockRawProduct>();
    for (const articleWB of articleIds) {
      products.set(articleWB, {
        articleWB,
        wbName: "",
        clientTotalQuantity: 0,
        missing: true,
        stocks: [],
      });
    }
    const checkedDestinations: ClientDestination[] = [];
    const failedLocations: string[] = [];

    for (const destination of destinations) {
      try {
        for (const batch of chunks(articleIds, BATCH_SIZE)) {
          const numericIds = batch.map(Number);
          const result = await page.evaluate(async ({ ids, destinationId }) => {
            const runtime = window as typeof window & {
              wb?: {
                xnm?: {
                  getXnmProducts?: (
                    articleIds: number[],
                    includeStocks: boolean,
                    includeDelivery: boolean,
                    destinationId?: number,
                  ) => Promise<Record<string, WbClientProduct>>;
                };
              };
            };
            const getProducts = runtime.wb?.xnm?.getXnmProducts;
            if (!getProducts) throw new Error("WB client stock module is unavailable");

            const raw = await getProducts(ids, true, true, destinationId);
            return ids.map((id) => {
              const product = raw?.[String(id)];
              if (!product) {
                return {
                  articleWB: String(id),
                  wbName: "",
                  destinationId: null,
                  clientTotalQuantity: 0,
                  missing: true,
                  stocks: [],
                };
              }

              const byWarehouse = new Map<number, number>();
              for (const size of product.sizes || []) {
                for (const stock of size.stocks || []) {
                  const warehouseId = Number(stock.wh);
                  const quantity = Number(stock.qty) || 0;
                  if (!Number.isFinite(warehouseId) || quantity <= 0) continue;
                  byWarehouse.set(warehouseId, (byWarehouse.get(warehouseId) || 0) + quantity);
                }
              }

              return {
                articleWB: String(id),
                wbName: String(product.name || ""),
                destinationId: product.dest == null ? null : String(product.dest),
                clientTotalQuantity: Number(product.totalQuantity) || 0,
                missing: false,
                stocks: Array.from(byWarehouse, ([warehouseId, quantity]) => ({
                  warehouseId,
                  quantity,
                })),
              };
            });
          }, { ids: numericIds, destinationId: Number(destination.id) });

          for (const product of result) {
            if (product.missing) continue;
            const current = products.get(product.articleWB);
            if (!current) continue;
            current.missing = false;
            current.wbName ||= product.wbName;
            current.clientTotalQuantity = Math.max(
              current.clientTotalQuantity,
              product.clientTotalQuantity,
            );
            const warehouseQuantities = new Map(
              current.stocks.map((stock) => [stock.warehouseId, stock.quantity]),
            );
            for (const stock of product.stocks) {
              warehouseQuantities.set(
                stock.warehouseId,
                Math.max(warehouseQuantities.get(stock.warehouseId) || 0, stock.quantity),
              );
            }
            current.stocks = Array.from(
              warehouseQuantities,
              ([warehouseId, quantity]) => ({ warehouseId, quantity }),
            );
          }
        }
        checkedDestinations.push(destination);
      } catch (error) {
        console.warn(
          `[cart-stock] User destination ${destination.id} failed:`,
          errorMessage(error),
        );
        failedLocations.push(...destination.labels);
      }
    }

    if (checkedDestinations.length === 0) {
      throw new Error("WB user site returned no successful regional cart checks");
    }
    return {
      destinationIds: checkedDestinations.map((destination) => destination.id),
      checkedLocations: checkedDestinations.flatMap((destination) => destination.labels),
      failedLocations,
      products: Array.from(products.values()),
    };
  } finally {
    await browser.close();
  }
}

export async function collectCartStockSnapshot(
  articleIds: string[],
  productGroup: CartStockProductGroup = "rucksacks",
): Promise<CartStockSnapshot> {
  const cleanIds = normalizeArticleIds(articleIds);
  if (cleanIds.length === 0) throw new Error("No valid WB articles found for cart stock refresh");

  const {
    destinationIds,
    checkedLocations,
    failedLocations,
    products: rawProducts,
  } = await collectFromWbClient(cleanIds);
  return buildCartStockSnapshot(cleanIds, rawProducts, {
    productGroup,
    source: "wb-anonymous-card",
    authenticated: false,
    destinationIds,
    checkedLocations,
    failedLocations,
    destinationLabel: DESTINATION_LABEL,
  });
}

function normalizeArticleIds(articleIds: string[]): string[] {
  return Array.from(new Set(
    articleIds
      .map((value) => String(value).trim())
      .filter((value) => /^\d+$/.test(value) && Number(value) > 0),
  ));
}

export async function buildCartStockSnapshot(
  articleIds: string[],
  rawProducts: CartStockRawProduct[],
  metadata: {
    productGroup: CartStockProductGroup;
    source: "wb-authorized-card" | "wb-anonymous-card";
    authenticated: boolean;
    destinationIds: string[];
    checkedLocations: string[];
    failedLocations: string[];
    destinationLabel: string;
    capturedAt?: string;
  },
): Promise<CartStockSnapshot> {
  const cleanIds = normalizeArticleIds(articleIds);
  if (cleanIds.length === 0) throw new Error("No valid WB articles found for cart stock snapshot");
  const warehouseDirectory = await getWarehouseDirectory();
  const warehouseTotals = new Map<number, { quantity: number; articles: number }>();

  const products: CartStockProduct[] = rawProducts.map((product) => {
    const warehouses = product.stocks
      .map((stock) => ({
        warehouseId: stock.warehouseId,
        warehouseName: warehouseDirectory.get(stock.warehouseId)?.name || `Склад WB ${stock.warehouseId}`,
        quantity: stock.quantity,
      }))
      .sort((left, right) => right.quantity - left.quantity);

    for (const warehouse of warehouses) {
      const current = warehouseTotals.get(warehouse.warehouseId) || { quantity: 0, articles: 0 };
      current.quantity += warehouse.quantity;
      current.articles += 1;
      warehouseTotals.set(warehouse.warehouseId, current);
    }

    const sizes: CartStockProductSize[] = (product.sizes || []).map((size) => {
      const sizeWarehouses = size.stocks
        .map((stock) => ({
          warehouseId: stock.warehouseId,
          warehouseName: warehouseDirectory.get(stock.warehouseId)?.name || `Склад WB ${stock.warehouseId}`,
          quantity: stock.quantity,
        }))
        .sort((left, right) => right.quantity - left.quantity);
      return {
        optionId: size.optionId,
        name: size.name,
        originalName: size.originalName,
        cartQuantity: sizeWarehouses.reduce((sum, warehouse) => sum + warehouse.quantity, 0),
        warehouses: sizeWarehouses,
      };
    });

    return {
      articleWB: product.articleWB,
      wbName: product.wbName,
      // The visible total belongs to this table, not to WB's capped
      // totalQuantity: add the unique warehouse columns collected across the
      // regional user-site checks.
      cartQuantity: warehouses.reduce((sum, warehouse) => sum + warehouse.quantity, 0),
      clientTotalQuantity: product.clientTotalQuantity,
      missing: product.missing,
      warehouses,
      sizes,
    };
  });

  const warehouses: CartStockWarehouse[] = Array.from(
    warehouseTotals,
    ([id, totals]) => {
      const directoryEntry = warehouseDirectory.get(id);
      return {
        id,
        name: directoryEntry?.name || `Склад WB ${id}`,
        isWb: directoryEntry?.isWb,
        quantity: totals.quantity,
        articles: totals.articles,
      };
    },
  ).sort(compareWarehouses);

  return {
    productGroup: metadata.productGroup,
    capturedAt: metadata.capturedAt || new Date().toISOString(),
    source: metadata.source,
    authenticated: metadata.authenticated,
    destinationId: metadata.destinationIds.length === 1 ? metadata.destinationIds[0] : null,
    destinationLabel: metadata.destinationLabel,
    destinationIds: metadata.destinationIds,
    checkedDestinations: metadata.destinationIds.length,
    checkedLocations: metadata.checkedLocations,
    failedLocations: metadata.failedLocations,
    requestedArticles: cleanIds.length,
    returnedArticles: products.filter((product) => !product.missing).length,
    totalCartQuantity: products.reduce((sum, product) => sum + product.cartQuantity, 0),
    warehouses,
    products,
  };
}

const PRODUCT_GROUP_SUBJECTS: Record<CartStockProductGroup, string> = {
  rucksacks: "рюкзак",
  underwear: "трус",
};

export async function getCartStockArticleIdsPg(productGroup: CartStockProductGroup): Promise<string[]> {
  const subject = PRODUCT_GROUP_SUBJECTS[productGroup];
  const rows = await pgRows<{ article_wb: string }>(`
    SELECT DISTINCT article_wb
    FROM shipment_orders
    WHERE article_wb IS NOT NULL
      AND TRIM(article_wb::text) <> ''
      AND subject ILIKE $1
    ORDER BY article_wb
  `, [`%${subject}%`]);
  const articleIds = rows.map((row) => String(row.article_wb));
  if (articleIds.length === 0) {
    throw new Error(`No articles for cart-stock group ${productGroup} found in shipment_orders`);
  }
  return articleIds;
}

export async function getRucksackArticleIdsPg(): Promise<string[]> {
  return getCartStockArticleIdsPg("rucksacks");
}

async function createLegacyCartStockTable(): Promise<void> {
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS wb_cart_stock_snapshots (
      id BIGSERIAL PRIMARY KEY,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      destination_id TEXT,
      article_count INTEGER NOT NULL DEFAULT 0,
      warehouse_count INTEGER NOT NULL DEFAULT 0,
      total_quantity BIGINT NOT NULL DEFAULT 0,
      product_group TEXT NOT NULL DEFAULT 'rucksacks',
      payload_json JSONB,
      error TEXT
    )
  `);
  await pgQuery(`
    ALTER TABLE wb_cart_stock_snapshots
    ADD COLUMN IF NOT EXISTS product_group TEXT NOT NULL DEFAULT 'rucksacks'
  `);
  await pgQuery(`
    CREATE INDEX IF NOT EXISTS idx_wb_cart_stock_snapshots_captured
    ON wb_cart_stock_snapshots (captured_at DESC)
  `);
  await pgQuery(`
    CREATE INDEX IF NOT EXISTS idx_wb_cart_stock_snapshots_group_captured
    ON wb_cart_stock_snapshots (product_group, captured_at DESC, id DESC)
  `);
}

const cartStockTablePromises = new Map<number, Promise<void>>();

async function verifyProvisionedCartStockTable(organizationId: number): Promise<void> {
  const state = await pgGet<{ table_exists: boolean; product_group_exists: boolean }>(`
    SELECT
      to_regclass('wb_cart_stock_snapshots') IS NOT NULL AS table_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wb_cart_stock_snapshots'
          AND column_name = 'product_group'
      ) AS product_group_exists
  `);
  if (!state?.table_exists || !state.product_group_exists) {
    throw new Error(
      `Organization ${organizationId} cart-stock snapshot table is not provisioned; run the database migration`,
    );
  }
}

async function ensureCartStockTable(): Promise<void> {
  const organizationId = getActiveOrganizationId() || 1;
  if (!cartStockTablePromises.has(organizationId)) {
    const promise = (organizationId === 1
      ? createLegacyCartStockTable()
      : verifyProvisionedCartStockTable(organizationId)
    ).catch((error) => {
      cartStockTablePromises.delete(organizationId);
      throw error;
    });
    cartStockTablePromises.set(organizationId, promise);
  }
  return cartStockTablePromises.get(organizationId)!;
}

export async function saveCartStockAttempt(
  snapshot: CartStockSnapshot | null,
  error: string | null,
  productGroup: CartStockProductGroup = snapshot?.productGroup || "rucksacks",
): Promise<void> {
  await ensureCartStockTable();
  await pgQuery(
    `
      INSERT INTO wb_cart_stock_snapshots (
        captured_at, status, destination_id, article_count,
        warehouse_count, total_quantity, product_group, payload_json, error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    `,
    [
      snapshot?.capturedAt || new Date().toISOString(),
      snapshot ? "success" : "error",
      snapshot?.destinationId || null,
      snapshot?.requestedArticles || 0,
      snapshot?.warehouses.length || 0,
      snapshot?.totalCartQuantity || 0,
      productGroup,
      snapshot ? JSON.stringify(snapshot) : null,
      error,
    ],
  );
  await pgQuery(
    `
      DELETE FROM wb_cart_stock_snapshots
      WHERE id NOT IN (
        SELECT id
        FROM wb_cart_stock_snapshots
        ORDER BY captured_at DESC, id DESC
        LIMIT $1
      )
    `,
    [SNAPSHOT_LIMIT],
  );
}

async function runCartStockSync(): Promise<CartStockSnapshot> {
  try {
    const articleIds = await getRucksackArticleIdsPg();
    const snapshot = await collectCartStockSnapshot(articleIds);
    await saveCartStockAttempt(snapshot, null);
    return snapshot;
  } catch (error) {
    const message = errorMessage(error);
    await saveCartStockAttempt(null, message).catch((saveError) => {
      console.error("[cart-stock] Failed to save sync error:", saveError);
    });
    throw error;
  }
}

async function readLocalStatus(): Promise<Pick<CartStockApiResponse, "snapshot" | "lastAttempt">> {
  try {
    const raw = await fs.readFile(localCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Pick<CartStockApiResponse, "snapshot" | "lastAttempt">;
    return {
      snapshot: parsed.snapshot || null,
      lastAttempt: parsed.lastAttempt || null,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    if (code !== "ENOENT") console.error("[cart-stock] Failed to read local cache:", error);
    return { snapshot: null, lastAttempt: null };
  }
}

async function writeLocalStatus(
  snapshot: CartStockSnapshot | null,
  lastAttempt: CartStockAttempt,
): Promise<void> {
  const cachePath = localCachePath();
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ snapshot, lastAttempt }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, cachePath);
}

async function runLocalCartStockSync(): Promise<CartStockSnapshot> {
  const previous = await readLocalStatus();
  try {
    const articleIds = await getRucksackArticleIdsPg();
    const snapshot = await collectCartStockSnapshot(articleIds);
    await writeLocalStatus(snapshot, {
      capturedAt: snapshot.capturedAt,
      status: "success",
      error: null,
    });
    return snapshot;
  } catch (error) {
    await writeLocalStatus(previous.snapshot, {
      capturedAt: new Date().toISOString(),
      status: "error",
      error: errorMessage(error),
    }).catch((writeError) => {
      console.error("[cart-stock] Failed to save local sync error:", writeError);
    });
    throw error;
  }
}

export async function syncCartStockPg(): Promise<CartStockSnapshot> {
  if (activeSync) return activeSync;
  activeSync = runCartStockSync();
  try {
    return await activeSync;
  } finally {
    activeSync = null;
  }
}

export async function syncCartStockLocal(): Promise<CartStockSnapshot> {
  if (activeLocalSync) return activeLocalSync;
  activeLocalSync = runLocalCartStockSync();
  try {
    return await activeLocalSync;
  } finally {
    activeLocalSync = null;
  }
}

function parseSnapshot(value: CartStockSnapshot | string | null): CartStockSnapshot | null {
  if (!value) return null;
  let parsed: CartStockSnapshot;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as CartStockSnapshot;
    } catch {
      return null;
    }
  } else {
    parsed = value;
  }
  return {
    ...parsed,
    productGroup: parsed.productGroup || "rucksacks",
  };
}

export async function getCartStockStatusPg(productGroup: CartStockProductGroup = "rucksacks"): Promise<
  Pick<CartStockApiResponse, "snapshot" | "lastAttempt" | "schedule">
> {
  const schedule = {
    timesMsk: ["06:00", "14:00", "22:00"],
    destinationLabel: DESTINATION_LABEL,
  };
  await ensureCartStockTable();

  const [latestAttempt, latestSuccess] = await Promise.all([
    pgGet<SnapshotRow>(`
      SELECT captured_at, status, error, payload_json
      FROM wb_cart_stock_snapshots
      WHERE product_group = $1
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `, [productGroup]),
    pgGet<SnapshotRow>(`
      SELECT captured_at, status, error, payload_json
      FROM wb_cart_stock_snapshots
      WHERE status = 'success'
        AND product_group = $1
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `, [productGroup]),
  ]);

  const lastAttempt: CartStockAttempt | null = latestAttempt
    ? {
        capturedAt: new Date(latestAttempt.captured_at).toISOString(),
        status: latestAttempt.status,
        error: latestAttempt.error,
      }
    : null;

  return {
    snapshot: parseSnapshot(latestSuccess?.payload_json || null),
    lastAttempt,
    schedule,
  };
}

export async function getCartStockStatusLocal(productGroup: CartStockProductGroup = "rucksacks"): Promise<
  Pick<CartStockApiResponse, "snapshot" | "lastAttempt" | "schedule">
> {
  const local = await readLocalStatus();
  return {
    snapshot: local.snapshot?.productGroup === productGroup
      || (!local.snapshot?.productGroup && productGroup === "rucksacks")
      ? local.snapshot
      : null,
    lastAttempt: productGroup === "rucksacks" ? local.lastAttempt : null,
    schedule: {
      timesMsk: ["06:00", "14:00", "22:00"],
      destinationLabel: DESTINATION_LABEL,
    },
  };
}
