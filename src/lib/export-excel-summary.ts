/**
 * Excel-экспорт сводной таблицы по артикулам (V2 "Кораба" / V3 "В").
 * Нейтральная палитра, чёрные рамки, чередование бело-зелёного, вшитые формулы.
 */
import XLSX from "xlsx-js-style";
import type { PackingItem, PackingResult } from "@/lib/packing-engine";

interface ExportInput {
  packingByRegion: Array<{ region: { id: string; shortName: string }; packing: PackingResult }>;
  rowMeta?: Record<string, { plan: number; fact: number; need: number }>;
}

// ─── Styles ────────────────────────────────────────────────
const BORDER_THIN = { style: "thin" as const, color: { rgb: "000000" } };
const BORDER_THICK = { style: "medium" as const, color: { rgb: "000000" } };
const BORDER_ALL_THIN = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

const FILL_WHITE = { fgColor: { rgb: "FFFFFF" } };
const FILL_GREEN = { fgColor: { rgb: "E8F5E9" } };
const FILL_GRAY = { fgColor: { rgb: "F5F5F5" } };
const FILL_GRAY_STRONG = { fgColor: { rgb: "E0E0E0" } };
const FILL_SAMPLE = { fgColor: { rgb: "FFFDE7" } };

const FONT_NORMAL = { sz: 18, color: { rgb: "000000" } };
const FONT_BOLD = { sz: 18, bold: true, color: { rgb: "000000" } };
const FONT_MUTED = { sz: 18, color: { rgb: "757575" } };

const ALIGN_CENTER = { horizontal: "center", vertical: "center", wrapText: true };
const ALIGN_CENTER_NOWRAP = { horizontal: "center", vertical: "center", wrapText: false };
const ALIGN_LEFT = { horizontal: "left", vertical: "center", wrapText: true };

// ─── Helpers ───────────────────────────────────────────────
function ref(r: number, c: number): string {
  return XLSX.utils.encode_cell({ r, c });
}

function sizeSortKey(s: string): number {
  const LO: Record<string, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7 };
  const num = s.match(/\d+/);
  if (num) return parseInt(num[0], 10);
  return LO[s.trim().toUpperCase()] ?? 999;
}

function setV(ws: XLSX.WorkSheet, r: number, c: number, v: string | number | null, s: Record<string, unknown>) {
  const addr = ref(r, c);
  if (typeof v === "number") ws[addr] = { t: "n", v, s };
  else if (v !== null && v !== undefined && v !== "") ws[addr] = { t: "s", v: String(v), s };
  else ws[addr] = { t: "s", v: "", s };
}

function setF(ws: XLSX.WorkSheet, r: number, c: number, formula: string, computed: number | null, s: Record<string, unknown>) {
  const addr = ref(r, c);
  ws[addr] = { t: "n", f: formula, v: computed ?? 0, s };
}

