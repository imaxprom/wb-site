import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

const SPREADSHEET_ID = process.env.PURCHASES_STOCK_SPREADSHEET_ID || "1wJeiTYl6rRX3Ij7qcNfRFAV2DYIYj7PS-BR5L9QLyA4";
const WAREHOUSE_SPREADSHEET_ID = process.env.WAREHOUSE_SPREADSHEET_ID || "1BXtl8hX_mp2sbde9lzkF_uS43WCnnSn_wNNxcse9daM";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const RANGE = "A1:Y120";
const WAREHOUSE_RANGE = "A1:N120";

const SHEETS = [
  { key: "rib", title: "New СЛИПЫ в рубчик", label: "Трусы в рубчик" },
  { key: "smooth", title: "NEW СЛИПЫ гладкие", label: "Трусы гладкие" },
  { key: "stringRib", title: "СТРИНГИ в рубчик", label: "Трусы-стринги в рубчик" },
] as const;

function base64Url(value: string | object) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function getAccessToken() {
  const key = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "google-service-account.json"), "utf8")) as { client_email: string; private_key: string };
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
  return data.access_token as string;
}

function quoteSheetRange(title: string, range = RANGE) {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalColor(value: string) {
  const normalized = text(value).toLocaleLowerCase("ru-RU").replace(/[.,]/g, "");
  if (!normalized) return "";
  if (normalized.includes("черн")) return "Черный";
  if (normalized.includes("бел")) return "Белый";
  if (normalized.includes("перс")) return "Персик";
  if (normalized.includes("сер")) return "Серый";
  if (normalized.includes("бирюз")) return "Бирюза";
  if (normalized.includes("борд")) return "Бордо";
  if (normalized.includes("фиолет")) return "Фиолетовый";
  if (normalized.includes("зелен") || normalized.includes("зелён")) return "Зеленый";
  if (normalized.includes("роз")) return "Розовый";
  if (normalized.includes("син")) return "Синий";
  if (normalized.includes("беж")) return "Бежевый";
  return text(value).replace(/^./, (char) => char.toLocaleUpperCase("ru-RU"));
}

function calculateGroup({
  row,
  colorIndex,
  bagIndex,
  packIndex,
  commonBoxIndex,
  sizeBoxIndexes,
  sizeLabels,
  bagPacks,
}: {
  row: unknown[];
  colorIndex: number;
  bagIndex: number;
  packIndex: number;
  commonBoxIndex: number;
  sizeBoxIndexes: number[];
  sizeLabels: string[];
  bagPacks: number;
}) {
  const color = text(row[colorIndex]);
  if (!color) return null;

  const bags = toNumber(row[bagIndex]);
  const loosePacks = toNumber(row[packIndex]);
  const commonBoxes = toNumber(row[commonBoxIndex]);
  const sizeBoxes = sizeBoxIndexes.map((index) => toNumber(row[index]));
  const sharedPacks = bags * bagPacks + loosePacks + commonBoxes * 50;
  const sizeBoxPacks = sizeBoxes.reduce((sum, boxes) => sum + boxes * 50, 0);
  const totalPacks = sharedPacks + sizeBoxPacks;

  return {
    color,
    bags,
    bagPacks,
    loosePacks,
    commonBoxes,
    sharedPacks,
    sizeBoxPacks,
    totalPacks,
    sizeRows: sizeLabels.map((size, index) => {
      const boxes = sizeBoxes[index] || 0;
      const dedicatedPacks = boxes * 50;
      return {
        size,
        boxes,
        packs: sharedPacks + dedicatedPacks,
        pieces: sharedPacks * 4 + dedicatedPacks * 12,
      };
    }),
  };
}

type StockGroup = NonNullable<ReturnType<typeof calculateGroup>>;

const SIZE_ORDER = ["40-42", "42-44", "44-46", "46-48", "48-50", "50-52", "52-54"];

function sortSizeRows(rows: StockGroup["sizeRows"]) {
  return [...rows].sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
}

function mergeGroupRows(rows: StockGroup[]) {
  const byColor = new Map<string, StockGroup>();

  for (const row of rows) {
    const key = row.color.toLocaleUpperCase("ru-RU");
    const existing = byColor.get(key);
    if (!existing) {
      byColor.set(key, {
        ...row,
        sizeRows: sortSizeRows(row.sizeRows),
      });
      continue;
    }

    existing.bags += row.bags;
    existing.loosePacks += row.loosePacks;
    existing.commonBoxes += row.commonBoxes;
    existing.sharedPacks += row.sharedPacks;
    existing.sizeBoxPacks += row.sizeBoxPacks;
    existing.totalPacks += row.totalPacks;

    const sizes = new Map(existing.sizeRows.map((sizeRow) => [sizeRow.size, { ...sizeRow }]));
    for (const sizeRow of row.sizeRows) {
      const current = sizes.get(sizeRow.size);
      if (!current) {
        sizes.set(sizeRow.size, { ...sizeRow });
        continue;
      }
      current.boxes += sizeRow.boxes;
      current.packs += sizeRow.packs;
      current.pieces += sizeRow.pieces;
    }
    existing.sizeRows = sortSizeRows([...sizes.values()]);
  }

  return [...byColor.values()];
}

function parseRows({
  rows,
  start,
  end,
  colorIndex,
  bagIndex,
  packIndex,
  commonBoxIndex,
  sizeBoxIndexes,
  sizeLabels,
  bagPacks,
  includeZeroRows = true,
}: {
  rows: unknown[][];
  start: number;
  end: number;
  colorIndex: number;
  bagIndex: number;
  packIndex: number;
  commonBoxIndex: number;
  sizeBoxIndexes: number[];
  sizeLabels: string[];
  bagPacks: number;
  includeZeroRows?: boolean;
}) {
  return rows
    .slice(start, end + 1)
    .map((row) => calculateGroup({
      row,
      colorIndex,
      bagIndex,
      packIndex,
      commonBoxIndex,
      sizeBoxIndexes,
      sizeLabels,
      bagPacks,
    }))
    .filter((row): row is StockGroup => Boolean(row))
    .filter((row) => includeZeroRows || row.totalPacks > 0);
}

function isColorHeader(value: unknown) {
  return text(value).toLocaleUpperCase("ru-RU") === "ЦВЕТ";
}

function collectSizeColumns(row: unknown[] | undefined, indexes: number[], fallback: string[]) {
  return indexes
    .map((index, position) => ({
      index,
      label: text(row?.[index]) || fallback[position],
    }))
    .filter((item) => item.label);
}

function hasColorData(row: unknown[] | undefined) {
  return Boolean(text(row?.[0]) || text(row?.[12]));
}

function parseSheet(sheet: { key: string; title: string; label: string }, rows: unknown[][]) {
  const smallSizes = ["42-44", "44-46", "46-48"];
  const bigSizes = ["48-50", "50-52", "52-54"];
  const smallRows: StockGroup[] = [];
  const bigRows: StockGroup[] = [];
  let blockIndex = 0;

  for (let rowIndex = 0; rowIndex < rows.length - 2; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!isColorHeader(row?.[0]) && !isColorHeader(row?.[12])) continue;

    const sizeRow = rows[rowIndex + 1];
    const start = rowIndex + 2;
    let end = start - 1;
    while (end + 1 < rows.length && hasColorData(rows[end + 1])) {
      end += 1;
    }
    if (end < start) continue;

    const includeZeroRows = blockIndex === 0;
    const smallColumns = collectSizeColumns(sizeRow, [4, 5, 6], smallSizes);
    const bigColumns = collectSizeColumns(sizeRow, [16, 17, 18], bigSizes);

    if (smallColumns.length) {
      smallRows.push(...parseRows({
        rows,
        start,
        end,
        colorIndex: 0,
        bagIndex: 1,
        packIndex: 2,
        commonBoxIndex: 3,
        sizeBoxIndexes: smallColumns.map((column) => column.index),
        sizeLabels: smallColumns.map((column) => column.label),
        bagPacks: 600,
        includeZeroRows,
      }));
    }

    if (bigColumns.length) {
      bigRows.push(...parseRows({
        rows,
        start,
        end,
        colorIndex: 12,
        bagIndex: 13,
        packIndex: 14,
        commonBoxIndex: 15,
        sizeBoxIndexes: bigColumns.map((column) => column.index),
        sizeLabels: bigColumns.map((column) => column.label),
        bagPacks: 300,
        includeZeroRows,
      }));
    }

    blockIndex += 1;
    rowIndex = end;
  }

  const small = mergeGroupRows(smallRows);
  const big = mergeGroupRows(bigRows);
  const allGroups = [...small, ...big];

  return {
    key: sheet.key,
    title: sheet.title,
    label: sheet.label,
    small,
    big,
    totals: {
      packs: allGroups.reduce((sum, row) => sum + row.totalPacks, 0),
      sharedPacks: allGroups.reduce((sum, row) => sum + row.sharedPacks, 0),
      sizeBoxPacks: allGroups.reduce((sum, row) => sum + row.sizeBoxPacks, 0),
      colors: new Set(allGroups.map((row) => row.color)).size,
    },
  };
}

