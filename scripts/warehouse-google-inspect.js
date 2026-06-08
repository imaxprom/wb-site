#!/usr/bin/env node
/**
 * Read warehouse Google Sheet and print a parsed stock summary.
 *
 * This is a local inspection helper. It does not write to PostgreSQL.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || path.join(ROOT, "data", "google-service-account.json");
const SPREADSHEET_ID = process.env.WAREHOUSE_SPREADSHEET_ID || "1BXtl8hX_mp2sbde9lzkF_uS43WCnnSn_wNNxcse9daM";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

const DEFAULT_RANGE = "A1:N120";

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

async function sheetsGet(accessToken, urlPath, params = new URLSearchParams()) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${urlPath}?${params}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Sheets API ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function quoteSheetRange(title, range = DEFAULT_RANGE) {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function findArticle(rows) {
  const topText = rows.slice(0, 6).flat().map(normalizeText).join(" ");
  return topText.match(/Артикул\s*(?:WB|ВБ)\s*:?\s*(\d+)/i)?.[1] || "";
}

function findPerBoxRow(rows) {
  return rows.findIndex((row) => row.some((value) => normalizeText(value).toLowerCase().includes("штук в коробке")));
}

function detectSizeColumns(rows) {
  const perBoxRowIndex = findPerBoxRow(rows);
  if (perBoxRowIndex < 0) return { perBoxRowIndex: -1, colorColumn: -1, columns: [] };

  const perBoxRow = rows[perBoxRowIndex] || [];
  const sizeLabelRow = rows[perBoxRowIndex - 2] || [];
  const sizeRangeRow = rows[perBoxRowIndex - 1] || [];
  const colorColumn = perBoxRow.findIndex((value) => normalizeText(value).toLowerCase().includes("штук в коробке"));
  const maxColumn = Math.max(perBoxRow.length, sizeLabelRow.length, sizeRangeRow.length);
  const columns = [];

  for (let c = 0; c < maxColumn; c++) {
    if (c === colorColumn) continue;
    const sizeLabel = normalizeText(sizeLabelRow[c]);
    const sizeRange = normalizeText(sizeRangeRow[c]);
    const perBox = toNumber(perBoxRow[c]);
    const hasSizeRange = /^\d+\s*-\s*\d+$/.test(sizeRange);
    const hasSizeLabel = Boolean(sizeLabel) && !/^(формула|размер)$/i.test(sizeLabel);
    if (hasSizeRange && hasSizeLabel) {
      columns.push({
        index: c,
        letter: columnName(c),
        sizeLabel,
        sizeRange,
        perBox,
      });
    }
  }

  return { perBoxRowIndex, colorColumn, columns };
}

function parseSheet(title, rows) {
  const articleWB = findArticle(rows);
  const { perBoxRowIndex, colorColumn, columns } = detectSizeColumns(rows);
  const bySize = new Map();

  for (const column of columns) {
    bySize.set(column.index, {
      sheetName: title,
      articleWB,
      column: column.letter,
      sizeLabel: column.sizeLabel,
      sizeRange: column.sizeRange,
      perBox: column.perBox,
      filledCells: 0,
      unitsQty: 0,
      boxesQty: 0,
    });
  }

  const startRow = perBoxRowIndex + 1;
  for (let r = Math.max(startRow, 0); r < rows.length; r++) {
    const row = rows[r] || [];

    for (const column of columns) {
      const value = toNumber(row[column.index]);
      if (value === null || value <= 0) continue;
      const item = bySize.get(column.index);
      item.filledCells += 1;
      item.unitsQty += value;
    }
  }

  for (const item of bySize.values()) {
    item.unitsQty = Math.round(item.unitsQty * 100) / 100;
    item.boxesQty = item.perBox && item.perBox > 0
      ? Math.round((item.unitsQty / item.perBox) * 100) / 100
      : null;
  }

  return {
    sheetName: title,
    articleWB,
    colorColumn: colorColumn >= 0 ? columnName(colorColumn) : "",
    perBoxRow: perBoxRowIndex >= 0 ? perBoxRowIndex + 1 : null,
    sizes: [...bySize.values()],
  };
}

function formatNumber(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

async function main() {
  const accessToken = await getAccessToken();
  const metaParams = new URLSearchParams({
    fields: "properties.title,sheets.properties(title,sheetId)",
    includeGridData: "false",
  });
  const meta = await sheetsGet(accessToken, "", metaParams);
  const sheetTitles = meta.sheets.map((sheet) => sheet.properties.title);

  const valuesParams = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  for (const title of sheetTitles) valuesParams.append("ranges", quoteSheetRange(title));
  const values = await sheetsGet(accessToken, "/values:batchGet", valuesParams);
  const parsedSheets = values.valueRanges.map((range, index) => parseSheet(sheetTitles[index], range.values || []));

  console.log(`Таблица: ${meta.properties.title}`);
  console.log(`Листов: ${parsedSheets.length}`);
  console.log("");

  let totalUnits = 0;
  let totalBoxes = 0;
  const warnings = [];

  for (const sheet of parsedSheets) {
    if (!sheet.articleWB) warnings.push(`${sheet.sheetName}: не найден Артикул WB/ВБ`);
    const nonZero = sheet.sizes.filter((item) => item.unitsQty > 0);
    const sheetUnits = nonZero.reduce((sum, item) => sum + item.unitsQty, 0);
    const sheetBoxes = nonZero.reduce((sum, item) => sum + (item.boxesQty || 0), 0);
    totalUnits += sheetUnits;
    totalBoxes += sheetBoxes;

    console.log(`${sheet.articleWB || "NO_ARTICLE"} | ${sheet.sheetName}`);
    console.log(`  sizeColumns=${sheet.sizes.map((item) => item.column).join(", ")} colorColumn=${sheet.colorColumn || "-"} perBoxRow=${sheet.perBoxRow || "-"}`);
    if (nonZero.length === 0) {
      console.log("  готовых коробов нет");
    } else {
      for (const item of nonZero) {
        console.log(
          `  ${item.sizeLabel}_${item.sizeRange}: cells=${item.filledCells}, units=${formatNumber(item.unitsQty)}, perBox=${formatNumber(item.perBox)}, boxes=${formatNumber(item.boxesQty)}`,
        );
      }
    }
    console.log(`  итого: units=${formatNumber(sheetUnits)}, boxes=${formatNumber(sheetBoxes)}`);
    console.log("");
  }

  console.log(`ИТОГО ПО ТАБЛИЦЕ: units=${formatNumber(totalUnits)}, boxes=${formatNumber(totalBoxes)}`);
  if (warnings.length > 0) {
    console.log("");
    console.log("WARNINGS:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
