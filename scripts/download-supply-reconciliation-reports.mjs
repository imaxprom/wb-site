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

const SELLER_SUPPLY_RECONCILIATION_API =
  "https://seller-supply.wildberries.ru/ns/sm-supply/supply-manager/api/v1/supply/boxBarcodeIncongruityReport";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const limit = numberArg("limit", 1000);
const offset = numberArg("offset", 0);
const delayMs = numberArg("delay-ms", 1500);
const stopConsecutiveErrors = numberArg("stop-consecutive-errors", 20);

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

const tokens = JSON.parse(readRequiredFile(organizationDataPath(PROJECT_DIR, "wb-tokens.json", ORGANIZATION_ID), "WB seller tokens"));
if (!tokens.authorizev3 || !tokens.cookies) throw new Error("WB seller tokens must contain authorizev3 and cookies");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: organizationPoolOptions(ORGANIZATION_ID),
  application_name: "mphub-supply-reconciliation-archive",
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
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

function extensionByMime(mime) {
  if (/spreadsheetml|excel|xlsx/i.test(mime || "")) return "xlsx";
  if (/zip/i.test(mime || "")) return "zip";
  if (/csv/i.test(mime || "")) return "csv";
  if (/xml/i.test(mime || "")) return "xml";
  return "bin";
}

async function readSupplies() {
  const result = await pool.query(
    `
      SELECT supply_id, COALESCE(fact_date, supply_date, updated_date, create_date) AS supply_date
      FROM wb_accepted_supplies
      ORDER BY COALESCE(fact_date, supply_date, updated_date, create_date) DESC NULLS LAST, supply_id DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );
  return result.rows;
}

async function existingSavedReport(supplyID) {
  const result = await pool.query(
    `
      SELECT file_path
      FROM wb_supply_report_documents
      WHERE supply_id = $1 AND document_type = 'reconciliation_report' AND status = 'saved'
    `,
    [supplyID]
  );
  const filePath = result.rows[0]?.file_path;
  return Boolean(filePath && fs.existsSync(filePath));
}

async function downloadReport(supplyID) {
  const res = await fetchWithTimeout(SELLER_SUPPLY_RECONCILIATION_API, {
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
      params: { giID: supplyID },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`seller-supply HTTP ${res.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error).slice(0, 500));
  if (!parsed.result?.file) throw new Error(`seller-supply response has no file payload: ${text.slice(0, 500)}`);

  const contentType = parsed.result.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const extension = extensionByMime(contentType);
  const buffer = Buffer.from(parsed.result.file, "base64");
  if (extension === "xlsx" && buffer.subarray(0, 2).toString("utf8") !== "PK") {
    throw new Error("seller-supply reconciliation payload is not an XLSX archive");
  }
  return { buffer, extension, contentType };
}

async function saveReport(supplyID, file) {
  const dir = ensureSupplyDir(supplyID);
  const fileName = safeFileName(`reconciliation_report-box-barcode-incongruity-${supplyID}`, file.extension);
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
      VALUES ($1, 'reconciliation_report', 'saved', $2, $3, 'seller-supply', $4, $5, $6, $7, $8, $9, $10, $10, $10, NULL, $11)
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
      `seller-supply-reconciliation-${supplyID}`,
      `Отчет сверки ${supplyID}`,
      file.extension,
      file.contentType,
      fileName,
      filePath,
      file.buffer.length,
      sha256,
      now,
      JSON.stringify({ source: "seller-supply", endpoint: "boxBarcodeIncongruityReport", supplyID }),
    ]
  );
  return { fileName, size: file.buffer.length, sha256 };
}

async function markReportError(supplyID, message) {
  const now = new Date().toISOString();
  await pool.query(
    `
      INSERT INTO wb_supply_report_documents (
        supply_id, document_type, status, service_name, document_name, category,
        extension, checked_at, error, source_json
      )
      VALUES ($1, 'reconciliation_report', 'error', $2, $3, 'seller-supply', 'xlsx', $4, $5, $6)
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
      `seller-supply-reconciliation-${supplyID}`,
      `Отчет сверки ${supplyID}`,
      now,
      message.slice(0, 1000),
      JSON.stringify({ source: "seller-supply", endpoint: "boxBarcodeIncongruityReport", supplyID }),
    ]
  );
}

async function main() {
  const supplies = await readSupplies();
  let skipped = 0;
  let saved = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let stopReason = "";
  console.log(`[start] supplies=${supplies.length} limit=${limit} offset=${offset}`);

  for (const supply of supplies) {
    const supplyID = Number(supply.supply_id);
    if (!Number.isSafeInteger(supplyID)) continue;
    if (await existingSavedReport(supplyID)) {
      skipped++;
      continue;
    }

    try {
      const file = await downloadReport(supplyID);
      const savedFile = await saveReport(supplyID, file);
      saved++;
      consecutiveErrors = 0;
      console.log(`[saved] ${supplyID} ${supply.supply_date || ""} ${savedFile.size} ${savedFile.fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors++;
      consecutiveErrors++;
      await markReportError(supplyID, message);
      console.log(`[error] ${supplyID} ${supply.supply_date || ""} ${message.slice(0, 220)}`);
      if (consecutiveErrors >= stopConsecutiveErrors) {
        stopReason = `${consecutiveErrors} consecutive reconciliation download errors`;
        break;
      }
    }
    await sleep(delayMs);
  }

  const status = await pool.query(`
    SELECT status, count(*)::int AS count
    FROM wb_supply_report_documents
    WHERE document_type = 'reconciliation_report'
    GROUP BY status
    ORDER BY status
  `);
  console.log("[summary]", JSON.stringify({
    checked: supplies.length,
    skipped,
    saved,
    errors,
    stopReason: stopReason || "completed selected supplies",
    reconciliationStatuses: status.rows,
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
