/**
 * Excel-экспорт в формате таблицы сайта (План/Факт/Нужно по регионам).
 * Визуально повторяет нижнюю таблицу из ShipmentCalcV2.
 */
import XLSX from "xlsx-js-style";
import type { ShipmentRow, RegionConfig, ProductOverrides } from "@/types";
import type { ShipmentCalculationV2 } from "@/modules/shipment/lib/engine";

// ─── Colors ────────────────────────────────────────────────

const HEADER_FILL = { fgColor: { rgb: "1E1E3A" } };
const HEADER_FONT = { sz: 10, bold: true, color: { rgb: "FFFFFF" } };
const SUBHEADER_FILL = { fgColor: { rgb: "2A2A4A" } };
const SUBHEADER_FONT = { sz: 9, bold: true, color: { rgb: "B8B8D0" } };

const DATA_FONT = { sz: 10, color: { rgb: "E4E4EF" } };
const DATA_FONT_BOLD = { sz: 10, bold: true, color: { rgb: "FFFFFF" } };
const DATA_FONT_MUTED = { sz: 10, color: { rgb: "8888A8" } };
const NUM_FONT_GREEN = { sz: 10, bold: true, color: { rgb: "00B894" } };
const NUM_FONT_RED = { sz: 10, bold: true, color: { rgb: "FF6B6B" } };
const NUM_FONT_ORANGE = { sz: 10, bold: true, color: { rgb: "FDCB6E" } };

const BG_DARK = { fgColor: { rgb: "0A0A1A" } };
const BG_CARD = { fgColor: { rgb: "12122B" } };
const BG_CARD_ALT = { fgColor: { rgb: "161636" } };
const ACCENT_BORDER = { style: "thin" as const, color: { rgb: "6C5CE7" } };
const BORDER_THIN = { style: "thin" as const, color: { rgb: "1E1E3A" } };
const BORDER_ALL = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
const BORDER_ACCENT_TOP = { ...BORDER_ALL, top: ACCENT_BORDER };

type Align = Record<string, unknown>;
const A_CENTER: Align = { horizontal: "center", vertical: "center", wrapText: true };
const A_LEFT: Align = { horizontal: "left", vertical: "center", wrapText: true };
const A_RIGHT: Align = { horizontal: "right", vertical: "center" };

// ─── Helpers ───────────────────────────────────────────────

function setCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number | null,
  style: Record<string, unknown>
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (typeof value === "number") {
    ws[addr] = { t: "n", v: value, s: style };
  } else if (value !== null && value !== undefined && value !== "") {
    ws[addr] = { t: "s", v: String(value), s: style };
  } else {
    ws[addr] = { t: "s", v: "", s: style };
  }
}

function fmtNum(n: number, decimals = 0): string {
  if (decimals > 0) return n.toFixed(decimals);
  return Math.round(n).toString();
}

// ─── Main Export ───────────────────────────────────────────

