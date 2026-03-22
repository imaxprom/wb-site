import XLSX from "xlsx-js-style";
import type { ShipmentCalculation } from "@/types";
import { sortBySize, sizeHasLetters } from "./size-utils";

// --- Exact colors from the sample ---
const GREEN_FILL = { fgColor: { rgb: "92D050" } };
const GRAY_FILL = { fgColor: { rgb: "D9D9D9" } };
const ORANGE_FILL = { fgColor: { rgb: "F4B084" } };
const BLUE_FILL = { fgColor: { rgb: "D6DCE4" } };
const LIGHT_GREEN_FILL = { fgColor: { rgb: "C6EFCE" } };

// --- Borders ---
const bMedium = { style: "medium", color: { rgb: "000000" } };
const bThin = { style: "thin", color: { rgb: "000000" } };

const BORDER_ALL_MEDIUM = { top: bMedium, bottom: bMedium, left: bMedium, right: bMedium };
const BORDER_HEADER_CELL = BORDER_ALL_MEDIUM;

// --- Font ---
const F18 = { sz: 18 };
const F18_BOLD = { sz: 18, bold: true };

// --- Alignment ---
const A_LEFT = { horizontal: "left", wrapText: true };
const A_CENTER = { horizontal: "center", wrapText: true };
const A_CENTER_CENTER = { horizontal: "center", vertical: "center", wrapText: true };

// --- Column layout (0-indexed) ---
// A=0  B=1  C=2  D=3  E=4  F=5  G=6  H=7  I=8  J=9  K=10  L=11  M=12  N=13  O=14
const COL_A = 0;
const COL_B = 1;
const COL_C = 2;
const COL_D = 3;
const COL_E = 4;
const COL_N = 13;
const COL_O = 14;

// Region box columns: F=5, H=7, J=9, L=11
const REGION_BOX_COLS = [5, 7, 9, 11];
// Region piece columns: G=6, I=8, K=10, M=12
const REGION_PIECE_COLS = [6, 8, 10, 12];

function colL(c: number): string {
  return XLSX.utils.encode_col(c);
}

function setCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number | null,
  style: Record<string, unknown>,
  isFormula = false
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (isFormula && typeof value === "string") {
    ws[addr] = { t: "n", f: value, s: style };
  } else if (typeof value === "number") {
    ws[addr] = { t: "n", v: value, s: style };
  } else if (value !== null && value !== undefined) {
    ws[addr] = { t: "s", v: value, s: style };
  } else {
    ws[addr] = { t: "s", v: "", s: style };
  }
}

function setDateCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  date: Date,
  style: Record<string, unknown>
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  ws[addr] = {
    t: "s",
    v: `${dd}.${mm}.${yyyy}`,
    s: style,
  };
}

