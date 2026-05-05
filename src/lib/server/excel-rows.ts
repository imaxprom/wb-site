import ExcelJS from "exceljs";

export type ExcelRow = Record<string, unknown>;

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (!isRecord(value)) return value;

  if ("result" in value) return normalizeCellValue(value.result);
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.richText)) {
    return value.richText
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
  }

  return String(value);
}

export async function readFirstSheetRows(input: Buffer | ArrayBuffer): Promise<ExcelRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as never);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(normalizeCellValue(cell.value)).trim();
  });

  const rows: ExcelRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const item: ExcelRow = {};
    let hasValue = false;
    for (let colNumber = 1; colNumber < headers.length; colNumber++) {
      const header = headers[colNumber];
      if (!header) continue;

      const value = normalizeCellValue(row.getCell(colNumber).value);
      if (value !== "") hasValue = true;
      item[header] = value;
    }

    if (hasValue) rows.push(item);
  });

  return rows;
}