export function exportShipmentExcelV2Table(
  calculations: ShipmentCalculationV2[],
  overrides: ProductOverrides = {}
) {
  if (calculations.length === 0) return;

  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  const regions = calculations[0].regionConfigs;
  const regionCount = regions.length;

  // ── Fixed columns: Артикул WB | Баркод | Артикул продавца | Размер | Шт/кор | На ВБ | V1 | V2 тренд | Нужно
  const FIXED_COLS = [
    "Артикул WB",
    "Баркод",
    "Артикул продавца",
    "Размер",
    "Шт/кор",
    "На ВБ",
    "V1",
    "V2 тренд",
    "Нужно",
  ];
  const fixedCount = FIXED_COLS.length;
  // Per region: План | Факт | Нужно (3 columns each)
  const totalCols = fixedCount + regionCount * 3;

  // ── Row 0: Header row 1 (fixed cols + region names spanning 3 cols each)
  let row = 0;

  // Fixed column headers (rowSpan=2 → merge rows 0-1)
  for (let c = 0; c < fixedCount; c++) {
    setCell(ws, 0, c, FIXED_COLS[c], {
      font: HEADER_FONT, fill: HEADER_FILL, alignment: A_CENTER, border: BORDER_ALL,
    });
    setCell(ws, 1, c, null, {
      font: HEADER_FONT, fill: HEADER_FILL, alignment: A_CENTER, border: BORDER_ALL,
    });
    merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  }

  // Region headers (colspan=3)
  for (let ri = 0; ri < regionCount; ri++) {
    const startCol = fixedCount + ri * 3;
    setCell(ws, 0, startCol, regions[ri].shortName, {
      font: HEADER_FONT, fill: HEADER_FILL, alignment: A_CENTER, border: BORDER_ALL,
    });
    setCell(ws, 0, startCol + 1, null, { font: HEADER_FONT, fill: HEADER_FILL, border: BORDER_ALL });
    setCell(ws, 0, startCol + 2, null, { font: HEADER_FONT, fill: HEADER_FILL, border: BORDER_ALL });
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 2 } });

    // Sub-headers: План | Факт | Нужно
    setCell(ws, 1, startCol, "План", { font: SUBHEADER_FONT, fill: SUBHEADER_FILL, alignment: A_CENTER, border: BORDER_ALL });
    setCell(ws, 1, startCol + 1, "Факт", { font: SUBHEADER_FONT, fill: SUBHEADER_FILL, alignment: A_CENTER, border: BORDER_ALL });
    setCell(ws, 1, startCol + 2, "Нужно", { font: SUBHEADER_FONT, fill: SUBHEADER_FILL, alignment: A_CENTER, border: BORDER_ALL });
  }

  row = 2; // data starts

  // ── Data rows
  // Flatten all calculations into rows (like "Все артикулы" mode)
  const allRows: {
    articleWB: string;
    articleName: string;
    barcode: string;
    vendorCode: string;
    sRow: ShipmentRow;
    v1Row: ShipmentRow;
    isFirstOfArticle: boolean;
    calcIndex: number;
  }[] = [];

  for (let ci = 0; ci < calculations.length; ci++) {
    const calc = calculations[ci];
    const articleWB = calc.product.articleWB;
    const articleName = overrides[articleWB]?.customName || calc.product.name;
    // Find vendor code from product sizes
    const vendorCode = calc.product.sizes[0]?.barcode ? articleWB : articleWB;

    for (let ri = 0; ri < calc.rows.length; ri++) {
      allRows.push({
        articleWB,
        articleName,
        barcode: calc.rows[ri].barcode,
        vendorCode: articleName, // product name as "Артикул продавца" field
        sRow: calc.rows[ri],
        v1Row: calc.rowsV1[ri] || calc.rows[ri],
        isFirstOfArticle: ri === 0,
        calcIndex: ci,
      });
    }
  }

  for (let i = 0; i < allRows.length; i++) {
    const { articleWB, articleName, barcode, sRow, v1Row, isFirstOfArticle, calcIndex } = allRows[i];
    const fill = calcIndex % 2 === 0 ? BG_CARD : BG_CARD_ALT;
    const border = isFirstOfArticle && i > 0 ? BORDER_ACCENT_TOP : BORDER_ALL;

    const cellStyle = (font = DATA_FONT, align: Align = A_RIGHT) => ({
      font, fill, alignment: align, border,
    });

    // Col 0: Артикул WB
    setCell(ws, row, 0, isFirstOfArticle ? articleWB : "", cellStyle(DATA_FONT, A_LEFT));
    // Col 1: Баркод
    setCell(ws, row, 1, barcode, cellStyle(DATA_FONT_MUTED, A_LEFT));
    // Col 2: Артикул продавца (product name)
    setCell(ws, row, 2, isFirstOfArticle ? articleName : "", cellStyle(DATA_FONT, A_LEFT));
    // Col 3: Размер
    setCell(ws, row, 3, sRow.size, cellStyle(DATA_FONT_BOLD, A_CENTER));
    // Col 4: Шт/кор
    setCell(ws, row, 4, sRow.perBox, cellStyle(DATA_FONT, A_CENTER));
    // Col 5: На ВБ
    setCell(ws, row, 5, sRow.totalOnWB, cellStyle(DATA_FONT, A_RIGHT));
    // Col 6: V1
    setCell(ws, row, 6, Math.round(v1Row.totalOrders30d * 10) / 10, cellStyle(DATA_FONT_MUTED, A_RIGHT));
    // Col 7: V2 тренд
    setCell(ws, row, 7, Math.round(sRow.totalOrders30d * 10) / 10, cellStyle(DATA_FONT_BOLD, A_RIGHT));
    // Col 8: Нужно (total need across all regions)
    const totalNeed = sRow.regions.reduce((s, r) => s + Math.max(0, Math.ceil(r.plan - r.fact)), 0);
    setCell(ws, row, 8, totalNeed, cellStyle(totalNeed > 0 ? NUM_FONT_ORANGE : DATA_FONT_MUTED, A_RIGHT));

    // Region columns: План | Факт | Нужно
    for (let ri = 0; ri < regionCount; ri++) {
      const reg = sRow.regions[ri];
      if (!reg) continue;
      const startCol = fixedCount + ri * 3;
      const need = Math.max(0, Math.ceil(reg.plan - reg.fact));
      const factOk = reg.fact >= reg.plan;

      setCell(ws, row, startCol, Math.round(reg.plan * 10) / 10, cellStyle(DATA_FONT, A_RIGHT));
      setCell(ws, row, startCol + 1, reg.fact, cellStyle(factOk ? NUM_FONT_GREEN : NUM_FONT_RED, A_RIGHT));
      setCell(ws, row, startCol + 2, need > 0 ? need : 0, cellStyle(need > 0 ? NUM_FONT_ORANGE : DATA_FONT_MUTED, A_RIGHT));
    }

    row++;
  }

  // ── Totals row
  const totalsStyle = (font: Record<string, unknown> = DATA_FONT_BOLD) => ({
    font, fill: HEADER_FILL, alignment: A_RIGHT, border: BORDER_ALL,
  });

  setCell(ws, row, 0, "Итого", { font: { sz: 11, bold: true, color: { rgb: "FFFFFF" } }, fill: HEADER_FILL, alignment: A_LEFT, border: BORDER_ALL });
  for (let c = 1; c < 4; c++) setCell(ws, row, c, null, totalsStyle());
  setCell(ws, row, 4, null, totalsStyle());

  // Sum На ВБ
  const sumOnWB = allRows.reduce((s, r) => s + r.sRow.totalOnWB, 0);
  setCell(ws, row, 5, sumOnWB, totalsStyle());

  // Sum V1
  const sumV1 = allRows.reduce((s, r) => s + r.v1Row.totalOrders30d, 0);
  setCell(ws, row, 6, Math.round(sumV1 * 10) / 10, totalsStyle(DATA_FONT_MUTED));

  // Sum V2
  const sumV2 = allRows.reduce((s, r) => s + r.sRow.totalOrders30d, 0);
  setCell(ws, row, 7, Math.round(sumV2 * 10) / 10, totalsStyle());

  // Sum Нужно
  const sumNeed = allRows.reduce((s, r) => s + r.sRow.regions.reduce((rs, reg) => rs + Math.max(0, Math.ceil(reg.plan - reg.fact)), 0), 0);
  setCell(ws, row, 8, sumNeed, totalsStyle());

  // Region totals
  for (let ri = 0; ri < regionCount; ri++) {
    const startCol = fixedCount + ri * 3;
    const planSum = allRows.reduce((s, r) => s + (r.sRow.regions[ri]?.plan || 0), 0);
    const factSum = allRows.reduce((s, r) => s + (r.sRow.regions[ri]?.fact || 0), 0);
    const needSum = allRows.reduce((s, r) => {
      const reg = r.sRow.regions[ri];
      return s + Math.max(0, Math.ceil((reg?.plan || 0) - (reg?.fact || 0)));
    }, 0);

    setCell(ws, row, startCol, Math.round(planSum * 10) / 10, totalsStyle());
    setCell(ws, row, startCol + 1, factSum, totalsStyle(factSum >= planSum ? NUM_FONT_GREEN : NUM_FONT_RED));
    setCell(ws, row, startCol + 2, needSum, totalsStyle());
  }

  // ── Worksheet settings
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: totalCols - 1 } });
  ws["!merges"] = merges;

  // Column widths
  const cols: XLSX.ColInfo[] = [
    { wch: 16 },  // Артикул WB
    { wch: 18 },  // Баркод
    { wch: 30 },  // Артикул продавца
    { wch: 10 },  // Размер
    { wch: 8 },   // Шт/кор
    { wch: 10 },  // На ВБ
    { wch: 10 },  // V1
    { wch: 12 },  // V2 тренд
    { wch: 10 },  // Нужно
  ];
  for (let ri = 0; ri < regionCount; ri++) {
    cols.push({ wch: 10 }); // План
    cols.push({ wch: 10 }); // Факт
    cols.push({ wch: 10 }); // Нужно
  }
  ws["!cols"] = cols;

  // Row heights
  ws["!rows"] = [];
  ws["!rows"][0] = { hpx: 28 };
  ws["!rows"][1] = { hpx: 22 };

  XLSX.utils.book_append_sheet(wb, ws, "Отгрузка");

  // Download
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Отгрузка_таблица_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