export function exportShipmentExcelV2(
  calculations: ShipmentCalculation[],
  title: string = "ИП Беликова А.Л"
) {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const regions = calculations[0]?.regionConfigs || [];
  const regionCount = Math.min(regions.length, 4);

  // We'll track rows as we build
  let row = 0;

  // ===== ROWS 1-4 (Header) =====

  // --- Row 1 (index 0): Title + "Дата забора:" + dates ---
  const headerGrayStyle = { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium, top: bMedium } };
  const dateStyle = { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { top: bThin, bottom: bThin }, numFmt: "DD.MM.YYYY" };
  const pairSepStyle = { font: F18, fill: GRAY_FILL, alignment: A_CENTER_CENTER, border: { left: bMedium, right: bMedium, top: bMedium } };

  setCell(ws, 0, COL_A, null, { border: {} });
  setCell(ws, 0, COL_B, title, { font: F18, fill: GREEN_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium, top: bMedium } });
  setCell(ws, 0, COL_C, null, headerGrayStyle);
  setCell(ws, 0, COL_D, "Дата забора:", { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium, top: bMedium, bottom: bThin } });
  setCell(ws, 0, COL_E, null, headerGrayStyle);

  const today = new Date();
  for (let ri = 0; ri < regionCount; ri++) {
    setDateCell(ws, 0, REGION_BOX_COLS[ri], today, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { top: bThin, bottom: bThin } });
    setCell(ws, 0, REGION_PIECE_COLS[ri], null, pairSepStyle);
  }
  setCell(ws, 0, COL_N, null, { border: {} });
  setCell(ws, 0, COL_O, null, { border: {} });

  // --- Row 2 (index 1): "Транспортная:" ---
  const headerRow2Style = { font: F18, alignment: A_LEFT, border: { left: bMedium, right: bMedium } };
  const dateRow2Style = { font: F18, alignment: A_LEFT, border: { top: bThin, bottom: bThin } };
  const pairSep2Style = { font: F18, fill: GRAY_FILL, alignment: A_CENTER_CENTER, border: { left: bMedium, right: bMedium } };

  setCell(ws, 1, COL_A, null, { border: {} });
  setCell(ws, 1, COL_B, null, headerRow2Style);
  setCell(ws, 1, COL_C, null, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium } });
  setCell(ws, 1, COL_D, "Транспортная:", { font: F18, alignment: A_LEFT, border: { left: bMedium, right: bMedium, top: bThin, bottom: bThin } });
  setCell(ws, 1, COL_E, null, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium } });

  for (let ri = 0; ri < regionCount; ri++) {
    setCell(ws, 1, REGION_BOX_COLS[ri], null, dateRow2Style);
    setCell(ws, 1, REGION_PIECE_COLS[ri], null, pairSep2Style);
  }

  // --- Row 3 (index 2): "Дата сдачи на ВБ:" + dates ---
  setCell(ws, 2, COL_A, null, { border: {} });
  setCell(ws, 2, COL_B, null, headerRow2Style);
  setCell(ws, 2, COL_C, null, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium } });
  setCell(ws, 2, COL_D, "Дата сдачи на ВБ:", { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium, top: bThin, bottom: bThin } });
  setCell(ws, 2, COL_E, null, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { left: bMedium, right: bMedium } });

  for (let ri = 0; ri < regionCount; ri++) {
    setDateCell(ws, 2, REGION_BOX_COLS[ri], today, { font: F18, fill: GRAY_FILL, alignment: A_LEFT, border: { top: bThin, bottom: bThin } });
    setCell(ws, 2, REGION_PIECE_COLS[ri], null, pairSep2Style);
  }

  // --- Row 4 (index 3): empty separator + "Формула" in N, O ---
  const row4Style = { font: F18, alignment: A_CENTER, border: { left: bMedium, right: bMedium, bottom: bMedium } };
  for (let c = COL_B; c <= COL_O; c++) {
    setCell(ws, 3, c, null, row4Style);
  }
  setCell(ws, 3, COL_N, "Формула", { font: F18, fill: GRAY_FILL, alignment: A_CENTER });
  setCell(ws, 3, COL_O, "Формула", { font: F18, fill: GRAY_FILL, alignment: A_CENTER });

  // --- Row 5 (index 4): Column headers ---
  const hdrStyle = { font: F18, alignment: A_CENTER_CENTER, border: BORDER_HEADER_CELL };

  setCell(ws, 4, COL_A, null, { border: {} });
  setCell(ws, 4, COL_B, "Размер", hdrStyle);
  setCell(ws, 4, COL_C, "Штук в коробке", hdrStyle);
  setCell(ws, 4, COL_D, "Баркод", hdrStyle);
  setCell(ws, 4, COL_E, "Всего на нашем складе", hdrStyle);

  for (let ri = 0; ri < regionCount; ri++) {
    const whName = regions[ri].warehouses[0] || regions[ri].shortName;
    const short = whName.includes("(") ? whName.split("(")[0].trim() : whName;
    setCell(ws, 4, REGION_BOX_COLS[ri], short, hdrStyle);
    setCell(ws, 4, REGION_PIECE_COLS[ri], "Штук", hdrStyle);
  }

  setCell(ws, 4, COL_N, "Сверка", { ...hdrStyle, fill: BLUE_FILL });
  setCell(ws, 4, COL_O, "Отгружено", { ...hdrStyle, fill: BLUE_FILL });

  row = 5; // next data row

  // Track all data rows for SUM formulas
  const dataStartRow = row;
  const dataRowIndices: number[] = [];

  // ===== PRODUCT BLOCKS =====
  let blockIndex = 0;

  for (let ci = 0; ci < calculations.length; ci++) {
    const calc = calculations[ci];
    const filteredRows = sortBySize(calc.rows).filter((r) => sizeHasLetters(r.size));
    if (filteredRows.length === 0) continue;

    const blockStartRow = row;
    const blockFill = blockIndex % 2 === 0 ? LIGHT_GREEN_FILL : undefined;
    blockIndex++;

    for (let ri = 0; ri < filteredRows.length; ri++) {
      const sRow = filteredRows[ri];
      const excelRow = row + 1; // 1-indexed for formulas
      const isFirst = ri === 0;
      const isLast = ri === filteredRows.length - 1;
      const borderTop = isFirst ? bMedium : bThin;
      const borderBottom = isLast ? bMedium : bThin;

      // A: product name (first row only, will merge later)
      if (isFirst) {
        setCell(ws, row, COL_A, `${calc.product.name}\nАртикул WB: ${calc.product.articleWB}`, {
          font: F18, fill: blockFill, alignment: A_CENTER_CENTER,
          border: { left: bMedium, right: bMedium, top: bMedium, bottom: bMedium },
        });
      }

      // B: size
      setCell(ws, row, COL_B, sRow.size, {
        font: F18, alignment: { horizontal: "center", vertical: isFirst ? "top" : undefined, wrapText: true },
        border: { left: bMedium, right: bMedium, top: borderTop, bottom: borderBottom },
      });

      // C: per box
      setCell(ws, row, COL_C, sRow.perBox, {
        font: F18, alignment: A_CENTER,
        border: { right: bMedium, top: borderTop, bottom: borderBottom },
      });

      // D: barcode
      setCell(ws, row, COL_D, sRow.barcode, {
        font: F18, alignment: A_CENTER,
        border: { left: bMedium, top: borderTop, bottom: borderBottom },
      });

      // E: empty (manual)
      setCell(ws, row, COL_E, null, {
        font: F18, alignment: A_CENTER,
        border: { left: bMedium, right: bMedium, top: borderTop, bottom: borderBottom },
      });

      // Region columns
      for (let rgi = 0; rgi < regionCount; rgi++) {
        const regionData = sRow.regions.find((r) => r.regionId === regions[rgi].id);
        const boxes = regionData?.boxes || 0;
        const boxCol = REGION_BOX_COLS[rgi];
        const pieceCol = REGION_PIECE_COLS[rgi];

        // F/H/J/L: boxes (value)
        setCell(ws, row, boxCol, boxes > 0 ? boxes : null, {
          font: F18, alignment: A_CENTER,
          border: { left: bMedium, right: bMedium, top: borderTop, bottom: borderBottom },
        });

        // G/I/K/M: pieces (formula)
        const boxLetter = colL(boxCol);
        const cLetter = colL(COL_C);
        setCell(ws, row, pieceCol, `${boxLetter}${excelRow}*${cLetter}${excelRow}`, {
          font: F18, alignment: A_CENTER_CENTER,
          border: { left: bMedium, right: bMedium, top: borderTop, bottom: borderBottom },
        }, true);
      }

      // N: Сверка formula =E-F-H-J-L
      const eLetter = colL(COL_E);
      const boxLetters = REGION_BOX_COLS.slice(0, regionCount).map((c) => colL(c));
      const sverkaFormula = `${eLetter}${excelRow}-${boxLetters.map((l) => `${l}${excelRow}`).join("-")}`;
      setCell(ws, row, COL_N, sverkaFormula, {
        font: F18, fill: BLUE_FILL, alignment: A_CENTER,
        border: { left: bMedium, right: bThin, top: borderTop, bottom: borderBottom },
      }, true);

      // O: Отгружено formula =L+J+H+F
      const shippedFormula = boxLetters.map((l) => `${l}${excelRow}`).join("+");
      setCell(ws, row, COL_O, shippedFormula, {
        font: F18, fill: BLUE_FILL, alignment: A_CENTER,
        border: { right: bMedium, top: borderTop, bottom: borderBottom },
      }, true);

      dataRowIndices.push(row);
      row++;
    }

    // Empty row inside block (after last size, within merged A) — with borders
    // Also set A cell on this row so merged area gets bottom border
    const emptyRowBorder = { top: bThin, bottom: bMedium };
    setCell(ws, row, COL_A, null, { border: { left: bMedium, right: bMedium, bottom: bMedium } });
    setCell(ws, row, COL_B, null, { border: { ...emptyRowBorder, left: bMedium, right: bMedium } });
    setCell(ws, row, COL_C, null, { border: { ...emptyRowBorder, right: bMedium } });
    setCell(ws, row, COL_D, null, { border: { ...emptyRowBorder, left: bMedium } });
    setCell(ws, row, COL_E, null, { border: { ...emptyRowBorder, left: bMedium, right: bMedium } });
    for (let rgi = 0; rgi < regionCount; rgi++) {
      setCell(ws, row, REGION_BOX_COLS[rgi], null, { border: { ...emptyRowBorder, left: bMedium, right: bMedium } });
      setCell(ws, row, REGION_PIECE_COLS[rgi], null, { border: { ...emptyRowBorder, left: bMedium, right: bMedium } });
    }
    setCell(ws, row, COL_N, null, { fill: BLUE_FILL, border: { ...emptyRowBorder, left: bMedium, right: bThin } });
    setCell(ws, row, COL_O, null, { fill: BLUE_FILL, border: { ...emptyRowBorder, right: bMedium } });
    row++;

    // Merge A for entire block (including empty row)
    const blockEndRow = row - 1;
    if (blockEndRow > blockStartRow) {
      merges.push({
        s: { r: blockStartRow, c: COL_A },
        e: { r: blockEndRow, c: COL_A },
      });
    }

    // Separator row between blocks — keep A column vertical borders
    if (ci < calculations.length - 1) {
      setCell(ws, row, COL_A, null, { border: { left: bMedium, right: bMedium } });
      for (let c = COL_B; c <= COL_O; c++) {
        setCell(ws, row, c, null, { border: {} });
      }
      row++;
    }
  }

  const dataEndRow = row - 1;

  // ===== TOTALS ROW =====
  row++; // skip one empty row
  const totalRow = row;
  const totalExcelRow = totalRow + 1;

  for (let c = 0; c <= COL_O; c++) {
    setCell(ws, totalRow, c, null, { font: F18_BOLD });
  }

  // SUM formulas for F through M
  const sumCols = [...REGION_BOX_COLS.slice(0, regionCount), ...REGION_PIECE_COLS.slice(0, regionCount)];
  for (const c of sumCols) {
    const letter = colL(c);
    setCell(ws, totalRow, c, `SUM(${letter}${dataStartRow + 1}:${letter}${dataEndRow + 1})`, {
      font: F18_BOLD, alignment: A_CENTER,
    }, true);
  }

  // ===== WORKSHEET SETTINGS =====

  // Set ref
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: COL_O } });

  // Merges
  ws["!merges"] = merges;

  // Column widths (exact from sample)
  ws["!cols"] = [
    { wch: 36.4 },  // A
    { wch: 39.7 },  // B
    { wch: 14.4 },  // C
    { wch: 33.6 },  // D
    { wch: 18.0 },  // E
    { wch: 30.0 },  // F
    { wch: 13.1 },  // G
    { wch: 30.0 },  // H
    { wch: 11.3 },  // I
    { wch: 30.0 },  // J
    { wch: 12.9 },  // K
    { wch: 30.0 },  // L
    { wch: 12.1 },  // M
    { wch: 19.4 },  // N
    { wch: 21.1 },  // O
  ];

  // Row heights
  ws["!rows"] = [];
  for (let r = 0; r <= totalRow; r++) {
    if (r === 4) {
      ws["!rows"][r] = { hpx: 70.5 }; // header row
    } else if (r < 4) {
      ws["!rows"][r] = { hpx: 24 };
    } else {
      ws["!rows"][r] = { hpx: 24 }; // all data rows
    }
  }

  // Data validations for date cells (calendar picker in Excel)
  const dateValidation = {
    type: "date",
    operator: "greaterThan",
    formula1: "1900-01-01",
    showInputMessage: true,
    showErrorMessage: true,
  };
  ws["!dataValidation"] = [];
  for (const ri of [0, 2]) { // rows 1 and 3
    for (const ci of REGION_BOX_COLS.slice(0, regionCount)) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
      ws["!dataValidation"].push({ ...dateValidation, sqref: ref });
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "ИП Беликова");

  // ===== DOWNLOAD =====
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Отгрузка_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
