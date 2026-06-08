import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { verifyToken } from "@/lib/auth";
import {
  getLastWeekCorrectionPg,
  getUserOverridesPg,
  getUserSettingsPg,
  initShipmentTablesPg,
} from "@/lib/shipment-db";
import { getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";
import { calculateTrend, type WeeklyData } from "@/modules/shipment/lib/trend-engine";
import { isPostgresReadonlyConnection, pgGet, pgQuery, pgRows } from "@/lib/postgres";

interface StockRow {
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
  supply_packed_qty: number;
  supply_accepted_qty: number;
  supply_unloading_qty: number;
  supply_ready_for_sale_qty: number;
  supply_plan_deduct_qty: number;
  warehouse_required_units: number;
  plan_pack_units: number;
  plan_pack_boxes: number | null;
  per_box: number | null;
  filled_cells: number;
  units_qty: number;
  boxes_qty: number | null;
  synced_at: string;
}

interface RawStockRow {
  article_wb: string;
  sheet_name: string;
  size_label: string;
  size_range: string;
  per_box: number | null;
  filled_cells: number;
  units_qty: number;
  boxes_qty: number | null;
  synced_at: string;
}

interface ProductRow {
  article_wb: string;
  sizes_json: string | null;
}

interface ProductSize {
  size: string;
  barcode: string;
  perBox?: number;
}

interface ProductSizeCandidate extends ProductSize {
  normalizedRange: string;
  labelTokens: string[];
}

interface RunRow {
  id: number;
  spreadsheet_title: string | null;
  status: string;
  finished_at: string | null;
  sheets_count: number;
  rows_count: number;
  total_units: number;
  total_boxes: number;
  message: string | null;
}

interface TrendSummary {
  multiplier: number;
  direction: "up" | "down" | "flat";
  totalOrders: number;
}

async function tableExistsPg(tableName: string): Promise<boolean> {
  const row = await pgGet<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    ) AS exists
  `, [tableName]);
  return Boolean(row?.exists);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

const SIZE_TOKEN_PATTERN = /\b(?:[2-9]XL|XXXL|XXL|XL|XS|L|M|S)\b/g;

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRange(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function extractRange(value: string | null | undefined): string {
  return normalizeText(value).match(/\d{2,3}\s*-\s*\d{2,3}/)?.[0].replace(/\s+/g, "") || "";
}

function extractSizeTokens(value: string | null | undefined): string[] {
  const withoutRange = normalizeText(value)
    .toUpperCase()
    .replace(/\d{2,3}\s*-\s*\d{2,3}/g, " ")
    .replace(/[()_/.,;:+-]/g, " ");
  const tokens = withoutRange.match(SIZE_TOKEN_PATTERN) || [];
  return [...new Set(tokens)];
}

function compatibleTokens(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((token) => right.includes(token));
}

async function buildProductSizesByArticlePg(): Promise<Map<string, ProductSizeCandidate[]>> {
  if (!await tableExistsPg("shipment_products")) return new Map();

  const productRows = await pgRows<ProductRow>(`
    SELECT article_wb, sizes_json
    FROM shipment_products
    WHERE article_wb != '' AND sizes_json IS NOT NULL AND sizes_json != ''
  `);

  const byArticle = new Map<string, ProductSizeCandidate[]>();
  for (const product of productRows) {
    let sizes: ProductSize[] = [];
    try {
      const parsed = JSON.parse(product.sizes_json || "[]");
      if (Array.isArray(parsed)) sizes = parsed as ProductSize[];
    } catch {
      sizes = [];
    }

    byArticle.set(
      String(product.article_wb),
      sizes
        .filter((size) => String(size.barcode || "").trim())
        .map((size) => ({
          ...size,
          normalizedRange: extractRange(size.size),
          labelTokens: extractSizeTokens(size.size),
        })),
    );
  }

  return byArticle;
}

function findBarcode(
  row: RawStockRow,
  productSizesByArticle: Map<string, ProductSizeCandidate[]>,
): Pick<StockRow, "barcode" | "barcode_match_status" | "barcode_match_reason"> {
  const sizes = productSizesByArticle.get(String(row.article_wb)) || [];
  if (sizes.length === 0) {
    return {
      barcode: null,
      barcode_match_status: "missing",
      barcode_match_reason: "Артикул не найден в shipment_products",
    };
  }

  const warehouseRange = normalizeRange(row.size_range);
  const warehouseTokens = extractSizeTokens(row.size_label);
  const rangeMatches = warehouseRange
    ? sizes.filter((size) => size.normalizedRange === warehouseRange)
    : [];
  const compatibleRangeMatches = rangeMatches.filter((size) => compatibleTokens(warehouseTokens, size.labelTokens));

  if (compatibleRangeMatches.length === 1) {
    return {
      barcode: compatibleRangeMatches[0].barcode,
      barcode_match_status: "matched",
      barcode_match_reason: `Баркод из shipment_products: ${compatibleRangeMatches[0].size}`,
    };
  }

  if (compatibleRangeMatches.length > 1) {
    const perBoxMatch = compatibleRangeMatches.filter((size) => Number(size.perBox || 0) === Number(row.per_box || 0));
    const selected = perBoxMatch[0] || compatibleRangeMatches[0];
    return {
      barcode: selected.barcode,
      barcode_match_status: "warning",
      barcode_match_reason: `Несколько размеров в shipment_products для ${row.size_range}; выбран ${selected.size}`,
    };
  }

  if (rangeMatches.length > 0) {
    const selected = rangeMatches[0];
    return {
      barcode: selected.barcode,
      barcode_match_status: "warning",
      barcode_match_reason: `Диапазон совпал, буквы размера отличаются: склад ${row.size_label} ${row.size_range}, база ${selected.size}`,
    };
  }

  const tokenMatches = warehouseTokens.length > 0
    ? sizes.filter((size) => compatibleTokens(warehouseTokens, size.labelTokens) && size.labelTokens.length > 0)
    : [];
  if (tokenMatches.length === 1) {
    return {
      barcode: tokenMatches[0].barcode,
      barcode_match_status: "warning",
      barcode_match_reason: `Совпадение только по букве размера: склад ${row.size_label} ${row.size_range}, база ${tokenMatches[0].size}`,
    };
  }

  return {
    barcode: null,
    barcode_match_status: "missing",
    barcode_match_reason: `Размер не найден в shipment_products: ${row.size_label} ${row.size_range}`,
  };
}

function buildNumberMap(rows: Array<{ barcode: string | null; value: number | null }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const barcode = String(row.barcode || "").trim();
    if (!barcode) continue;
    map.set(barcode, Number(row.value || 0));
  }
  return map;
}

function getUserIdFromRequest(req: NextRequest): number | null {
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) return null;
  return verifyToken(token)?.userId ?? null;
}

async function buildWbStockByBarcodePg(): Promise<Map<string, number>> {
  if (!await tableExistsPg("shipment_stock")) return new Map();
  const rows = await pgRows<Array<{ barcode: string | null; value: number | null }>[number]>(`
    SELECT barcode, SUM(quantity) AS value
    FROM shipment_stock
    WHERE barcode != ''
    GROUP BY barcode
  `);
  return buildNumberMap(rows);
}

function normalizePackingDays(value: string | null): number {
  const parsed = Number(value || 30);
  return parsed === 30 ? parsed : 30;
}

function normalizePackingMultiplier(value: unknown): number {
  const parsed = Number(value || 1);
  return [1, 1.25, 1.5, 2].includes(parsed) ? parsed : 1;
}

function normalizeBuyoutRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0.75;
  return Math.min(1, parsed);
}

function normalizeLoadedDays(value: unknown): number {
  const parsed = Number(value || 28);
  if (!Number.isFinite(parsed)) return 28;
  return Math.max(7, Math.floor(parsed / 7) * 7);
}

async function buildOrdersByBarcodePg(days: number): Promise<Map<string, number>> {
  if (!await tableExistsPg("shipment_orders")) return new Map();

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const sevenDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const sevenDaysAgoISO = toLocalISO(sevenDaysAgo);
  const globalCoeff = (await getLastWeekCorrectionPg()).get("__global__") || 1;
  const correctionMultiplier = globalCoeff > 1 ? Math.max(1, Math.round(globalCoeff)) : 1;

  const rows = await pgRows<Array<{ barcode: string | null; date: string | null; value: number | null }>[number]>(`
    SELECT barcode, date, COUNT(*) AS value
    FROM shipment_orders
    WHERE barcode != ''
      AND date >= ?
      AND date < ?
    GROUP BY barcode, date
  `, [toLocalISO(from), toLocalISO(to)]);

  const map = new Map<string, number>();
  for (const row of rows) {
    const barcode = String(row.barcode || "").trim();
    if (!barcode) continue;
    const dateStr = String(row.date || "").slice(0, 10);
    const multiplier = dateStr >= sevenDaysAgoISO ? correctionMultiplier : 1;
    map.set(barcode, (map.get(barcode) || 0) + Number(row.value || 0) * multiplier);
  }
  return map;
}

async function buildAutoBuyoutRateByArticlePg(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!await tableExistsPg("realization")) return map;

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dedup = await getPgExcludeDailyFilter("rr_dt", "r");
  const rows = await pgRows<Array<{ nm_id: number; orders: number | null; buyouts: number | null }>[number]>(`
    SELECT r.nm_id,
      SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
      SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as buyouts
    FROM realization r
    WHERE r.supplier_oper_name IN ('Логистика', 'Продажа')
      AND r.nm_id > 0
      AND r.rr_dt >= ?
    ${dedup.sql}
    GROUP BY r.nm_id
    HAVING SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) >= 30
  `, [cutoff, ...dedup.params]);

  for (const row of rows) {
    const orders = Number(row.orders || 0);
    const buyouts = Number(row.buyouts || 0);
    if (orders > 0) map.set(String(row.nm_id), buyouts / orders);
  }
  return map;
}

function getEffectiveBuyoutRate(
  articleWB: string,
  settings: Record<string, unknown>,
  autoBuyoutByArticle: Map<string, number>,
): number {
  const fallback = normalizeBuyoutRate(settings.buyoutRate);
  if (settings.buyoutMode !== "auto") return fallback;
  return autoBuyoutByArticle.get(String(articleWB)) ?? fallback;
}

async function buildArticleTrendByArticlePg(
  productSizesByArticle: Map<string, ProductSizeCandidate[]>,
  loadedDays: number,
  disabledByArticle: Map<string, Set<string>>,
  includedArticles: Set<string>,
): Promise<{ byArticle: Map<string, TrendSummary>; overall: TrendSummary }> {
  const result = new Map<string, TrendSummary>();
  const fallbackOverall: TrendSummary = { multiplier: 1, direction: "flat", totalOrders: 0 };
  if (!await tableExistsPg("shipment_orders")) return { byArticle: result, overall: fallbackOverall };

  const numWeeks = Math.max(1, Math.floor(loadedDays / 7));
  const today = new Date();
  const firstDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - loadedDays);
  const sevenDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const sevenDaysAgoISO = toLocalISO(sevenDaysAgo);
  const globalCoeff = (await getLastWeekCorrectionPg()).get("__global__") || 1;
  const correctionMultiplier = globalCoeff > 1 ? Math.max(1, Math.round(globalCoeff)) : 1;
  const makeWeekly = (): WeeklyData[] => Array.from({ length: numWeeks }, (_, i) => {
    const weekStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + i * 7);
    const weekEnd = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + (i + 1) * 7);
    const weekEndLabel = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 1);
    return {
      week: i + 1,
      label: `Нед. ${i + 1}`,
      orders: 0,
      dateRange: `${pad2(weekStart.getDate())}.${pad2(weekStart.getMonth() + 1)} - ${pad2(weekEndLabel.getDate())}.${pad2(weekEndLabel.getMonth() + 1)}`,
    };
  });
  const overallWeekly = makeWeekly();

  for (const [articleWB, sizes] of productSizesByArticle.entries()) {
    if (!includedArticles.has(articleWB)) continue;
    const disabledBarcodes = disabledByArticle.get(articleWB) || new Set<string>();
    const barcodes = [...new Set(sizes
      .map((size) => String(size.barcode || "").trim())
      .filter((barcode) => barcode && !disabledBarcodes.has(barcode)))];
    if (barcodes.length === 0) continue;

    const weekly = makeWeekly();
    const placeholders = barcodes.map(() => "?").join(",");
    const rows = await pgRows<Array<{ date: string | null; value: number | null }>[number]>(`
      SELECT date, COUNT(*) AS value
      FROM shipment_orders
      WHERE barcode IN (${placeholders})
        AND date >= ?
        AND date < ?
      GROUP BY date
    `, [...barcodes, toLocalISO(firstDate), toLocalISO(today)]);

    for (const row of rows) {
      const orderDate = String(row.date || "").slice(0, 10);
      if (!orderDate) continue;
      const multiplier = orderDate >= sevenDaysAgoISO ? correctionMultiplier : 1;
      for (let i = 0; i < numWeeks; i++) {
        const weekStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + i * 7);
        const weekEnd = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + (i + 1) * 7);
        if (orderDate >= toLocalISO(weekStart) && orderDate < toLocalISO(weekEnd)) {
          const orders = Number(row.value || 0) * multiplier;
          weekly[i].orders += orders;
          overallWeekly[i].orders += orders;
          break;
        }
      }
    }

    const trend = calculateTrend(weekly);
    result.set(articleWB, {
      multiplier: trend.multiplier,
      direction: trend.direction,
      totalOrders: trend.totalRaw,
    });
  }

  const overallTrend = calculateTrend(overallWeekly);
  return {
    byArticle: result,
    overall: {
      multiplier: overallTrend.multiplier,
      direction: overallTrend.direction,
      totalOrders: overallTrend.totalRaw,
    },
  };
}

function buildPackingPlan(
  row: RawStockRow,
  barcode: string | null,
  packingDays: number,
  wbStockByBarcode: Map<string, number>,
  ordersByBarcode: Map<string, number>,
  trendByArticle: Map<string, { multiplier: number; direction: "up" | "down" | "flat" }>,
  buyoutRate: number,
  disabledBarcodes: Set<string>,
  packingMultiplier: number,
): Pick<StockRow, "packing_days" | "packing_multiplier" | "base_orders_qty" | "base_sales_qty" | "buyout_rate" | "trend_multiplier" | "trend_direction" | "target_sales_qty" | "target_sales_45d" | "wb_stock_qty" | "supply_packed_qty" | "supply_accepted_qty" | "supply_unloading_qty" | "supply_ready_for_sale_qty" | "supply_plan_deduct_qty" | "warehouse_required_units" | "plan_pack_units" | "plan_pack_boxes"> {
  const code = String(barcode || "").trim();
  const isDisabledInShipment = code ? disabledBarcodes.has(code) : false;
  const baseOrders = code && !isDisabledInShipment ? ordersByBarcode.get(code) || 0 : 0;
  const baseSales = baseOrders * buyoutRate;
  const articleTrend = trendByArticle.get(String(row.article_wb));
  const trendMultiplier = articleTrend?.multiplier ?? 1;
  const targetSales = baseSales * trendMultiplier * packingMultiplier;
  const wbStock = code ? wbStockByBarcode.get(code) || 0 : 0;
  const warehouseRequired = Math.max(0, targetSales - wbStock);
  const planUnits = Math.max(0, warehouseRequired - Number(row.units_qty || 0));
  const planBoxes = row.per_box && row.per_box > 0 ? planUnits / row.per_box : null;

  return {
    packing_days: packingDays,
    packing_multiplier: round4(packingMultiplier),
    base_orders_qty: round2(baseOrders),
    base_sales_qty: round2(baseSales),
    buyout_rate: round4(buyoutRate),
    trend_multiplier: round4(trendMultiplier),
    trend_direction: articleTrend?.direction ?? "flat",
    target_sales_qty: round2(targetSales),
    target_sales_45d: round2(targetSales),
    wb_stock_qty: round2(wbStock),
    supply_packed_qty: 0,
    supply_accepted_qty: 0,
    supply_unloading_qty: 0,
    supply_ready_for_sale_qty: 0,
    supply_plan_deduct_qty: 0,
    warehouse_required_units: round2(warehouseRequired),
    plan_pack_units: round2(planUnits),
    plan_pack_boxes: planBoxes === null ? null : round2(planBoxes),
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await initShipmentTablesPg();
    const userId = getUserIdFromRequest(request);
    const settings = userId
      ? await getUserSettingsPg(userId)
      : {};
    const overrides = userId
      ? await getUserOverridesPg(userId)
      : {};
    const disabledByArticle = new Map<string, Set<string>>();
    for (const [articleWB, override] of Object.entries(overrides)) {
      const disabled = override.disabledSizes || {};
      disabledByArticle.set(
        String(articleWB),
        new Set(Object.entries(disabled).filter(([, value]) => value).map(([barcode]) => barcode)),
      );
    }
    const effectiveSettings = {
      buyoutMode: "auto",
      buyoutRate: 0.75,
      uploadDays: 28,
      warehousePackingMultiplier: 1,
      ...settings,
    };
    const packingDays = 30;
    const packingMultiplier = normalizePackingMultiplier(
      request.nextUrl.searchParams.get("packingMultiplier") ?? effectiveSettings.warehousePackingMultiplier,
    );
    const loadedDays = normalizeLoadedDays(effectiveSettings.uploadDays);

    const hasWarehouseReadyStock = await tableExistsPg("warehouse_ready_stock");
    if (!hasWarehouseReadyStock) {
      return NextResponse.json({
        meta: {
          ready: false,
          totalRows: 0,
          totalArticles: 0,
          totalUnits: 0,
          totalBoxes: 0,
          overallTrend: { multiplier: 1, direction: "flat", totalOrders: 0 },
          lastRun: null,
        },
        rows: [],
        articles: [],
      });
    }

    const rawRowsSql = `
      SELECT
        article_wb,
        sheet_name,
        size_label,
        size_range,
        per_box,
        filled_cells,
        units_qty,
        boxes_qty,
        synced_at
      FROM warehouse_ready_stock
      ORDER BY sheet_name, size_range, size_label
    `;
    const rawRows = await pgRows<RawStockRow>(rawRowsSql);

    const productSizesByArticle = await buildProductSizesByArticlePg();
    const wbStockByBarcode = await buildWbStockByBarcodePg();
    const ordersByBarcode = await buildOrdersByBarcodePg(packingDays);
    const includedArticles = new Set(rawRows.map((row) => String(row.article_wb)));
    const trendStats = await buildArticleTrendByArticlePg(productSizesByArticle, loadedDays, disabledByArticle, includedArticles);
    const trendByArticle = trendStats.byArticle;
    const autoBuyoutByArticle = effectiveSettings.buyoutMode === "auto"
      ? await buildAutoBuyoutRateByArticlePg()
      : new Map<string, number>();
    const rows = rawRows.map((row): StockRow => {
      const barcodeMatch = findBarcode(row, productSizesByArticle);
      const buyoutRate = getEffectiveBuyoutRate(row.article_wb, effectiveSettings, autoBuyoutByArticle);
      const disabledBarcodes = disabledByArticle.get(String(row.article_wb)) || new Set<string>();
      return {
        ...row,
        ...barcodeMatch,
        ...buildPackingPlan(row, barcodeMatch.barcode, packingDays, wbStockByBarcode, ordersByBarcode, trendByArticle, buyoutRate, disabledBarcodes, packingMultiplier),
      };
    });

    const hasWarehouseSyncRuns = await tableExistsPg("warehouse_sync_runs");
    const lastRunSql = `
          SELECT
            id,
            spreadsheet_title,
            status,
            finished_at,
            sheets_count,
            rows_count,
            total_units,
            total_boxes,
            message
          FROM warehouse_sync_runs
          ORDER BY id DESC
          LIMIT 1
        `;
    const lastRun = hasWarehouseSyncRuns
      ? await pgGet<RunRow>(lastRunSql)
      : undefined;

    const byArticle = new Map<string, {
      articleWB: string;
      sheetName: string;
      unitsQty: number;
      boxesQty: number;
      sizes: StockRow[];
    }>();

    for (const row of rows) {
      const current = byArticle.get(row.article_wb) || {
        articleWB: row.article_wb,
        sheetName: row.sheet_name,
        unitsQty: 0,
        boxesQty: 0,
        sizes: [],
      };
      current.unitsQty += row.units_qty;
      current.boxesQty += row.boxes_qty || 0;
      current.sizes.push(row);
      byArticle.set(row.article_wb, current);
    }

    const articles = [...byArticle.values()]
      .map((article) => ({
        ...article,
        unitsQty: Math.round(article.unitsQty * 100) / 100,
        boxesQty: Math.round(article.boxesQty * 100) / 100,
      }))
      .sort((a, b) => b.unitsQty - a.unitsQty);

    const totalUnits = rows.reduce((sum, row) => sum + row.units_qty, 0);
    const totalBoxes = rows.reduce((sum, row) => sum + (row.boxes_qty || 0), 0);

    return NextResponse.json({
      meta: {
        ready: true,
        totalRows: rows.length,
        totalArticles: articles.length,
        totalUnits: Math.round(totalUnits * 100) / 100,
        totalBoxes: Math.round(totalBoxes * 100) / 100,
        overallTrend: {
          multiplier: round4(trendStats.overall.multiplier),
          direction: trendStats.overall.direction,
          totalOrders: round2(trendStats.overall.totalOrders),
        },
        lastRun: lastRun || null,
      },
      rows,
      articles,
    });
  } catch (err) {
    return apiError(err);
  }
}