// ─── Main ──────────────────────────────────────────────────
export function exportShipmentExcelSummary({ packingByRegion, rowMeta }: ExportInput) {
  if (packingByRegion.length === 0) return;

  // Aggregate
  type SizeRow = { item: PackingItem; qtyByRegion: Record<string, number> };
  type Article = { articleWB: string; productName: string; sizes: SizeRow[]; totalUnits: number };
  const map = new Map<string, Article>();
  for (const { region, packing } of packingByRegion) {
    for (const box of packing.boxes) {
      for (const entry of box.items) {
        const { item, qty } = entry;
        if (qty <= 0) continue;
        if (!map.has(item.articleWB)) {
          map.set(item.articleWB, { articleWB: item.articleWB, productName: item.productName || item.articleName || "—", sizes: [], totalUnits: 0 });
        }
        const art = map.get(item.articleWB)!;
        let sr = art.sizes.find(s => s.item.barcode === item.barcode);
        if (!sr) { sr = { item, qtyByRegion: {} }; art.sizes.push(sr); }
        sr.qtyByRegion[region.id] = (sr.qtyByRegion[region.id] || 0) + qty;
        art.totalUnits += qty;
      }
    }
  }
  for (const [k, art] of map) {
    let tb = 0;
    for (const sr of art.sizes) for (const rid in sr.qtyByRegion) {
      tb += sr.item.perBox > 0 ? Math.round((sr.qtyByRegion[rid] / sr.item.perBox) * 2) / 2 : 0;
    }
    if (tb === 0) map.delete(k);
  }
  for (const art of map.values()) art.sizes.sort((a, b) => sizeSortKey(a.item.size) - sizeSortKey(b.item.size));
  const articles = Array.from(map.values()).sort((a, b) => b.totalUnits - a.totalUnits);
  if (articles.length === 0) return;

  const regions = packingByRegion.map(p => p.region);
  const N = regions.length;
  // Col map: 0 Art | 1 Size | 2 perBox | 3 Barcode | 4 Plan | 5 Fact | 6 Need | 7 Stock | 8..8+2N-1 Regions | 8+2N Sverka | +1 ShipBoxes | +2 ShipUnits | +3 Delta
  const SVERKA_C = 8 + N * 2;
  const SHIP_BOXES_C = SVERKA_C + 1;
  const SHIP_UNITS_C = SVERKA_C + 2;
  const DELTA_C = SVERKA_C + 3;
  const COL_COUNT = 8 + N * 2 + 4;

  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  // ── Headers (rows 0-1) ──
  const hdrMainStyle = { font: FONT_BOLD, fill: FILL_GRAY_STRONG, alignment: ALIGN_CENTER, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THIN, right: BORDER_THIN } };
  const hdrSubStyle = { font: FONT_BOLD, fill: FILL_GRAY, alignment: ALIGN_CENTER, border: BORDER_ALL_THIN };

  const fixedCols = [
    { c: 0, label: "Артикул" },
    { c: 1, label: "Размер" },
    { c: 2, label: "Штук в коробе" },
    { c: 3, label: "Баркод" },
    { c: 4, label: "План" },
    { c: 5, label: "Факт" },
    { c: 6, label: "Нужно" },
    { c: 7, label: "Всего на складе" },
  ];
  for (const { c, label } of fixedCols) {
    setV(ws, 0, c, label, hdrMainStyle);
    setV(ws, 1, c, "", hdrMainStyle);
    merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  }
  // Region groups — thick vertical separators on group edges
  for (let i = 0; i < N; i++) {
    const colStart = 8 + i * 2;
    const hdrMainWithSep = { ...hdrMainStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THICK } };
    setV(ws, 0, colStart, regions[i].shortName, hdrMainWithSep);
    setV(ws, 0, colStart + 1, "", hdrMainWithSep);
    merges.push({ s: { r: 0, c: colStart }, e: { r: 0, c: colStart + 1 } });
    setV(ws, 1, colStart, "Коробов", { ...hdrSubStyle, border: { ...BORDER_ALL_THIN, left: BORDER_THICK } });
    setV(ws, 1, colStart + 1, "Штук", { ...hdrSubStyle, border: { ...BORDER_ALL_THIN, right: BORDER_THICK } });
  }
  // Sverka (rowspan 2) — thick on both sides
  const sverkaHdrStyle = { ...hdrMainStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THICK } };
  setV(ws, 0, SVERKA_C, "Сверка", sverkaHdrStyle);
  setV(ws, 1, SVERKA_C, "", sverkaHdrStyle);
  merges.push({ s: { r: 0, c: SVERKA_C }, e: { r: 1, c: SVERKA_C } });
  // Отгружено (colspan 3) — thick on both sides of the whole group
  const shipHdrStyle = { ...hdrMainStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THICK } };
  setV(ws, 0, SHIP_BOXES_C, "Отгружено", shipHdrStyle);
  setV(ws, 0, SHIP_UNITS_C, "", shipHdrStyle);
  setV(ws, 0, DELTA_C, "", shipHdrStyle);
  merges.push({ s: { r: 0, c: SHIP_BOXES_C }, e: { r: 0, c: DELTA_C } });
  setV(ws, 1, SHIP_BOXES_C, "Коробов", { ...hdrSubStyle, border: { ...BORDER_ALL_THIN, left: BORDER_THICK } });
  setV(ws, 1, SHIP_UNITS_C, "Штук", hdrSubStyle);
  setV(ws, 1, DELTA_C, "Δ", { ...hdrSubStyle, border: { ...BORDER_ALL_THIN, right: BORDER_THICK } });

  // ── Body ──
  let r = 2;
  const dataFirstRow = r;

  articles.forEach((art, artIdx) => {
    const articleFill = artIdx % 2 === 0 ? FILL_WHITE : FILL_GREEN;
    const rowsInArticle = art.sizes.length + 1; // + образец
    const firstRow = r;
    // Article cell (merged vertically)
    const artStyle = {
      font: FONT_BOLD,
      fill: articleFill,
      alignment: ALIGN_CENTER,
      border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THICK },
    };
    setV(ws, firstRow, 0, `${art.productName}\nWB: ${art.articleWB}`, artStyle);
    for (let rr = firstRow + 1; rr < firstRow + rowsInArticle; rr++) setV(ws, rr, 0, "", artStyle);
    merges.push({ s: { r: firstRow, c: 0 }, e: { r: firstRow + rowsInArticle - 1, c: 0 } });

    art.sizes.forEach((sr, sizeIdx) => {
      const perBox = sr.item.perBox;
      const meta = rowMeta?.[sr.item.barcode];
      const isFirstOfArticle = sizeIdx === 0;
      // Top border thick on first row of each article block (separator line)
      const topBorder = isFirstOfArticle ? BORDER_THICK : BORDER_THIN;
      const baseBorder = { top: topBorder, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
      const normal = { font: FONT_NORMAL, fill: articleFill, alignment: ALIGN_CENTER_NOWRAP, border: baseBorder };
      const muted = { font: FONT_MUTED, fill: articleFill, alignment: ALIGN_CENTER_NOWRAP, border: baseBorder };
      const gray = { font: FONT_NORMAL, fill: FILL_GRAY, alignment: ALIGN_CENTER_NOWRAP, border: baseBorder };
      const bold = { font: FONT_BOLD, fill: articleFill, alignment: ALIGN_CENTER_NOWRAP, border: baseBorder };

      setV(ws, r, 1, sr.item.size, normal);
      setV(ws, r, 2, perBox, normal);
      setV(ws, r, 3, sr.item.barcode, normal);
      // Plan / Fact
      setV(ws, r, 4, meta ? Math.round(meta.plan) : null, normal);
      setV(ws, r, 5, meta ? Math.round(meta.fact) : null, muted);
      // Need: formula MAX(0, Plan - Fact). Computed display fallback.
      const planRef = ref(r, 4);
      const factRef = ref(r, 5);
      setF(ws, r, 6, `=MAX(0,${planRef}-${factRef})`, meta ? Math.round(meta.need) : 0, bold);
      // Stock — user input (empty grey)
      setV(ws, r, 7, null, gray);

      // Regions: boxes (value) + units (formula = boxes × perBox) + thick side borders
      for (let i = 0; i < N; i++) {
        const region = regions[i];
        const qty = sr.qtyByRegion[region.id] || 0;
        const boxes = perBox > 0 ? Math.round((qty / perBox) * 2) / 2 : 0;
        const boxesCol = 8 + i * 2;
        const unitsCol = boxesCol + 1;
        const boxesBorder = { ...baseBorder, left: BORDER_THICK };
        const unitsBorder = { ...baseBorder, right: BORDER_THICK };
        setV(ws, r, boxesCol, boxes > 0 ? boxes : null, { ...(boxes > 0 ? bold : muted), border: boxesBorder });
        const perBoxRef = ref(r, 2);
        const boxesRef = ref(r, boxesCol);
        setF(ws, r, unitsCol, `=IFERROR(${boxesRef}*${perBoxRef},"")`, boxes * perBox, { ...muted, border: unitsBorder });
      }

      // Shipped Boxes (sum of region boxes)
      const regionBoxesRefs = Array.from({ length: N }, (_, i) => ref(r, 8 + i * 2));
      const sumBoxesFormula = `=SUM(${regionBoxesRefs.join(",")})`;
      const computedShipBoxes = regionBoxesRefs.reduce((s, _, i) => {
        const qty = sr.qtyByRegion[regions[i].id] || 0;
        return s + (perBox > 0 ? Math.round((qty / perBox) * 2) / 2 : 0);
      }, 0);
      setF(ws, r, SHIP_BOXES_C, sumBoxesFormula, computedShipBoxes, { ...bold, border: { ...baseBorder, left: BORDER_THICK } });
      // Shipped Units (sum of region units)
      const regionUnitsRefs = Array.from({ length: N }, (_, i) => ref(r, 8 + i * 2 + 1));
      const sumUnitsFormula = `=SUM(${regionUnitsRefs.join(",")})`;
      setF(ws, r, SHIP_UNITS_C, sumUnitsFormula, computedShipBoxes * perBox, bold);

      // Sverka (thick both sides), Shipped (left thick on boxes, right thick on Δ)
      const sverkaBorder = { ...baseBorder, left: BORDER_THICK, right: BORDER_THICK };
      const shipBoxesBorder = { ...baseBorder, left: BORDER_THICK };
      const deltaBorder = { ...baseBorder, right: BORDER_THICK };
      const stockRef = ref(r, 7);
      const shipBoxesRef = ref(r, SHIP_BOXES_C);
      setF(ws, r, SVERKA_C, `=IF(${stockRef}="","",${stockRef}-${shipBoxesRef})`, 0, { ...bold, border: sverkaBorder });

      const needRef = ref(r, 6);
      const shipUnitsRef = ref(r, SHIP_UNITS_C);
      setF(ws, r, DELTA_C, `=${shipUnitsRef}-${needRef}`, meta ? Math.round(computedShipBoxes * perBox - meta.need) : 0, { ...bold, border: deltaBorder });

      r += 1;
    });

    // Образец row
    const sampleStyle = { font: { ...FONT_MUTED, italic: true }, fill: FILL_SAMPLE, alignment: ALIGN_CENTER, border: BORDER_ALL_THIN };
    const sampleCenterStyle = { ...sampleStyle, alignment: ALIGN_LEFT };
    setV(ws, r, 1, "образец", sampleCenterStyle);
    setV(ws, r, 2, null, sampleStyle);
    setV(ws, r, 3, null, sampleStyle);
    setV(ws, r, 4, null, sampleStyle);
    setV(ws, r, 5, null, sampleStyle);
    setV(ws, r, 6, null, sampleStyle);
    setV(ws, r, 7, null, sampleStyle);
    // Region cells empty-editable with thick side borders
    for (let i = 0; i < N; i++) {
      setV(ws, r, 8 + i * 2, null, { ...sampleStyle, border: { ...BORDER_ALL_THIN, left: BORDER_THICK } });
      setV(ws, r, 8 + i * 2 + 1, null, { ...sampleStyle, border: { ...BORDER_ALL_THIN, right: BORDER_THICK } });
    }
    // Sample sum formulas — hide 0 until user fills values
    const sampleBoxRefs = Array.from({ length: N }, (_, i) => ref(r, 8 + i * 2));
    const sampleUnitRefs = Array.from({ length: N }, (_, i) => ref(r, 8 + i * 2 + 1));
    setV(ws, r, SVERKA_C, null, { ...sampleStyle, border: { ...BORDER_ALL_THIN, left: BORDER_THICK, right: BORDER_THICK } });
    setF(ws, r, SHIP_BOXES_C, `=IF(SUM(${sampleBoxRefs.join(",")})=0,"",SUM(${sampleBoxRefs.join(",")}))`, 0, { ...sampleStyle, border: { ...BORDER_ALL_THIN, left: BORDER_THICK } });
    setF(ws, r, SHIP_UNITS_C, `=IF(SUM(${sampleUnitRefs.join(",")})=0,"",SUM(${sampleUnitRefs.join(",")}))`, 0, sampleStyle);
    setV(ws, r, DELTA_C, null, { ...sampleStyle, border: { ...BORDER_ALL_THIN, right: BORDER_THICK } });
    r += 1;
  });
  const dataLastRow = r - 1;

  // ── Total row ──
  const totalStyle = { font: FONT_BOLD, fill: FILL_GRAY_STRONG, alignment: ALIGN_CENTER, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THIN, right: BORDER_THIN } };
  const totalLeftStyle = { ...totalStyle, alignment: ALIGN_LEFT };
  setV(ws, r, 0, "ИТОГО", totalLeftStyle);
  for (let c = 1; c <= 3; c++) setV(ws, r, c, "", totalStyle);
  merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
  // Sum columns Plan (4), Fact (5), Need (6), Stock (7)
  for (let c = 4; c <= 7; c++) {
    setF(ws, r, c, `=SUM(${ref(dataFirstRow, c)}:${ref(dataLastRow, c)})`, 0, totalStyle);
  }
  for (let i = 0; i < N; i++) {
    const cb = 8 + i * 2;
    const cu = cb + 1;
    const totalBoxesStyle = { ...totalStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THIN } };
    const totalUnitsStyle = { ...totalStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THIN, right: BORDER_THICK } };
    setF(ws, r, cb, `=SUM(${ref(dataFirstRow, cb)}:${ref(dataLastRow, cb)})`, 0, totalBoxesStyle);
    setF(ws, r, cu, `=SUM(${ref(dataFirstRow, cu)}:${ref(dataLastRow, cu)})`, 0, totalUnitsStyle);
  }
  const totalSverkaStyle = { ...totalStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THICK } };
  const totalShipLeftStyle = { ...totalStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THICK, right: BORDER_THIN } };
  const totalDeltaStyle = { ...totalStyle, border: { top: BORDER_THICK, bottom: BORDER_THICK, left: BORDER_THIN, right: BORDER_THICK } };
  setF(ws, r, SVERKA_C, `=SUM(${ref(dataFirstRow, SVERKA_C)}:${ref(dataLastRow, SVERKA_C)})`, 0, totalSverkaStyle);
  setF(ws, r, SHIP_BOXES_C, `=SUM(${ref(dataFirstRow, SHIP_BOXES_C)}:${ref(dataLastRow, SHIP_BOXES_C)})`, 0, totalShipLeftStyle);
  setF(ws, r, SHIP_UNITS_C, `=SUM(${ref(dataFirstRow, SHIP_UNITS_C)}:${ref(dataLastRow, SHIP_UNITS_C)})`, 0, totalStyle);
  setF(ws, r, DELTA_C, `=${ref(r, SHIP_UNITS_C)}-${ref(r, 6)}`, 0, totalDeltaStyle);

  // ── Column widths ──
  const cols: XLSX.ColInfo[] = [];
  cols.push({ wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 28 });
  cols.push({ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 });
  for (let i = 0; i < N; i++) cols.push({ wch: 14 }, { wch: 14 });
  cols.push({ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 });
  ws["!cols"] = cols;
  // Compact row heights: header rows fit wrapped titles, data rows tight to font
  const rows: XLSX.RowInfo[] = [{ hpt: 44 }, { hpt: 26 }];
  const lastRow = r;
  for (let rr = 2; rr <= lastRow; rr++) rows[rr] = { hpt: 24 };
  ws["!rows"] = rows;

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COL_COUNT - 1 } });
  ws["!merges"] = merges;

  XLSX.utils.book_append_sheet(wb, ws, "Сводная по артикулам");
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `shipment-summary-${date}.xlsx`);
}
