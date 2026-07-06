import type { RegionShipment, ShipmentRow } from "@/types";

export interface ManualSupplyDeductionEntry {
  total: number;
  byRegion: Record<string, number>;
  unmatched?: number;
}

export type ManualSupplyDeductByBarcode = Map<string, ManualSupplyDeductionEntry | number>;

export interface ManualSupplyDeductionMeta {
  available: number;
  applied: number;
  leftover: number;
}

export interface ManualSupplyDeductionResult<T extends ShipmentRow> {
  rows: T[];
  metaByBarcode: Record<string, ManualSupplyDeductionMeta>;
  totalAvailable: number;
  totalApplied: number;
  totalLeftover: number;
}

function roundBoxes(boxes: number): number {
  return Math.round(boxes * 1000) / 1000;
}

function calculateBoxes(plan: number, fact: number, perBox: number) {
  const deficit = plan - fact;
  if (deficit <= 0 || perBox <= 0) return { boxes: 0, pieces: 0 };
  const boxes = Math.ceil((deficit / perBox) / 0.5) * 0.5;
  return { boxes: roundBoxes(boxes), pieces: boxes * perBox };
}

function applyDeductionToRegions(regions: RegionShipment[], perBox: number, quantity: number) {
  const deficits = regions.map((region) => Math.max(0, region.plan - region.fact));
  const totalDeficit = deficits.reduce((sum, value) => sum + value, 0);
  const applied = Math.min(Math.max(0, quantity), totalDeficit);

  if (applied <= 0 || totalDeficit <= 0) {
    return { regions, applied: 0 };
  }

  let remaining = applied;
  const adjusted = regions.map((region, index) => {
    const deficit = deficits[index] || 0;
    const addition = index === regions.length - 1
      ? remaining
      : Math.min(deficit, applied * (deficit / totalDeficit));
    remaining = Math.max(0, remaining - addition);
    const fact = region.fact + addition;
    const { boxes, pieces } = calculateBoxes(region.plan, fact, perBox);

    return {
      ...region,
      fact,
      boxes,
      pieces,
    };
  });

  return { regions: adjusted, applied };
}

function applyDeductionToTargetRegions(regions: RegionShipment[], perBox: number, entry: ManualSupplyDeductionEntry) {
  let applied = 0;

  const adjusted = regions.map((region) => {
    const quantity = Number(entry.byRegion?.[region.regionId] || 0);
    if (quantity <= 0) return region;

    const deficit = Math.max(0, region.plan - region.fact);
    const addition = Math.min(quantity, deficit);
    if (addition <= 0) return region;

    applied += addition;
    const fact = region.fact + addition;
    const { boxes, pieces } = calculateBoxes(region.plan, fact, perBox);

    return {
      ...region,
      fact,
      boxes,
      pieces,
    };
  });

  return { regions: adjusted, applied };
}

export function applyManualSupplyDeductions<T extends ShipmentRow>(
  rows: T[],
  deductByBarcode: ManualSupplyDeductByBarcode | undefined,
): ManualSupplyDeductionResult<T> {
  const metaByBarcode: Record<string, ManualSupplyDeductionMeta> = {};
  let totalAvailable = 0;
  let totalApplied = 0;

  const adjustedRows = rows.map((row) => {
    const rawEntry = deductByBarcode?.get(row.barcode);
    if (!rawEntry) return row;

    const entry: ManualSupplyDeductionEntry = typeof rawEntry === "number"
      ? { total: rawEntry, byRegion: {} }
      : rawEntry;
    const available = Number(entry.total || 0) + Number(entry.unmatched || 0);
    if (available <= 0) return row;

    totalAvailable += available;
    const hasTargetRegions = Object.keys(entry.byRegion || {}).length > 0;
    const { regions, applied } = hasTargetRegions
      ? applyDeductionToTargetRegions(row.regions, row.perBox, entry)
      : applyDeductionToRegions(row.regions, row.perBox, available);
    totalApplied += applied;
    metaByBarcode[row.barcode] = {
      available,
      applied,
      leftover: Math.max(0, available - applied),
    };

    return {
      ...row,
      regions,
      planBoxes: regions.reduce((sum, region) => sum + region.boxes, 0),
      reserveBoxes: regions.reduce((sum, region) => sum + region.boxes, 0) * 1.5,
    };
  });

  return {
    rows: adjustedRows,
    metaByBarcode,
    totalAvailable,
    totalApplied,
    totalLeftover: Math.max(0, totalAvailable - totalApplied),
  };
}
