import type {
  Product,
  RegionConfig,
  RegionGroup,
  StockItem,
  OrderRecord,
  OrderAggregates,
  ShipmentCalculation,
  ShipmentRow,
  RegionShipment,
  ProductOverride,
} from "@/types";
import { sortBySize } from "@/modules/shipment/lib/size-utils";
import { calculateTrend, type TrendResult } from "@/modules/shipment/lib/trend-engine";

const DEFAULT_REGIONS: RegionConfig[] = [
  {
    id: "central",
    name: "Центральный регион",
    shortName: "ЦФО",
    percentage: 0.35,
    warehouses: [
      "Рязань (Тюшевское)",
      "Тула",
      "Подольск",
      "Коледино",
      "Электросталь",
      "Котовск",
    ],
  },
  {
    id: "south",
    name: "Южный регион",
    shortName: "ЮФО",
    percentage: 0.15,
    warehouses: ["Невинномысск", "Краснодар"],
  },
  {
    id: "volga",
    name: "Приволжский регион",
    shortName: "ПФО",
    percentage: 0.2,
    warehouses: ["Казань", "Самара (Новосемейкино)"],
  },
  {
    id: "ural",
    name: "Уральский регион",
    shortName: "УФО",
    percentage: 0.3,
    warehouses: [
      "Екатеринбург - Испытателей 14г",
      "Екатеринбург - Перспективный 12",
      "Екатеринбург - Перспективная 14",
    ],
  },
];

export function getDefaultRegions(): RegionConfig[] {
  return DEFAULT_REGIONS.map((r) => ({ ...r, warehouses: [...r.warehouses] }));
}

// ─── Region Groups (8 ФО) ────────────────────────────────────

export const ALL_DISTRICTS = [
  'Центральный федеральный округ',
  'Приволжский федеральный округ',
  'Сибирский федеральный округ',
  'Южный федеральный округ',
  'Северо-Западный федеральный округ',
  'Уральский федеральный округ',
  'Дальневосточный федеральный округ',
  'Северо-Кавказский федеральный округ',
];

const SHORT_DISTRICT: Record<string, string> = {
  'Центральный федеральный округ': 'ЦФО',
  'Приволжский федеральный округ': 'ПФО',
  'Сибирский федеральный округ': 'СФО',
  'Южный федеральный округ': 'ЮФО',
  'Северо-Западный федеральный округ': 'СЗФО',
  'Уральский федеральный округ': 'УФО',
  'Дальневосточный федеральный округ': 'ДФО',
  'Северо-Кавказский федеральный округ': 'СКФО',
};

export function shortDistrict(d: string): string {
  return SHORT_DISTRICT[d] || d;
}

const DEFAULT_REGION_GROUPS: RegionGroup[] = [
  {
    id: 'central-nw',
    name: 'Центр + Северо-Запад',
    shortName: 'ЦФО+СЗФО',
    districts: ['Центральный федеральный округ', 'Северо-Западный федеральный округ'],
    warehouses: ['Рязань (Тюшевское)', 'Тула', 'Подольск', 'Коледино', 'Электросталь', 'Котовск', 'Владимир', 'Воронеж', 'СЦ Брест'],
    manualPercentage: 0.35,
  },
  {
    id: 'south-caucasus',
    name: 'Юг + Кавказ',
    shortName: 'ЮФО+СКФО',
    districts: ['Южный федеральный округ', 'Северо-Кавказский федеральный округ'],
    warehouses: ['Невинномысск', 'Краснодар', 'Волгоград', 'СЦ Ереван'],
    manualPercentage: 0.15,
  },
  {
    id: 'volga',
    name: 'Приволжский',
    shortName: 'ПФО',
    districts: ['Приволжский федеральный округ'],
    warehouses: ['Казань', 'Самара (Новосемейкино)', 'Сарапул'],
    manualPercentage: 0.20,
  },
  {
    id: 'east',
    name: 'Урал + Сибирь + ДВ',
    shortName: 'УФО+СФО+ДФО',
    districts: ['Уральский федеральный округ', 'Сибирский федеральный округ', 'Дальневосточный федеральный округ'],
    warehouses: ['Екатеринбург - Испытателей 14г', 'Екатеринбург - Перспективный 12', 'Екатеринбург - Перспективная 14', 'Актобе', 'Атакент', 'Астана Карагандинское шоссе'],
    manualPercentage: 0.30,
  },
];

export function getDefaultRegionGroups(): RegionGroup[] {
  return DEFAULT_REGION_GROUPS.map((g) => ({
    ...g,
    districts: [...g.districts],
    warehouses: [...g.warehouses],
  }));
}