function findWarehouseArticle(rows: unknown[][]) {
  const topText = rows.slice(0, 6).flat().map(text).join(" ");
  return topText.match(/Артикул\s*(?:WB|ВБ)\s*:?\s*(\d+)/i)?.[1] || "";
}

function findWarehousePerBoxRow(rows: unknown[][]) {
  return rows.findIndex((row) => row.some((value) => text(value).toLocaleLowerCase("ru-RU").includes("штук в коробке")));
}

function inferWarehouseCategory(title: string): "rib" | "smooth" | "stringRib" | "none" {
  const normalized = title.toLocaleLowerCase("ru-RU");
  if (normalized.includes("стринг")) return "stringRib";
  if (normalized.includes("глад")) return "smooth";
  if (normalized.includes("рубчик")) return "rib";
  return "none";
}

function parseTitleColorCounts(title: string) {
  const match = title.match(/\(([^)]+)\)/);
  if (!match) return new Map<string, number>();

  const counts = new Map<string, number>();
  const content = match[1];
  const pattern = /(\d+)\s*([А-Яа-яЁё.]+)/g;
  let item: RegExpExecArray | null;
  while ((item = pattern.exec(content))) {
    const color = canonicalColor(item[2]);
    const qty = Number(item[1]) || 0;
    if (color && qty > 0) counts.set(color, (counts.get(color) || 0) + qty);
  }
  return counts;
}

