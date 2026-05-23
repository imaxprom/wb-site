import type { WarehouseReadyStockRow } from "@/types";

export type WarehouseStockUnit = "boxes" | "units";

export interface WarehouseStockCellStatus {
  status: "matched" | "warning" | "missing";
  reason: string;
}

export interface WarehouseStockCellMatch {
  value: string;
  status?: WarehouseStockCellStatus;
}

interface WarehouseMatchCandidate extends WarehouseReadyStockRow {
  normalizedRange: string;
  labelTokens: string[];
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

function formatValue(value: number | null | undefined, unit: WarehouseStockUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const rounded = unit === "boxes"
    ? Math.round(value * 100) / 100
    : Math.round(value * 100) / 100;
  return String(rounded);
}

function candidateValue(row: WarehouseReadyStockRow, unit: WarehouseStockUnit): number | null {
  return unit === "boxes" ? row.boxes_qty : row.units_qty;
}

export function matchWarehouseStockCell(
  warehouseRows: WarehouseReadyStockRow[],
  articleWB: string,
  shipmentSize: string,
  shipmentPerBox: number,
  unit: WarehouseStockUnit,
): WarehouseStockCellMatch | null {
  const articleRows = warehouseRows
    .filter((row) => String(row.article_wb) === String(articleWB))
    .map((row): WarehouseMatchCandidate => ({
      ...row,
      normalizedRange: normalizeRange(row.size_range),
      labelTokens: extractSizeTokens(row.size_label),
    }));

  if (articleRows.length === 0) return null;

  const shipmentRange = extractRange(shipmentSize);
  const shipmentTokens = extractSizeTokens(shipmentSize);
  const rangeMatches = shipmentRange
    ? articleRows.filter((row) => row.normalizedRange === shipmentRange)
    : [];

  let candidate: WarehouseMatchCandidate | null = null;
  let warning = "";

  if (rangeMatches.length === 1) {
    candidate = rangeMatches[0];
    if (!compatibleTokens(shipmentTokens, candidate.labelTokens)) {
      warning = `Размер найден по диапазону ${shipmentRange}, но буквы отличаются: склад ${candidate.size_label}, WB ${shipmentSize}`;
    }
  } else if (rangeMatches.length > 1) {
    candidate = rangeMatches[0];
    warning = `Для диапазона ${shipmentRange} найдено несколько складских строк`;
  } else {
    const tokenMatches = shipmentTokens.length > 0
      ? articleRows.filter((row) => compatibleTokens(shipmentTokens, row.labelTokens) && row.labelTokens.length > 0)
      : [];
    if (tokenMatches.length === 1) {
      candidate = tokenMatches[0];
      warning = `Совпадение только по буквам размера: склад ${candidate.size_label}_${candidate.size_range}, WB ${shipmentSize}`;
    } else {
      return null;
    }
  }

  const value = candidateValue(candidate, unit);
  if (candidate.per_box && shipmentPerBox && Number(candidate.per_box) !== Number(shipmentPerBox)) {
    warning = warning
      ? `${warning}; шт/кор отличается: склад ${candidate.per_box}, WB ${shipmentPerBox}`
      : `Шт/кор отличается: склад ${candidate.per_box}, WB ${shipmentPerBox}`;
  }

  return {
    value: formatValue(value, unit),
    status: warning
      ? { status: "warning", reason: warning }
      : { status: "matched", reason: `Склад: ${candidate.size_label}_${candidate.size_range}` },
  };
}

export function buildWarehouseStockByBarcode(
  warehouseRows: WarehouseReadyStockRow[],
  items: Array<{ articleWB: string; size: string; barcode: string; perBox: number }>,
  unit: WarehouseStockUnit,
): {
  values: Record<string, string>;
  statuses: Record<string, WarehouseStockCellStatus>;
  syncKey: string;
} {
  const values: Record<string, string> = {};
  const statuses: Record<string, WarehouseStockCellStatus> = {};

  for (const item of items) {
    const match = matchWarehouseStockCell(warehouseRows, item.articleWB, item.size, item.perBox, unit);
    if (!match) continue;
    if (match.value !== "") values[item.barcode] = match.value;
    if (match.status) statuses[item.barcode] = match.status;
  }

  const syncKey = JSON.stringify({ unit, values, statuses });
  return { values, statuses, syncKey };
}