/** Конвертирует RegionGroup[] в RegionConfig[] для совместимости с V1/V2/V3.
 *  В auto-режиме читает проценты из предвычисленных агрегатов. */
export function toRegionConfigs(
  groups: RegionGroup[],
  mode: 'manual' | 'auto',
  aggregates: OrderAggregates | null
): RegionConfig[] {
  if (mode === 'manual' || !aggregates || aggregates.totalOrders === 0) {
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      shortName: g.shortName,
      percentage: g.manualPercentage,
      warehouses: g.warehouses,
    }));
  }
  // Auto: Все заказы (включая отмены) — отменённый заказ тоже = потребность со склада.
  // Заказы без ФО (СНГ) привязываем к группе по складу отправления.
  const total = aggregates.totalOrders;

  const warehouseToGroup = new Map<string, string>();
  for (const g of groups) {
    for (const wh of g.warehouses) warehouseToGroup.set(wh, g.id);
  }

  return groups.map((g) => {
    const districtsSet = new Set(g.districts);
    let groupOrders = 0;
    for (const entry of aggregates.perWarehouseRegion) {
      if (entry.federalDistrict && districtsSet.has(entry.federalDistrict)) {
        groupOrders += entry.count;
      } else if (!entry.federalDistrict && warehouseToGroup.get(entry.warehouse) === g.id) {
        groupOrders += entry.count;
      }
    }

    const rfInGroup = g.districts.reduce((s, d) => s + (aggregates.perDistrict[d] || 0), 0);
    const cisInGroup = groupOrders - rfInGroup;
    const rfPct = total > 0 ? (rfInGroup / total * 100).toFixed(1) : '0.0';
    const cisPct = total > 0 ? (cisInGroup / total * 100).toFixed(1) : '0.0';
    const totalPct = total > 0 ? (groupOrders / total * 100).toFixed(1) : '0.0';
    const districtStr = g.districts.map(d => shortDistrict(d)).join('+');
    let dynName = '';
    if (districtStr) {
      dynName = cisInGroup > 0
        ? `${districtStr} ${rfPct}% + СНГ ${cisPct}% = ${totalPct}%`
        : `${districtStr} ${totalPct}%`;
    }

    return {
      id: g.id,
      name: g.name,
      shortName: dynName || g.shortName,
      percentage: total > 0 ? groupOrders / total : g.manualPercentage,
      warehouses: g.warehouses,
    };
  });
}

/** Total orders for barcode (including cancels — отмена = потребность со склада). */
export function countOrdersByBarcode(
  aggregates: OrderAggregates | null,
  barcode: string
): number {
  if (!aggregates) return 0;
  return aggregates.perBarcode[barcode]?.totalOrders || 0;
}

export function getStockForBarcode(
  stock: StockItem[],
  barcode: string
): StockItem | undefined {
  return stock.find((s) => s.barcode === barcode);
}

function getFactForRegion(
  stock: StockItem[],
  barcode: string,
  warehouses: string[]
): { total: number; breakdown: Record<string, number> } {
  const item = stock.find((s) => s.barcode === barcode);
  const breakdown: Record<string, number> = {};
  let total = 0;

  if (!item) return { total: 0, breakdown };

  for (const wh of warehouses) {
    const val = item.warehouseStock[wh] || 0;
    breakdown[wh] = val;
    total += val;
  }

  return { total, breakdown };
}

/** Re-export for backward compatibility */
export const sortShipmentRows = sortBySize;

function calculateBoxes(
  plan: number,
  fact: number,
  perBox: number
): { boxes: number; pieces: number } {
  const deficit = plan - fact;
  if (deficit <= 0) return { boxes: 0, pieces: 0 };

  const rawBoxes = deficit / perBox;
  const boxes = Math.ceil(rawBoxes / 0.5) * 0.5;
  return { boxes, pieces: boxes * perBox };
}

/** Shared row-building logic for V1 and V2 */
function buildShipmentRows(
  product: Product,
  stock: StockItem[],
  aggregates: OrderAggregates | null,
  buyoutRate: number,
  regionConfigs: RegionConfig[],
  override?: ProductOverride,
  orderMultiplier: number = 1
): ShipmentRow[] {
  const disabledSizes = override?.disabledSizes || {};
  return product.sizes
    .filter((sc) => !disabledSizes[sc.barcode])
    .map((sizeConfig) => {
      const perBox = override?.perBox[sizeConfig.barcode] ?? sizeConfig.perBox;
      const sc = { ...sizeConfig, perBox };
      const orderCount = countOrdersByBarcode(aggregates, sc.barcode);
      const totalOrders30d = orderCount * buyoutRate * orderMultiplier;

      const regionShipments: RegionShipment[] = regionConfigs.map((region) => {
        const plan = totalOrders30d * region.percentage;
        const { total: fact, breakdown } = getFactForRegion(stock, sc.barcode, region.warehouses);
        const { boxes, pieces } = calculateBoxes(plan, fact, sc.perBox);
        return { regionId: region.id, plan, fact, boxes, pieces, warehouseBreakdown: breakdown };
      });

      const totalOnWB = regionShipments.reduce((sum, r) => sum + r.fact, 0);
      const planBoxes = regionShipments.reduce((sum, r) => sum + r.boxes, 0);

      return {
        size: sc.size,
        barcode: sc.barcode,
        perBox: sc.perBox,
        regions: regionShipments,
        totalOnWB,
        totalOrders30d,
        planBoxes,
        reserveBoxes: planBoxes * 1.5,
      };
    });
}

