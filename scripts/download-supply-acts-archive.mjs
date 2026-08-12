import crypto from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";
import organizationRuntime from "./lib/organization-runtime.js";

const {
  ensureOrganizationDataDir,
  organizationDataDir,
  organizationDataPath,
  organizationPoolOptions,
  requireOrganizationId,
} = organizationRuntime;
const PROJECT_DIR = process.cwd();
const ORGANIZATION_ID = requireOrganizationId();
ensureOrganizationDataDir(PROJECT_DIR, ORGANIZATION_ID);

const SUPPLIES_API = "https://supplies-api.wildberries.ru/api/v1/supplies";
const SELLER_SUPPLY_ACT_API =
  "https://seller-supply.wildberries.ru/ns/sm-supply/supply-manager/api/v1/supply/act";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const pageLimit = numberArg("page-limit", 100);
const startOffset = numberArg("start-offset", 0);
const maxPages = numberArg("max-pages", 1000);
const delayMs = numberArg("delay-ms", 1500);
const detailDelayMs = numberArg("detail-delay-ms", 2500);
const stopConsecutiveErrors = numberArg("stop-consecutive-errors", 20);
const maxDownloads = numberArg("max-downloads", 0);

function numberArg(name, fallback) {
  const raw = args.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const value = fs.readFileSync(filePath, "utf8").trim();
  if (!value) throw new Error(`${label} is empty: ${filePath}`);
  return value;
}

