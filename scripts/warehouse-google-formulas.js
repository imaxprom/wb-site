#!/usr/bin/env node
/**
 * Update "Короб склад" formulas in the warehouse Google Sheet.
 *
 * The script backs up the current formulas locally and only edits the right
 * formula block. It does not touch shipment, demand or in-work formulas.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || path.join(ROOT, "data", "google-service-account.json");
const SPREADSHEET_ID = process.env.WAREHOUSE_SPREADSHEET_ID || "1BXtl8hX_mp2sbde9lzkF_uS43WCnnSn_wNNxcse9daM";
const BACKUP_DIR = process.env.WAREHOUSE_FORMULA_BACKUP_DIR || path.join(ROOT, "data", "reports", "warehouse-formula-backups");
const RANGE = "A1:N120";
const DATA_END_ROW = 102;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const applyChanges = process.argv.includes("--apply");
const debugSheetArg = process.argv.find((arg) => arg.startsWith("--debug-sheet="));
const debugSheet = debugSheetArg ? debugSheetArg.slice("--debug-sheet=".length) : "";

function base64Url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function getAccessToken() {
  const key = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url({ alg: "RS256", typ: "JWT" })}.${base64Url({
    iss: key.client_email,
    scope: SHEETS_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google token error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function sheetsRequest(accessToken, urlPath, params = new URLSearchParams(), options = {}) {
  const query = params.toString();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${urlPath}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sheets API ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function quoteSheetRange(title, range = RANGE) {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase().replace(/ё/g, "е");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).replace(/\s+/g, "").replace(",", ".");
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function columnIndex(name) {
  return name.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function findPerBoxRow(rows) {
  return rows.findIndex((row) => row.some((value) => normalizeComparable(value).includes("штук в коробке")));
}

function findSizeLabel(rows, perBoxRowIndex, columnIndex) {
  const directRows = [perBoxRowIndex - 2, perBoxRowIndex - 3, perBoxRowIndex - 1];
  for (const rowIndex of directRows) {
    const value = normalizeText(rows[rowIndex]?.[columnIndex]);
    if (value && !/^(формула|размер|\d+\s*-\s*\d+)$/i.test(value)) return value;
  }
  return "";
}

function findSizeRange(rows, perBoxRowIndex, columnIndex) {
  for (let rowIndex = perBoxRowIndex - 3; rowIndex <= perBoxRowIndex - 1; rowIndex++) {
    const value = normalizeText(rows[rowIndex]?.[columnIndex]);
    if (/^\d+\s*-\s*\d+$/.test(value)) return value.replace(/\s+/g, "");
  }
  return "";
}

function detectSizeColumns(rows) {
  const perBoxRowIndex = findPerBoxRow(rows);
  if (perBoxRowIndex < 0) return { perBoxRowIndex: -1, colorColumn: -1, columns: [] };

  const perBoxRow = rows[perBoxRowIndex] || [];
  const colorColumn = perBoxRow.findIndex((value) => normalizeComparable(value).includes("штук в коробке"));
  const maxColumn = Math.max(
    perBoxRow.length,
    rows[perBoxRowIndex - 3]?.length || 0,
    rows[perBoxRowIndex - 2]?.length || 0,
    rows[perBoxRowIndex - 1]?.length || 0,
  );
  const columns = [];

  for (let c = 0; c < maxColumn; c++) {
    if (c === colorColumn) continue;
    const perBox = toNumber(perBoxRow[c]);
    const sizeRange = findSizeRange(rows, perBoxRowIndex, c);
    const sizeLabel = findSizeLabel(rows, perBoxRowIndex, c);
    if (sizeRange && sizeLabel) {
      columns.push({
        index: c,
        letter: columnName(c),
        sizeLabel: sizeLabel || sizeRange,
        sizeRange,
        perBox,
      });
    }
  }

  return { perBoxRowIndex, colorColumn, columns };
}

function findBoxHeader(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normalizeComparable(row[c]) === "короб склад") return { row: r, column: c };
    }
  }
  return null;
}

function rowMatchesColumn(rowLabel, column) {
  const label = normalizeComparable(rowLabel);
  const sizeLabel = normalizeComparable(column.sizeLabel);
  const sizeRange = normalizeComparable(column.sizeRange);
  return Boolean(label) && label.includes(sizeRange) && (label.includes(sizeLabel) || column.sizeLabel === column.sizeRange);
}

function findTargetRows(rows, header, columns) {
  const sizeColumnIndex = header.column - 1;
  const remaining = new Set(columns.map((_, index) => index));
  const targetRows = new Map();

  for (let r = header.row + 1; r < Math.min(rows.length, header.row + 25); r++) {
    const rowLabel = rows[r]?.[sizeColumnIndex];
    for (const index of [...remaining]) {
      if (rowMatchesColumn(rowLabel, columns[index])) {
        targetRows.set(index, r);
        remaining.delete(index);
        break;
      }
    }
  }

  // Fallback for sheets where right labels are sparse but order matches source size columns.
  if (remaining.size > 0) {
    let offset = 0;
    for (const index of remaining) {
      while ([...targetRows.values()].includes(header.row + 1 + offset)) offset += 1;
      targetRows.set(index, header.row + 1 + offset);
      offset += 1;
    }
  }

  return targetRows;
}

function buildFormula(column, perBoxRowIndex) {
  const source = column.letter;
  const dataStartRow = perBoxRowIndex + 2;
  const perBoxRow = perBoxRowIndex + 1;
  return `=IFERROR(ROUND(SUM($${source}$${dataStartRow}:$${source}$${DATA_END_ROW})/$${source}$${perBoxRow};2);0)`;
}

function buildBerfinUpdates(sheetTitle, formulaRows, valueRows, header, detected) {
  const sourceLetters = ["A", "B", "C", "D", "F", "G", "H"];
  return sourceLetters.map((letter, offset) => {
    const rowIndex = header.row + 1 + offset;
    const sourceIndex = columnIndex(letter);
    const rowLabel = normalizeText(valueRows[rowIndex]?.[header.column - 1]);
    const cell = `${columnName(header.column)}${rowIndex + 1}`;
    return {
      range: quoteSheetRange(sheetTitle, cell),
      cell,
      sourceColumn: letter,
      sizeLabel: rowLabel,
      sizeRange: "",
      perBox: toNumber(valueRows[detected.perBoxRowIndex]?.[sourceIndex]),
      oldFormula: formulaRows[rowIndex]?.[header.column] || "",
      newFormula: buildFormula({ letter }, detected.perBoxRowIndex),
    };
  });
}

function buildUpdates(sheetTitle, formulaRows, valueRows) {
  const detected = detectSizeColumns(valueRows);
  const header = findBoxHeader(valueRows);
  if (!header) {
    return { sheetTitle, updates: [], warning: "не найден заголовок Короб склад", detected };
  }
  if (detected.columns.length === 0) {
    return { sheetTitle, updates: [], warning: "не найдены колонки размеров", detected };
  }

  if (sheetTitle.includes("BERFIN")) {
    const updates = buildBerfinUpdates(sheetTitle, formulaRows, valueRows, header, detected);
    return {
      sheetTitle,
      updates,
      warning: "BERFIN: сохранён сдвиг правого блока",
      detected,
    };
  }

  const missingPerBox = detected.columns.filter((column) => !column.perBox || column.perBox <= 0);

  const targetRows = findTargetRows(valueRows, header, detected.columns);
  const updates = detected.columns.map((column, index) => {
    const rowIndex = targetRows.get(index);
    const cell = `${columnName(header.column)}${rowIndex + 1}`;
    return {
      range: quoteSheetRange(sheetTitle, cell),
      cell,
      sourceColumn: column.letter,
      sizeLabel: column.sizeLabel,
      sizeRange: column.sizeRange,
      perBox: column.perBox,
      oldFormula: formulaRows[rowIndex]?.[header.column] || "",
      newFormula: buildFormula(column, detected.perBoxRowIndex),
    };
  });

  return {
    sheetTitle,
    updates,
    warning: missingPerBox.length > 0
      ? `нет норм штук в коробке: ${missingPerBox.map((column) => column.letter).join(", ")}`
      : "",
    detected,
  };
}

function backupPayload(meta, plans) {
  return {
    createdAt: new Date().toISOString(),
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetTitle: meta.properties.title,
    mode: applyChanges ? "apply" : "dry-run",
    sheets: plans.map((plan) => ({
      sheetTitle: plan.sheetTitle,
      warning: plan.warning,
      sizeColumns: plan.detected.columns,
      updates: plan.updates.map((update) => ({
        cell: update.cell,
        sourceColumn: update.sourceColumn,
        sizeLabel: update.sizeLabel,
        sizeRange: update.sizeRange,
        perBox: update.perBox,
        oldFormula: update.oldFormula,
        newFormula: update.newFormula,
      })),
    })),
  };
}

async function main() {
  const accessToken = await getAccessToken();
  const meta = await sheetsRequest(accessToken, "", new URLSearchParams({
    fields: "properties.title,sheets.properties(title,sheetId)",
    includeGridData: "false",
  }));
  const sheetTitles = meta.sheets.map((sheet) => sheet.properties.title);

  const formulaParams = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "FORMULA",
  });
  for (const title of sheetTitles) formulaParams.append("ranges", quoteSheetRange(title));
  const formulas = await sheetsRequest(accessToken, "/values:batchGet", formulaParams);

  const valueParams = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  for (const title of sheetTitles) valueParams.append("ranges", quoteSheetRange(title));
  const values = await sheetsRequest(accessToken, "/values:batchGet", valueParams);

  const plans = values.valueRanges.map((range, index) => buildUpdates(
    sheetTitles[index],
    formulas.valueRanges[index]?.values || [],
    range.values || [],
  ));
  const allUpdates = plans.flatMap((plan) => plan.updates);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${stamp}-${applyChanges ? "apply" : "dry-run"}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(backupPayload(meta, plans), null, 2)}\n`);

  console.log(`Таблица: ${meta.properties.title}`);
  console.log(`Листов: ${plans.length}`);
  console.log(`Формул к обновлению: ${allUpdates.length}`);
  console.log(`Бэкап: ${backupPath}`);

  for (const plan of plans) {
    const suffix = plan.warning ? ` (${plan.warning})` : "";
    console.log(`${plan.sheetTitle}: ${plan.updates.length} формул${suffix}`);
    if (debugSheet && plan.sheetTitle.includes(debugSheet)) {
      const index = sheetTitles.indexOf(plan.sheetTitle);
      const rows = values.valueRanges[index]?.values || [];
      const formulaRows = formulas.valueRanges[index]?.values || [];
      console.log("DEBUG value rows 1-12:");
      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        console.log(`${r + 1}: ${JSON.stringify(rows[r])}`);
      }
      console.log("DEBUG formula rows 1-12:");
      for (let r = 0; r < Math.min(formulaRows.length, 12); r++) {
        console.log(`${r + 1}: ${JSON.stringify(formulaRows[r])}`);
      }
    }
  }

  if (!applyChanges) {
    console.log("Режим dry-run: изменения в Google Sheets не внесены.");
    return;
  }

  if (allUpdates.length === 0) {
    throw new Error("Нет формул для обновления");
  }

  const body = {
    valueInputOption: "USER_ENTERED",
    data: allUpdates.map((update) => ({
      range: update.range,
      values: [[update.newFormula]],
    })),
  };
  const result = await sheetsRequest(accessToken, "/values:batchUpdate", new URLSearchParams(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  console.log(`Обновлено диапазонов: ${result.totalUpdatedRanges}`);
  console.log(`Обновлено ячеек: ${result.totalUpdatedCells}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
