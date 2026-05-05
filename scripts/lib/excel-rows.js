const ExcelJS = require("exceljs");

function formatDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value !== "object") return value;

  if ("result" in value) return normalizeCellValue(value.result);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  if ("hyperlink" in value && "text" in value && typeof value.text === "string") {
    return value.text;
  }

  return String(value);
}

async function readFirstSheetRows(input) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = String(normalizeCellValue(cell.value)).trim();
    headers[colNumber] = header;
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const item = {};
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

module.exports = { readFirstSheetRows };
