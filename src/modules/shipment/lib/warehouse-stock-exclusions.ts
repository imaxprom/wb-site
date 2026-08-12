import type { StockItem } from "@/types";

export interface WarehouseStockSummaryRow {
  name: string;
  units: number;
  barcodes: number;
  articles: number;
  excluded: boolean;
  presentInCurrentStock: boolean;
}

export interface WarehouseStockSummary {
  totalUnits: number;
  includedUnits: number;
  excludedUnits: number;
  excludedWarehouseCount: number;
  rows: WarehouseStockSummaryRow[];
}

export function normalizeExcludedWarehouseNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "ru"));
}

export function filterStockByExcludedWarehouses(
  stock: StockItem[],
  excludedWarehouseNames: unknown,
): StockItem[] {
  const excluded = new Set(normalizeExcludedWarehouseNames(excludedWarehouseNames));
  if (excluded.size === 0) return stock;

  return stock.map((item) => {
    const warehouseEntries = Object.entries(item.warehouseStock || {});
    if (warehouseEntries.length === 0) return item;

    const warehouseStock = Object.fromEntries(
      warehouseEntries.filter(([warehouse]) => !excluded.has(warehouse.trim())),
    );
    const totalOnWarehouses = Object.values(warehouseStock)
      .reduce((sum, quantity) => sum + Number(quantity || 0), 0);

    return {
      ...item,
      totalOnWarehouses,
      warehouseStock,
    };
  });
}

export function summarizeWarehouseStock(
  stock: StockItem[],
  excludedWarehouseNames: unknown,
  knownWarehouseNames: Iterable<string> = [],
): WarehouseStockSummary {
  const excludedNames = normalizeExcludedWarehouseNames(excludedWarehouseNames);
  const excluded = new Set(excludedNames);
  const byWarehouse = new Map<string, {
    units: number;
    barcodes: Set<string>;
    articles: Set<string>;
  }>();

  let unassignedUnits = 0;
  for (const item of stock) {
    const warehouseEntries = Object.entries(item.warehouseStock || {});
    if (warehouseEntries.length === 0) {
      unassignedUnits += Number(item.totalOnWarehouses || 0);
      continue;
    }

    for (const [rawWarehouse, rawQuantity] of warehouseEntries) {
      const name = rawWarehouse.trim();
      if (!name) {
        unassignedUnits += Number(rawQuantity || 0);
        continue;
      }
      const current = byWarehouse.get(name) || {
        units: 0,
        barcodes: new Set<string>(),
        articles: new Set<string>(),
      };
      current.units += Number(rawQuantity || 0);
      if (item.barcode) current.barcodes.add(item.barcode);
      if (item.articleWB) current.articles.add(item.articleWB);
      byWarehouse.set(name, current);
    }
  }

  const rows: WarehouseStockSummaryRow[] = Array.from(byWarehouse.entries()).map(([name, value]) => ({
    name,
    units: value.units,
    barcodes: value.barcodes.size,
    articles: value.articles.size,
    excluded: excluded.has(name),
    presentInCurrentStock: true,
  }));

  const configuredNames = normalizeExcludedWarehouseNames([
    ...excludedNames,
    ...Array.from(knownWarehouseNames),
  ]);
  for (const name of configuredNames) {
    if (byWarehouse.has(name)) continue;
    rows.push({
      name,
      units: 0,
      barcodes: 0,
      articles: 0,
      excluded: excluded.has(name),
      presentInCurrentStock: false,
    });
  }

  rows.sort((left, right) => {
    if (left.excluded !== right.excluded) return left.excluded ? -1 : 1;
    return left.name.localeCompare(right.name, "ru");
  });

  const listedUnits = rows.reduce((sum, row) => sum + row.units, 0);
  const totalUnits = listedUnits + unassignedUnits;
  const excludedUnits = rows
    .filter((row) => row.excluded)
    .reduce((sum, row) => sum + row.units, 0);

  return {
    totalUnits,
    includedUnits: totalUnits - excludedUnits,
    excludedUnits,
    excludedWarehouseCount: excludedNames.length,
    rows,
  };
}