export function calculateShipment(
  product: Product,
  stock: StockItem[],
  aggregates: OrderAggregates | null,
  buyoutRate: number = 0.75,
  regions?: RegionConfig[],
  override?: ProductOverride
): ShipmentCalculation {
  const regionConfigs = regions || getDefaultRegions();
  const rows = buildShipmentRows(product, stock, aggregates, buyoutRate, regionConfigs, override);
  const sortedRows = sortShipmentRows(rows);

  return {
    product,
    buyoutRate,
    regionConfigs,
    rows: sortedRows,
    totals: {
      totalOnWB: rows.reduce((s, r) => s + r.totalOnWB, 0),
      totalOrders: rows.reduce((s, r) => s + r.totalOrders30d, 0),
    },
  };
}

export function calculateDeficit(row: ShipmentRow): number {
  return row.regions.reduce((sum, r) => {
    const deficit = r.plan - r.fact;
    return sum + (deficit > 0 ? deficit : 0);
  }, 0);
}

export function getOrderStats(orders: OrderRecord[]) {
  const total = orders.length;
  const cancels = orders.filter((o) => o.isCancel).length;
  const cancelRate = total > 0 ? cancels / total : 0;

  const bySize: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const byWarehouse: Record<string, number> = {};
  const byDate: Record<string, number> = {};

  for (const o of orders) {
    if (o.isCancel) continue;
    bySize[o.size] = (bySize[o.size] || 0) + 1;
    byRegion[o.federalDistrict] = (byRegion[o.federalDistrict] || 0) + 1;
    byWarehouse[o.warehouse] = (byWarehouse[o.warehouse] || 0) + 1;
    const dateKey = o.date.substring(0, 10);
    byDate[dateKey] = (byDate[dateKey] || 0) + 1;
  }

  return { total, cancels, cancelRate, bySize, byRegion, byWarehouse, byDate };
}

// ─── Auto Region Percentages (from real orders) ─────────────

/** Map of federalDistrict names to region IDs */
const DISTRICT_TO_REGION: Record<string, string> = {
  "Центральный федеральный округ": "central",
  "Центральный": "central",
  "ЦФО": "central",
  "Южный федеральный округ": "south",
  "Южный": "south",
  "ЮФО": "south",
  "Северо-Кавказский федеральный округ": "south", // объединяем с южным
  "Приволжский федеральный округ": "volga",
  "Приволжский": "volga",
  "ПФО": "volga",
  "Уральский федеральный округ": "ural",
  "Уральский": "ural",
  "УФО": "ural",
  "Сибирский федеральный округ": "ural", // объединяем с уральским
  "Дальневосточный федеральный округ": "ural",
  "Северо-Западный федеральный округ": "central", // объединяем с центральным
};

export interface AutoRegionPercent {
  regionId: string;
  orderCount: number;
  percentage: number;
}

/**
 * Рассчитывает реальное распределение заказов по регионам.
 * Возвращает проценты на основе фактических заказов.
 */
// ─── Auto Buyout Rate (per article) ─────────────────────────

export interface ArticleBuyoutRate {
  articleWB: string;
  totalOrders: number;
  cancelledOrders: number;
  buyoutRate: number; // 0-1
}

/**
 * Рассчитывает реальный % выкупа по каждому артикулу.
 * Если заказов < minOrders — возвращает fallback (общий %).
 */
export function calcBuyoutByArticle(
  orders: OrderRecord[],
  fallbackRate: number = 0.75,
  minOrders: number = 30
): Map<string, number> {
  const stats = new Map<string, { total: number; cancelled: number }>();

  for (const o of orders) {
    const key = String(o.articleWB);
    const s = stats.get(key) || { total: 0, cancelled: 0 };
    s.total++;
    if (o.isCancel) s.cancelled++;
    stats.set(key, s);
  }

  const result = new Map<string, number>();
  for (const [articleWB, s] of stats) {
    if (s.total < minOrders) {
      result.set(articleWB, fallbackRate);
    } else {
      result.set(articleWB, (s.total - s.cancelled) / s.total);
    }
  }

  return result;
}

