import XLSX from "xlsx-js-style";
import type { ShipmentCalculation } from "@/types";
import { sortShipmentRows } from "@/modules/shipment/lib/engine";
import { sizeHasLetters } from "./size-utils";

// --- Border helpers ---
const thin = { style: "thin", color: { rgb: "999999" } };
const medium = { style: "medium", color: { rgb: "333333" } };

const BORDER_ALL = { top: thin, bottom: thin, left: thin, right: thin };
const BORDER_BLOCK_TOP = { top: medium, bottom: thin, left: thin, right: thin };
const BORDER_BLOCK_BOTTOM = { top: thin, bottom: medium, left: thin, right: thin };
const BORDER_BLOCK_SINGLE = { top: medium, bottom: medium, left: thin, right: thin };
const BORDER_RIGHT_THICK = (base: object) => ({ ...base, right: medium });

// --- Colors ---
const HEADER_FILL = { fgColor: { rgb: "E8F5E9" } };
const PRODUCT_NAME_FILL = { fgColor: { rgb: "E8F5E9" } };
const EVEN_BLOCK_FILL = { fgColor: { rgb: "E8F5E9" } };
const TOTAL_FILL = { fgColor: { rgb: "E8F5E9" } };

// --- Styles ---
const HEADER_STYLE = {
  alignment: { wrapText: true, vertical: "center", horizontal: "center" },
  font: { bold: true, color: { rgb: "333333" }, sz: 16 },
  fill: HEADER_FILL,
  border: { top: medium, bottom: medium, left: thin, right: thin },
};

const TITLE_STYLE = {
  alignment: { wrapText: true, vertical: "top" },
  font: { bold: true, sz: 16 },
};

const LABEL_STYLE = {
  alignment: { wrapText: true, vertical: "top" },
  font: { bold: true, sz: 16, color: { rgb: "555555" } },
};