const apiKey = readRequiredFile(organizationDataPath(PROJECT_DIR, "wb-api-key.txt", ORGANIZATION_ID), "WB API key");
const tokens = JSON.parse(readRequiredFile(organizationDataPath(PROJECT_DIR, "wb-tokens.json", ORGANIZATION_ID), "WB seller tokens"));
if (!tokens.authorizev3 || !tokens.cookies) throw new Error("WB seller tokens must contain authorizev3 and cookies");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: organizationPoolOptions(ORGANIZATION_ID),
  application_name: "mphub-supply-acts-archive",
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function safeFileName(fileName, extension) {
  const clean = path.basename(fileName).replace(/[^\wа-яА-ЯёЁ .()#-]+/g, "_").trim();
  if (!clean) return `document.${extension}`;
  return clean.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? clean : `${clean}.${extension}`;
}

function ensureSupplyDir(supplyID) {
  const root = path.resolve(organizationDataDir(PROJECT_DIR, ORGANIZATION_ID), "supply-documents");
  const dir = path.resolve(root, String(supplyID));
  if (!dir.startsWith(root + path.sep)) throw new Error("Unsafe supply documents path");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dateKey(row) {
  return row.factDate || row.supplyDate || row.updatedDate || row.createDate || "";
}

async function fetchSupplyPage(offset) {
  const res = await fetchWithTimeout(`${SUPPLIES_API}?limit=${pageLimit}&offset=${offset}`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ statusIDs: [5] }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supplies API offset ${offset}: HTTP ${res.status}: ${text.slice(0, 500)}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`supplies API offset ${offset}: unexpected response`);
  return rows;
}

async function fetchSupplyDetail(supplyID) {
  const res = await fetchWithTimeout(`${SUPPLIES_API}/${encodeURIComponent(String(supplyID))}`, {
    headers: { Authorization: apiKey },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supply detail ${supplyID}: HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function readExistingDetail(supplyID) {
  const result = await pool.query(
    `
      SELECT detail_json
      FROM wb_accepted_supplies
      WHERE supply_id = $1
    `,
    [supplyID]
  );
  const raw = result.rows[0]?.detail_json;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasUsableDetail(detail) {
  if (!detail || typeof detail !== "object") return false;
  const hasWarehouse = Boolean(detail.warehouseName || detail.actualWarehouseName);
  const hasQuantity = typeof detail.quantity === "number" || typeof detail.acceptedQuantity === "number";
  return hasWarehouse && hasQuantity;
}

async function upsertAcceptedSupply(row, detail, listPosition) {
  const supplyID = Number(row.supplyID);
  const now = new Date().toISOString();
  const values = [
    supplyID,
    numberOrNull(row.preorderID),
    numberOrNull(detail.statusID ?? row.statusID),
    numberOrNull(detail.virtualTypeID),
    numberOrNull(detail.boxTypeID ?? row.boxTypeID),
    stringOrNull(detail.createDate ?? row.createDate),
    stringOrNull(detail.supplyDate ?? row.supplyDate),
    stringOrNull(detail.factDate ?? row.factDate),
    stringOrNull(detail.updatedDate ?? row.updatedDate),
    stringOrNull(detail.warehouseName),
    stringOrNull(detail.actualWarehouseName),
    numberOrNull(detail.quantity),
    numberOrNull(detail.acceptedQuantity),
    JSON.stringify(row),
    JSON.stringify(detail),
    now,
  ];
  await pool.query(
    `
      INSERT INTO wb_accepted_supplies (
        supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
        create_date, supply_date, fact_date, updated_date,
        warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
        row_json, detail_json, saved_at, refreshed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
      ON CONFLICT(supply_id) DO UPDATE SET
        preorder_id = EXCLUDED.preorder_id,
        status_id = EXCLUDED.status_id,
        virtual_type_id = EXCLUDED.virtual_type_id,
        box_type_id = EXCLUDED.box_type_id,
        create_date = EXCLUDED.create_date,
        supply_date = EXCLUDED.supply_date,
        fact_date = EXCLUDED.fact_date,
        updated_date = EXCLUDED.updated_date,
        warehouse_name = EXCLUDED.warehouse_name,
        actual_warehouse_name = EXCLUDED.actual_warehouse_name,
        quantity = EXCLUDED.quantity,
        accepted_quantity = EXCLUDED.accepted_quantity,
        row_json = EXCLUDED.row_json,
        detail_json = EXCLUDED.detail_json,
        refreshed_at = EXCLUDED.refreshed_at
    `,
    values
  );
  await pool.query(
    `
      INSERT INTO wb_supply_snapshots (
        supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
        create_date, supply_date, fact_date, updated_date,
        warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
        list_position, row_json, detail_json, saved_at, refreshed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $17, $14, $15, $16, $16)
      ON CONFLICT(supply_id) DO UPDATE SET
        preorder_id = EXCLUDED.preorder_id,
        status_id = EXCLUDED.status_id,
        virtual_type_id = EXCLUDED.virtual_type_id,
        box_type_id = EXCLUDED.box_type_id,
        create_date = EXCLUDED.create_date,
        supply_date = EXCLUDED.supply_date,
        fact_date = EXCLUDED.fact_date,
        updated_date = EXCLUDED.updated_date,
        warehouse_name = EXCLUDED.warehouse_name,
        actual_warehouse_name = EXCLUDED.actual_warehouse_name,
        quantity = EXCLUDED.quantity,
        accepted_quantity = EXCLUDED.accepted_quantity,
        list_position = EXCLUDED.list_position,
        row_json = EXCLUDED.row_json,
        detail_json = EXCLUDED.detail_json,
        refreshed_at = EXCLUDED.refreshed_at
    `,
    [...values, listPosition]
  );
}

async function existingSavedAct(supplyID) {
  const result = await pool.query(
    `
      SELECT file_path
      FROM wb_supply_report_documents
      WHERE supply_id = $1 AND document_type = 'acceptance_act' AND status = 'saved'
    `,
    [supplyID]
  );
  const filePath = result.rows[0]?.file_path;
  return Boolean(filePath && fs.existsSync(filePath));
}

async function downloadAct(supplyID) {
  const res = await fetchWithTimeout(SELLER_SUPPLY_ACT_API, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache",
      "content-type": "application/json",
      pragma: "no-cache",
      authorizev3: tokens.authorizev3,
      cookie: tokens.cookies || "",
      origin: "https://seller.wildberries.ru",
      referer: "https://seller.wildberries.ru/",
    },
    body: JSON.stringify({
      id: `json-rpc_${Date.now()}`,
      jsonrpc: "2.0",
      params: { supplyId: supplyID },
    }),
  }, 30000);
  const text = await res.text();
  if (!res.ok) throw new Error(`seller-supply HTTP ${res.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error).slice(0, 500));
  if (parsed.result?.isForming) throw new Error("seller-supply act is still forming");
  if (!parsed.result?.act) throw new Error(`seller-supply response has no act payload: ${text.slice(0, 500)}`);
  const extension = parsed.result.extension || "zip";
  const buffer = Buffer.from(parsed.result.act, "base64");
  if (extension === "zip" && buffer.subarray(0, 2).toString("utf8") !== "PK") {
    throw new Error("seller-supply act payload is not a ZIP archive");
  }
  return { buffer, extension };
}

async function saveAct(supplyID, file) {
  const dir = ensureSupplyDir(supplyID);
  const fileName = safeFileName(`acceptance_act-act-income-${supplyID}`, file.extension);
  const filePath = path.resolve(dir, fileName);
  if (!filePath.startsWith(path.resolve(dir) + path.sep)) throw new Error("Unsafe document path");
  fs.writeFileSync(filePath, file.buffer);
  const now = new Date().toISOString();
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  await pool.query(
    `
      INSERT INTO wb_supply_report_documents (
        supply_id, document_type, status, service_name, document_name, category,
        extension, content_type, file_name, file_path, size_bytes, sha256,
        creation_time, downloaded_at, checked_at, error, source_json
      )
      VALUES ($1, 'acceptance_act', 'saved', $2, $3, 'seller-supply', $4, 'application/zip', $5, $6, $7, $8, $9, $9, $9, NULL, $10)
      ON CONFLICT(supply_id, document_type) DO UPDATE SET
        status = EXCLUDED.status,
        service_name = EXCLUDED.service_name,
        document_name = EXCLUDED.document_name,
        category = EXCLUDED.category,
        extension = EXCLUDED.extension,
        content_type = EXCLUDED.content_type,
        file_name = EXCLUDED.file_name,
        file_path = EXCLUDED.file_path,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        creation_time = EXCLUDED.creation_time,
        downloaded_at = EXCLUDED.downloaded_at,
        checked_at = EXCLUDED.checked_at,
        error = NULL,
        source_json = EXCLUDED.source_json
    `,
    [
      supplyID,
      `seller-supply-act-${supplyID}`,
      `Акт приемки ${supplyID}`,
      file.extension,
      fileName,
      filePath,
      file.buffer.length,
      sha256,
      now,
      JSON.stringify({ source: "seller-supply", supplyID }),
    ]
  );
  return { fileName, size: file.buffer.length, sha256 };
}

async function markActError(supplyID, message) {
  const now = new Date().toISOString();
  await pool.query(
    `
      INSERT INTO wb_supply_report_documents (
        supply_id, document_type, status, service_name, document_name, category,
        extension, checked_at, error, source_json
      )
      VALUES ($1, 'acceptance_act', 'error', $2, $3, 'seller-supply', 'zip', $4, $5, $6)
      ON CONFLICT(supply_id, document_type) DO UPDATE SET
        status = EXCLUDED.status,
        service_name = EXCLUDED.service_name,
        document_name = EXCLUDED.document_name,
        category = EXCLUDED.category,
        extension = EXCLUDED.extension,
        checked_at = EXCLUDED.checked_at,
        error = EXCLUDED.error,
        source_json = EXCLUDED.source_json
    `,
    [
      supplyID,
      `seller-supply-act-${supplyID}`,
      `Акт приемки ${supplyID}`,
      now,
      message.slice(0, 1000),
      JSON.stringify({ source: "seller-supply", supplyID }),
    ]
  );
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

async function main() {
  let fetched = 0;
  let insertedOrUpdated = 0;
  let skipped = 0;
  let saved = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let stopReason = "";
  const seen = new Set();

  for (let page = 0; page < maxPages; page++) {
    const offset = startOffset + page * pageLimit;
    const rows = await fetchSupplyPage(offset);
    if (rows.length === 0) {
      stopReason = `empty supplies page at offset ${offset}`;
      break;
    }

    fetched += rows.length;
    const firstDate = dateKey(rows[0]);
    const lastDate = dateKey(rows[rows.length - 1]);
    console.log(`[page] offset=${offset} count=${rows.length} first=${firstDate} last=${lastDate}`);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const supplyID = Number(row.supplyID);
      if (!Number.isSafeInteger(supplyID) || seen.has(supplyID)) continue;
      seen.add(supplyID);

      let detail = await readExistingDetail(supplyID);
      if (!hasUsableDetail(detail)) {
        detail = {
        statusID: row.statusID,
        boxTypeID: row.boxTypeID,
        createDate: row.createDate,
        supplyDate: row.supplyDate,
        factDate: row.factDate,
        updatedDate: row.updatedDate,
        isBoxOnPallet: row.isBoxOnPallet,
        };
        try {
          detail = await fetchSupplyDetail(supplyID);
          await sleep(detailDelayMs);
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error);
          if (message.includes("HTTP 429")) {
            stopReason = `WB detail API rate limit at supply ${supplyID}`;
            console.log(`[detail-rate-limit] ${supplyID} ${dateKey(row)} ${message.slice(0, 220)}`);
            break;
          }
          detail = await readExistingDetail(supplyID) || detail;
          console.log(`[detail-error] ${supplyID} ${dateKey(row)} ${message.slice(0, 220)}`);
          await sleep(detailDelayMs);
        }
      }

      await upsertAcceptedSupply(row, detail, offset + index);
      insertedOrUpdated++;

      if (await existingSavedAct(supplyID)) {
        skipped++;
        continue;
      }

      try {
        const file = await downloadAct(supplyID);
        const savedFile = await saveAct(supplyID, file);
        saved++;
        consecutiveErrors = 0;
        console.log(`[saved] ${supplyID} ${dateKey(row)} ${savedFile.size} ${savedFile.fileName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors++;
        consecutiveErrors++;
        await markActError(supplyID, message);
        console.log(`[error] ${supplyID} ${dateKey(row)} ${message.slice(0, 220)}`);
        if (consecutiveErrors >= stopConsecutiveErrors) {
          stopReason = `${consecutiveErrors} consecutive act download errors`;
          break;
        }
      }

      if (maxDownloads > 0 && saved >= maxDownloads) {
        stopReason = `max downloads reached: ${maxDownloads}`;
        break;
      }
      await sleep(delayMs);
    }

    if (stopReason) break;
    await sleep(delayMs);
  }

  const status = await pool.query(`
    SELECT status, count(*)::int AS count
    FROM wb_supply_report_documents
    WHERE document_type = 'acceptance_act'
    GROUP BY status
    ORDER BY status
  `);
  const supplyRange = await pool.query(`
    SELECT count(*)::int AS count,
           min(coalesce(fact_date, supply_date, updated_date, create_date)) AS min_date,
           max(coalesce(fact_date, supply_date, updated_date, create_date)) AS max_date
    FROM wb_accepted_supplies
  `);

  console.log("[summary]", JSON.stringify({
    fetched,
    insertedOrUpdated,
    skipped,
    saved,
    errors,
    stopReason: stopReason || "max pages reached",
    supplyRange: supplyRange.rows[0],
    acceptanceActStatuses: status.rows,
  }));
}

main()
  .catch((error) => {
    console.error("[fatal]", error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
