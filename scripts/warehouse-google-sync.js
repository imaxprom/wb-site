#!/usr/bin/env node
/**
 * Sync ready warehouse stock from Google Sheets into local SQLite.
 *
 * The script reads the warehouse workbook through Google Sheets API and writes
 * a fresh snapshot into warehouse_ready_stock. It does not write back to Google.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "finance.db");
const KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || path.join(ROOT, "data", "google-service-account.json");
const SPREADSHEET_ID = process.env.WAREHOUSE_SPREADSHEET_ID || "1BXtl8hX_mp2sbde9lzkF_uS43WCnnSn_wNNxcse9daM";
const RANGE = "A1:N120";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

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
  if (!response.ok) throw new Error(`Google token error ${response.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sheetsGet(accessToken, urlPath, params = new URLSearchParams()) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${urlPath}?${params}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(`Sheets API ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function quoteSheetRange(title) {
  return `'${title.replace(/'/g, "''")}'!${RANGE}`;
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
      columns.push({ index: c, letter: columnName(c), sizeLabel, sizeRange, perBox });
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
      articleWB,
      sheetName: title,
      sourceColumn: column.letter,
      colorColumn: colorColumn >= 0 ? columnName(colorColumn) : "",
      sizeLabel: column.sizeLabel,
      sizeRange: column.sizeRange,
      perBox: column.perBox,
      filledCells: 0,
      unitsQty: 0,
      boxesQty: 0,
    });
  }

  for (let r = Math.max(perBoxRowIndex + 1, 0); r < rows.length; r++) {
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

  return [...bySize.values()];
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouse_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_title TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      sheets_count INTEGER NOT NULL DEFAULT 0,
      rows_count INTEGER NOT NULL DEFAULT 0,
      total_units REAL NOT NULL DEFAULT 0,
      total_boxes REAL NOT NULL DEFAULT 0,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse_ready_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_title TEXT,
      sheet_name TEXT NOT NULL,
      article_wb TEXT NOT NULL,
      size_label TEXT NOT NULL,
      size_range TEXT NOT NULL,
      source_column TEXT NOT NULL,
      color_column TEXT,
      per_box REAL,
      filled_cells INTEGER NOT NULL DEFAULT 0,
      units_qty REAL NOT NULL DEFAULT 0,
      boxes_qty REAL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_warehouse_ready_stock_article
      ON warehouse_ready_stock(article_wb);
    CREATE INDEX IF NOT EXISTS idx_warehouse_ready_stock_synced
      ON warehouse_ready_stock(synced_at);
  `);
}

async function readWarehouseSheets() {
  const accessToken = await getAccessToken();
  const meta = await sheetsGet(accessToken, "", new URLSearchParams({
    fields: "properties.title,sheets.properties(title,sheetId)",
    includeGridData: "false",
  }));
  const sheetTitles = meta.sheets.map((sheet) => sheet.properties.title);
  const params = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  for (const title of sheetTitles) params.append("ranges", quoteSheetRange(title));
  const values = await sheetsGet(accessToken, "/values:batchGet", params);
  const rows = [];
  for (let i = 0; i < values.valueRanges.length; i++) {
    rows.push(...parseSheet(sheetTitles[i], values.valueRanges[i].values || []));
  }
  return { title: meta.properties.title, sheetTitles, rows };
}

async function main() {
  const startedAt = new Date().toISOString();
  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  ensureSchema(db);

  const insertRun = db.prepare(`
    INSERT INTO warehouse_sync_runs (spreadsheet_id, status, started_at, message)
    VALUES (?, 'running', ?, '')
  `);
  const run = insertRun.run(SPREADSHEET_ID, startedAt);
  const runId = run.lastInsertRowid;

  try {
    const data = await readWarehouseSheets();
    const syncedAt = new Date().toISOString();
    const warehouseRows = data.rows.filter((row) => row.articleWB);
    const totalUnits = warehouseRows.reduce((sum, row) => sum + row.unitsQty, 0);
    const totalBoxes = warehouseRows.reduce((sum, row) => sum + (row.boxesQty || 0), 0);

    const write = db.transaction(() => {
      db.prepare("DELETE FROM warehouse_ready_stock WHERE spreadsheet_id = ?").run(SPREADSHEET_ID);
      const insert = db.prepare(`
        INSERT INTO warehouse_ready_stock (
          spreadsheet_id, spreadsheet_title, sheet_name, article_wb,
          size_label, size_range, source_column, color_column,
          per_box, filled_cells, units_qty, boxes_qty, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of warehouseRows) {
        insert.run(
          SPREADSHEET_ID,
          data.title,
          row.sheetName,
          row.articleWB,
          row.sizeLabel,
          row.sizeRange,
          row.sourceColumn,
          row.colorColumn,
          row.perBox,
          row.filledCells,
          row.unitsQty,
          row.boxesQty,
          syncedAt,
        );
      }
      db.prepare(`
        UPDATE warehouse_sync_runs
        SET spreadsheet_title = ?, status = 'done', finished_at = ?, sheets_count = ?,
            rows_count = ?, total_units = ?, total_boxes = ?, message = ?
        WHERE id = ?
      `).run(
        data.title,
        syncedAt,
        data.sheetTitles.length,
        warehouseRows.length,
        Math.round(totalUnits * 100) / 100,
        Math.round(totalBoxes * 100) / 100,
        `Imported ${warehouseRows.length} warehouse size rows`,
        runId,
      );
    });
    write();

    console.log(`Imported ${warehouseRows.length} rows from ${data.sheetTitles.length} sheets`);
    console.log(`Total units: ${Math.round(totalUnits * 100) / 100}`);
    console.log(`Total boxes: ${Math.round(totalBoxes * 100) / 100}`);
  } catch (error) {
    db.prepare(`
      UPDATE warehouse_sync_runs
      SET status = 'error', finished_at = ?, message = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error.message, runId);
    throw error;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