export function exportShipmentExcel(
  calculations: ShipmentCalculation[],
  title: string = "ИП Беликова А.Л"
) {
  const wb = XLSX.utils.book_new();
  const regions = calculations[0]?.regionConfigs || [];
  const totalColCount = 5 + regions.length * 2 + 2; // A-E + region pairs + sverka + shipped

  const data: (string | number | null)[][] = [];
  const merges: XLSX.Range[] = [];

  // Track which rows belong to which product block (for styling later)
  const blockRanges: { start: number; end: number }[] = [];

  // --- Header rows ---
  // Row 1
  const row1: (string | number | null)[] = new Array(totalColCount).fill(null);
  row1[1] = title;
  row1[3] = "Дата забора:";
  data.push(row1);

  // Row 2
  const row2: (string | number | null)[] = new Array(totalColCount).fill(null);
  row2[3] = "Транспортная:";
  data.push(row2);

  // Row 3
  const row3: (string | number | null)[] = new Array(totalColCount).fill(null);
  row3[3] = "Дата сдачи на ВБ:";
  data.push(row3);

  // Row 4: empty
  data.push(new Array(totalColCount).fill(null));

  // Row 5: column headers
  const headers: (string | number | null)[] = [
    null,
    "Размер",
    "Штук в коробке",
    "Баркод",
    "Всего на нашем складе",
  ];
  for (const region of regions) {
    const whName = region.warehouses[0] || region.shortName;
    const short = whName.includes("(") ? whName.split("(")[0].trim() : whName;
    headers.push(short, "Штук");
  }
  headers.push("Сверка", "Отгружено");
  data.push(headers);

  const headerRowIdx = 4;

  // --- Column indices ---
  // A=0, B=1, C=2(perBox), D=3, E=4(manual total)
  // Then for each region: boxesCol, piecesCol
  // Then: sverkaCol, shippedCol
  const perBoxCol = 2;  // C
  const regionStartCol = 5; // F
  const boxesCols: number[] = [];
  const piecesCols: number[] = [];
  for (let rgi = 0; rgi < regions.length; rgi++) {
    boxesCols.push(regionStartCol + rgi * 2);
    piecesCols.push(regionStartCol + rgi * 2 + 1);
  }
  const sverkaCol = regionStartCol + regions.length * 2;
  const shippedCol = sverkaCol + 1;

  // Track data rows for formula injection
  const dataRowIndices: number[] = [];

  // --- Product blocks ---
  for (let ci = 0; ci < calculations.length; ci++) {
    const calc = calculations[ci];
    // Filter: only sizes containing letters (skip purely numeric like 101-103)
    const filteredRows = sortShipmentRows(calc.rows).filter((r) => sizeHasLetters(r.size));
    if (filteredRows.length === 0) continue;

    const blockStartRow = data.length;

    for (let ri = 0; ri < filteredRows.length; ri++) {
      const row = filteredRows[ri];
      const line: (string | number | null)[] = [];

      // A: product name (first row only)
      if (ri === 0) {
        line.push(`${calc.product.name}\nАртикул WB: ${calc.product.articleWB}`);
      } else {
        line.push(null);
      }

      line.push(row.size);
      line.push(row.perBox);
      line.push(row.barcode);
      line.push(null); // E: manual

      for (let rgi = 0; rgi < regions.length; rgi++) {
        const regionData = row.regions.find((r) => r.regionId === regions[rgi].id);
        const boxes = regionData?.boxes || 0;
        line.push(boxes > 0 ? boxes : 0);
        line.push(0); // pieces — placeholder, will be formula
      }

      line.push(0); // sverka — placeholder, will be formula
      line.push(0); // shipped — placeholder, will be formula

      dataRowIndices.push(data.length);
      data.push(line);
    }

    // Empty row inside block (after last size, before separator)
    data.push(new Array(totalColCount).fill(null));

    const blockEndRow = data.length - 1; // includes the empty row
    blockRanges.push({ start: blockStartRow, end: blockEndRow });

    // Merge A column (includes the empty row)
    if (blockEndRow > blockStartRow) {
      merges.push({
        s: { r: blockStartRow, c: 0 },
        e: { r: blockEndRow, c: 0 },
      });
    }

    // Separator row between blocks
    if (ci < calculations.length - 1) {
      data.push(new Array(totalColCount).fill(null));
    }
  }

  // --- Totals row ---
  data.push(new Array(totalColCount).fill(null)); // separator
  const totalRowIdx = data.length;
  const totalRow: (string | number | null)[] = new Array(totalColCount).fill(null);
  data.push(totalRow);

  // --- Create worksheet ---
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!merges"] = merges;

  // --- Inject formulas ---
  const colLetter = (c: number) => XLSX.utils.encode_col(c);
  const perBoxLetter = colLetter(perBoxCol); // C

  for (const r of dataRowIndices) {
    const excelRow = r + 1; // 1-indexed

    // Штуки = Коробки × Шт/кор (for each region)
    for (let rgi = 0; rgi < regions.length; rgi++) {
      const boxLetter = colLetter(boxesCols[rgi]);
      const pieceLetter = colLetter(piecesCols[rgi]);
      const addr = `${pieceLetter}${excelRow}`;
      ws[addr] = { t: "n", f: `${boxLetter}${excelRow}*${perBoxLetter}${excelRow}` };
    }

    // Отгружено = сумма коробок по всем регионам
    const shippedLetter = colLetter(shippedCol);
    const boxSumParts = boxesCols.map((c) => `${colLetter(c)}${excelRow}`).join("+");
    ws[`${shippedLetter}${excelRow}`] = { t: "n", f: boxSumParts };

    // Сверка = Всего на складе − Отгружено
    const sverkaLetter = colLetter(sverkaCol);
    const eLetter = colLetter(4); // E
    ws[`${sverkaLetter}${excelRow}`] = {
      t: "n",
      f: `${eLetter}${excelRow}-${shippedLetter}${excelRow}`,
    };
  }

  // --- Totals row formulas (SUM of each column across all data rows) ---
  const allCols = [...boxesCols, ...piecesCols, sverkaCol, shippedCol];
  for (const c of allCols) {
    const letter = colLetter(c);
    const parts = dataRowIndices.map((r) => `${letter}${r + 1}`);
    // Use individual cell refs since data rows may not be contiguous
    const addr = `${letter}${totalRowIdx + 1}`;
    ws[addr] = { t: "n", f: `${parts.join("+")}` };
  }

  // --- Figure out which columns are region-boundary columns ---
  // Columns where a region pair ends (the "Штук" column): for thicker right border
  const regionEndCols = new Set<number>();
  for (let rgi = 0; rgi < regions.length; rgi++) {
    regionEndCols.add(5 + rgi * 2 + 1); // the "Штук" col of each region
  }
  // Also column E (4) and column A (0) get right border
  regionEndCols.add(0);
  regionEndCols.add(4);
  regionEndCols.add(shippedCol);

  // --- Apply styles ---
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });

      // Create cell if it doesn't exist (for borders on empty cells)
      if (!ws[addr]) {
        ws[addr] = { t: "s", v: "" };
      }

      const cell = ws[addr];

      // --- Top header rows (0-3) ---
      if (r < headerRowIdx) {
        if (cell.v) {
          cell.s = r === 0 && c === 1 ? TITLE_STYLE : LABEL_STYLE;
        } else {
          cell.s = { border: {} };
        }
        continue;
      }

      // --- Header row ---
      if (r === headerRowIdx) {
        cell.s = { ...HEADER_STYLE };
        if (regionEndCols.has(c)) {
          cell.s.border = { ...cell.s.border, right: medium };
        }
        continue;
      }

      // --- Totals row ---
      if (r === totalRowIdx) {
        cell.s = {
          alignment: { wrapText: true, vertical: "center", horizontal: "center" },
          font: { bold: true, sz: 16 },
          fill: TOTAL_FILL,
          border: { top: medium, bottom: medium, left: thin, right: thin },
        };
        if (regionEndCols.has(c)) {
          cell.s.border = { ...cell.s.border, right: medium };
        }
        continue;
      }

      // --- Find which block this row belongs to ---
      const block = blockRanges.find((b) => r >= b.start && r <= b.end);
      if (!block) {
        // Separator row — minimal style
        cell.s = { border: {} };
        continue;
      }

      // --- Data rows ---
      const isFirstRow = r === block.start;
      const isLastRow = r === block.end;
      const blockIdx = blockRanges.indexOf(block);
      const isEvenBlock = blockIdx % 2 === 1;

      // Choose vertical border
      let border;
      if (isFirstRow && isLastRow) {
        border = { ...BORDER_BLOCK_SINGLE };
      } else if (isFirstRow) {
        border = { ...BORDER_BLOCK_TOP };
      } else if (isLastRow) {
        border = { ...BORDER_BLOCK_BOTTOM };
      } else {
        border = { ...BORDER_ALL };
      }

      // Thicker right border on region boundaries
      if (regionEndCols.has(c)) {
        border = { ...border, right: medium };
      }

      if (c === 0) {
        // Product name column
        cell.s = {
          alignment: { wrapText: true, vertical: "center", horizontal: "center" },
          font: { bold: true, sz: 18 },
          fill: PRODUCT_NAME_FILL,
          border,
        };
      } else if (c === 1) {
        // Size column — centered
        cell.s = {
          alignment: { wrapText: true, vertical: "center", horizontal: "center" },
          font: { sz: 16 },
          fill: isEvenBlock ? EVEN_BLOCK_FILL : undefined,
          border,
        };
      } else {
        // Regular data cell
        cell.s = {
          alignment: { wrapText: true, vertical: "center", horizontal: "center" },
          font: { sz: 16 },
          fill: isEvenBlock ? EVEN_BLOCK_FILL : undefined,
          border,
        };
      }
    }
  }

  // --- Column widths ---
  // Auto-width for column A: find longest line in any cell value
  let maxA = 20;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    const val = ws[addr]?.v;
    if (val) {
      const lines = String(val).split("\n");
      for (const line of lines) {
        if (line.length > maxA) maxA = line.length;
      }
    }
  }
  const colWidths: { wch: number }[] = [
    { wch: Math.min(maxA + 2, 80) }, // A — auto, capped at 80
    { wch: 14 }, // B
    { wch: 6 },  // C
    { wch: 16 }, // D
    { wch: 10 }, // E
  ];
  for (let i = 0; i < regions.length; i++) {
    colWidths.push({ wch: 14 }, { wch: 8 });
  }
  colWidths.push({ wch: 8 }, { wch: 10 });
  ws["!cols"] = colWidths;

  // --- Row heights for product blocks ---
  const rowHeights: Record<number, { hpx: number }> = {};
  rowHeights[headerRowIdx] = { hpx: 50 };
  for (const block of blockRanges) {
    // First row of block gets extra height for product name
    rowHeights[block.start] = { hpx: 45 };
  }
  ws["!rows"] = [];
  for (let r = 0; r <= range.e.r; r++) {
    ws["!rows"][r] = rowHeights[r] || { hpx: 20 };
  }

  XLSX.utils.book_append_sheet(wb, ws, "Отгрузка");

  // --- Download ---
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Отгрузка_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