/**
 * Get all article buyout rates as array (for display).
 */
export function getAllBuyoutRates(
  orders: OrderRecord[],
  fallbackRate: number = 0.75,
  minOrders: number = 30
): ArticleBuyoutRate[] {
  const stats = new Map<string, { total: number; cancelled: number }>();

  for (const o of orders) {
    const key = String(o.articleWB);
    const s = stats.get(key) || { total: 0, cancelled: 0 };
    s.total++;
    if (o.isCancel) s.cancelled++;
    stats.set(key, s);
  }

  const result: ArticleBuyoutRate[] = [];
  for (const [articleWB, s] of stats) {
    result.push({
      articleWB,
      totalOrders: s.total,
      cancelledOrders: s.cancelled,
      buyoutRate: s.total < minOrders ? fallbackRate : (s.total - s.cancelled) / s.total,
    });
  }

  return result.sort((a, b) => b.totalOrders - a.totalOrders);
}

// ─── Auto Region Percentages (from real orders) ─────────────

export function calcAutoRegionPercents(
  orders: OrderRecord[],
  regions: RegionConfig[]
): AutoRegionPercent[] {
  const counts: Record<string, number> = {};
  for (const r of regions) counts[r.id] = 0;

  let total = 0;
  for (const o of orders) {
    if (o.isCancel) continue;
    const regionId = DISTRICT_TO_REGION[o.federalDistrict] || DISTRICT_TO_REGION[o.federalDistrict.split(" ")[0]] || null;
    if (regionId && counts[regionId] !== undefined) {
      counts[regionId]++;
      total++;
    }
  }

  return regions.map((r) => ({
    regionId: r.id,
    orderCount: counts[r.id] || 0,
    percentage: total > 0 ? (counts[r.id] || 0) / total : r.percentage,
  }));
}

// ─── V2: Shipment with Trend Dynamics ─────────────────────

export interface ShipmentCalculationV2 extends ShipmentCalculation {
  trend: TrendResult;
  rowsV1: ShipmentRow[];    // Original V1 rows for comparison
}

export function calculateShipmentV2(
  product: Product,
  stock: StockItem[],
  aggregates: OrderAggregates | null,
  buyoutRate: number = 0.75,
  regions?: RegionConfig[],
  override?: ProductOverride,
  loadedDays: number = 28
): ShipmentCalculationV2 {
  const regionConfigs = regions || getDefaultRegions();
  const disabledSizes = override?.disabledSizes || {};
  const activeSizes = product.sizes.filter((sc) => !disabledSizes[sc.barcode]);

  // Product-level trend: суммируем weekly по всем активным размерам.
  // Данные берём из перевычисленных на сервере aggregates.perBarcode[barcode].weekly.
  const barcodes = activeSizes.map((s) => s.barcode);
  const firstBw = barcodes.length > 0 && aggregates
    ? aggregates.perBarcode[barcodes[0]]?.weekly || []
    : [];
  const numWeeks = firstBw.length || Math.max(1, Math.floor(loadedDays / 7));
  const allWeekly = Array.from({ length: numWeeks }, (_, i) => ({
    week: i + 1,
    label: `Нед. ${i + 1}`,
    orders: 0,
    dateRange: "",
  }));
  if (aggregates) {
    for (const barcode of barcodes) {
      const bw = aggregates.perBarcode[barcode]?.weekly || [];
      for (let i = 0; i < Math.min(bw.length, numWeeks); i++) {
        allWeekly[i].orders += bw[i].orders;
        if (!allWeekly[i].dateRange && bw[i].dateRange) {
          allWeekly[i].dateRange = bw[i].dateRange;
        }
      }
    }
  }
  const trend = calculateTrend(allWeekly, buyoutRate);

  // V1 rows (for comparison) — multiplier = 1
  const v1Rows = buildShipmentRows(product, stock, aggregates, buyoutRate, regionConfigs, override);

  // V2 rows (adjusted by trend multiplier)
  const rows = buildShipmentRows(product, stock, aggregates, buyoutRate, regionConfigs, override, trend.multiplier);

  const sortedRows = sortShipmentRows(rows);
  const sortedV1 = sortShipmentRows(v1Rows);

  return {
    product,
    buyoutRate,
    regionConfigs,
    rows: sortedRows,
    rowsV1: sortedV1,
    trend,
    totals: {
      totalOnWB: rows.reduce((s, r) => s + r.totalOnWB, 0),
      totalOrders: rows.reduce((s, r) => s + r.totalOrders30d, 0),
    },
  };
}
