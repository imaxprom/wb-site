import type {
  Product,
  RegionConfig,
  StockItem,
  OrderRecord,
  ShipmentCalculation,
  ShipmentRow,
  RegionShipment,
} from "@/types";
import { sortBySize } from "./size-utils";

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

export function countOrdersByBarcode(
  orders: OrderRecord[],
  barcode: string
): number {
  return orders.filter((o) => o.barcode === barcode && !o.isCancel).length;
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

export function calculateShipment(
  product: Product,
  stock: StockItem[],
  orders: OrderRecord[],
  buyoutRate: number = 0.75,
  regions?: RegionConfig[]
): ShipmentCalculation {
  const regionConfigs = regions || getDefaultRegions();

  const rows: ShipmentRow[] = product.sizes.map((sizeConfig) => {
    const orderCount = countOrdersByBarcode(orders, sizeConfig.barcode);
    const totalOrders30d = orderCount * buyoutRate;

    const regionShipments: RegionShipment[] = regionConfigs.map((region) => {
      const plan = totalOrders30d * region.percentage;
      const { total: fact, breakdown } = getFactForRegion(
        stock,
        sizeConfig.barcode,
        region.warehouses
      );
      const { boxes, pieces } = calculateBoxes(plan, fact, sizeConfig.perBox);

      return {
        regionId: region.id,
        plan,
        fact,
        boxes,
        pieces,
        warehouseBreakdown: breakdown,
      };
    });

    const totalOnWB = regionShipments.reduce((sum, r) => sum + r.fact, 0);
    const planBoxes = regionShipments.reduce((sum, r) => sum + r.boxes, 0);

    return {
      size: sizeConfig.size,
      barcode: sizeConfig.barcode,
      perBox: sizeConfig.perBox,
      regions: regionShipments,
      totalOnWB,
      totalOrders30d,
      planBoxes,
      reserveBoxes: planBoxes * 1.5,
    };
  });

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