function parseKitPieces(title: string) {
  const match = title.match(/(\d+)\s*шт/i);
  const pieces = match ? Number(match[1]) : 0;
  return Number.isFinite(pieces) && pieces > 0 ? pieces : 0;
}

function parseWarehouseArticleConfig(sheetName: string, rows: unknown[][]) {
  const article = findWarehouseArticle(rows);
  if (!article) return null;

  const perBoxRowIndex = findWarehousePerBoxRow(rows);
  if (perBoxRowIndex < 0) return null;

  const perBoxRow = rows[perBoxRowIndex] || [];
  const colorColumn = perBoxRow.findIndex((value) => text(value).toLocaleLowerCase("ru-RU").includes("штук в коробке"));
  if (colorColumn < 0) return null;

  const colors = new Map<string, number>();
  const title = text(rows[0]?.[0] || sheetName);
  const titleCounts = parseTitleColorCounts(title);
  const kitPieces = parseKitPieces(title);

  for (let rowIndex = perBoxRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const color = canonicalColor(text(rows[rowIndex]?.[colorColumn]));
    if (!color) {
      if (colors.size > 0) break;
      continue;
    }
    colors.set(color, titleCounts.get(color) || 1);
  }

  if (colors.size === 1 && titleCounts.size === 0 && kitPieces > 1) {
    const [color] = colors.keys();
    colors.set(color, kitPieces);
  }

  return {
    article,
    sheetName,
    category: inferWarehouseCategory(sheetName),
    colors: Object.fromEntries(colors),
  };
}

async function fetchWarehouseArticleConfigs(accessToken: string) {
  const metaParams = new URLSearchParams({
    fields: "properties.title,sheets.properties(title)",
    includeGridData: "false",
  });
  const metaResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${WAREHOUSE_SPREADSHEET_ID}?${metaParams}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const meta = await metaResponse.json();
  if (!metaResponse.ok) throw new Error(`Warehouse sheets meta ${metaResponse.status}: ${JSON.stringify(meta)}`);

  const sheetTitles = ((meta.sheets || []) as Array<{ properties?: { title?: string } }>)
    .map((sheet) => sheet.properties?.title || "")
    .filter(Boolean);
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  sheetTitles.forEach((title) => params.append("ranges", quoteSheetRange(title, WAREHOUSE_RANGE)));

  const valuesResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${WAREHOUSE_SPREADSHEET_ID}/values:batchGet?${params}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const values = await valuesResponse.json();
  if (!valuesResponse.ok) throw new Error(`Warehouse sheets values ${valuesResponse.status}: ${JSON.stringify(values)}`);

  const valueRanges = (values.valueRanges || []) as Array<{ values?: unknown[][] }>;
  return sheetTitles
    .map((title, index) => parseWarehouseArticleConfig(title, valueRanges[index]?.values || []))
    .filter((config): config is NonNullable<ReturnType<typeof parseWarehouseArticleConfig>> => Boolean(config));
}

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const accessToken = await getAccessToken();
    const params = new URLSearchParams();
    SHEETS.forEach((sheet) => params.append("ranges", quoteSheetRange(sheet.title)));
    params.set("valueRenderOption", "UNFORMATTED_VALUE");
    params.set("dateTimeRenderOption", "FORMATTED_STRING");

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } }
    );
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: data }, { status: response.status });
    }

    const valueRanges = (data.valueRanges || []) as Array<{ values?: unknown[][] }>;
    const sheets = SHEETS.map((sheet, index) => parseSheet(sheet, valueRanges[index]?.values || []));
    let warehouseArticleConfigs: Awaited<ReturnType<typeof fetchWarehouseArticleConfigs>> = [];
    let warehouseConfigError = "";
    try {
      warehouseArticleConfigs = await fetchWarehouseArticleConfigs(accessToken);
    } catch (error) {
      warehouseConfigError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json({
      ok: true,
      spreadsheetId: SPREADSHEET_ID,
      sheets,
      warehouseArticleConfigs,
      warehouseConfigError,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
