import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isPostgresReadonlyConnection, pgGet, pgRows } from "./postgres";
import {
  downloadWbSupplyActFromSellerPortal,
  downloadWbSupplyReconciliationFromSellerPortal,
  downloadWbDocument,
  ensureSupplyDocumentsDir,
  listWbDocuments,
  safeDownloadFileName,
  type WbDocumentListItem,
} from "./wb-documents-api";
import { getWbApiKey } from "./wb-api-key";
import { getOrganizationDataDir } from "./organization-paths";

export const SUPPLY_REPORT_DOCUMENT_TYPES = [
  { key: "acceptance_act", label: "Акт приемки" },
  { key: "reconciliation_report", label: "Отчет сверки" },
  { key: "honest_sign", label: "Честный знак" },
] as const;

export type SupplyReportDocumentType = typeof SUPPLY_REPORT_DOCUMENT_TYPES[number]["key"];

export interface SupplyReportDocument {
  supplyID: number;
  type: SupplyReportDocumentType;
  label: string;
  status: "missing" | "available" | "saved" | "error";
  serviceName: string | null;
  documentName: string | null;
  category: string | null;
  extension: string | null;
  creationTime: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  downloadedAt: string | null;
  checkedAt: string | null;
  error: string | null;
}

export interface SupplyReportRow {
  supplyID: number;
  preorderID: number | null;
  statusID: number | null;
  supplyDate: string | null;
  factDate: string | null;
  warehouseName: string | null;
  actualWarehouseName: string | null;
  quantity: number | null;
  acceptedQuantity: number | null;
  documents: Record<SupplyReportDocumentType, SupplyReportDocument>;
}

interface AcceptedSupplyDbRow {
  supply_id: number;
  preorder_id: number | null;
  status_id: number | null;
  supply_date: string | null;
  fact_date: string | null;
  warehouse_name: string | null;
  actual_warehouse_name: string | null;
  quantity: number | null;
  accepted_quantity: number | null;
}

interface SupplyDocumentDbRow {
  supply_id: number;
  document_type: SupplyReportDocumentType;
  status: "missing" | "available" | "saved" | "error";
  service_name: string | null;
  document_name: string | null;
  category: string | null;
  extension: string | null;
  content_type?: string | null;
  creation_time: string | null;
  file_name: string | null;
  file_path: string | null;
  size_bytes: number | null;
  downloaded_at: string | null;
  checked_at: string | null;
  error: string | null;
}

interface WbAcceptedSupplyListRow {
  phone?: string;
  supplyID: number | null;
  preorderID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  statusID?: number;
  boxTypeID?: number;
  isBoxOnPallet?: boolean;
}

interface WbAcceptedSupplyDetail {
  statusID?: number;
  virtualTypeID?: number;
  boxTypeID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  warehouseName?: string;
  actualWarehouseName?: string;
  quantity?: number;
  acceptedQuantity?: number;
  isBoxOnPallet?: boolean;
}

const DOCUMENT_CATEGORIES = [
  "act-income",
  "act-income-mp",
  "act-revise",
  "UIN-verification",
  "UPD po markirovke",
];

const DOCUMENT_TYPE_LABELS = Object.fromEntries(
  SUPPLY_REPORT_DOCUMENT_TYPES.map((item) => [item.key, item.label])
) as Record<SupplyReportDocumentType, string>;

export async function ensureSupplyReportTablesPg(): Promise<void> {
  if (isPostgresReadonlyConnection()) return;
  await pgGet(`
    CREATE TABLE IF NOT EXISTS wb_supply_report_documents (
      supply_id BIGINT NOT NULL,
      document_type TEXT NOT NULL,
      status TEXT NOT NULL,
      service_name TEXT,
      document_name TEXT,
      category TEXT,
      extension TEXT,
      content_type TEXT,
      file_name TEXT,
      file_path TEXT,
      size_bytes BIGINT,
      sha256 TEXT,
      creation_time TEXT,
      downloaded_at TEXT,
      checked_at TEXT NOT NULL,
      error TEXT,
      source_json TEXT,
      PRIMARY KEY(supply_id, document_type)
    )
  `);
  await pgGet(`
    CREATE INDEX IF NOT EXISTS idx_wb_supply_report_documents_checked
    ON wb_supply_report_documents(checked_at DESC)
  `);
}

export async function listSupplyReportsPg(limit = 100, offset = 0): Promise<{
  rows: SupplyReportRow[];
  stats: { supplies: number; savedDocuments: number; availableDocuments: number; missingDocuments: number; errorDocuments: number };
}> {
  const supplies = await readAcceptedSupplies(limit, offset);
  const supplyIDs = supplies.map((row) => row.supply_id);
  const docs = supplyIDs.length > 0 ? await readDocumentsForSupplies(supplyIDs) : [];
  const docsBySupply = new Map<string, SupplyDocumentDbRow>();
  for (const doc of docs) docsBySupply.set(`${doc.supply_id}:${doc.document_type}`, doc);

  const rows = supplies.map((supply) => {
    const documents = {} as Record<SupplyReportDocumentType, SupplyReportDocument>;
    for (const docType of SUPPLY_REPORT_DOCUMENT_TYPES) {
      documents[docType.key] = normalizeDocumentRow(
        supply.supply_id,
        docType.key,
        docsBySupply.get(`${supply.supply_id}:${docType.key}`)
      );
    }
    return {
      supplyID: supply.supply_id,
      preorderID: supply.preorder_id,
      statusID: supply.status_id,
      supplyDate: supply.supply_date,
      factDate: supply.fact_date,
      warehouseName: supply.warehouse_name,
      actualWarehouseName: supply.actual_warehouse_name,
      quantity: supply.quantity,
      acceptedQuantity: supply.accepted_quantity,
      documents,
    };
  });

  return { rows, stats: buildStats(rows) };
}

export async function syncSupplyReportDocumentsPg(opts: {
  download?: boolean;
  supplyLimit?: number;
  documentPageLimit?: number;
} = {}): Promise<{
  checkedSupplies: number;
  discoveredDocuments: number;
  savedDocuments: number;
  missingDocuments: number;
  errors: string[];
}> {
  await ensureSupplyReportTablesPg();
  if (isPostgresReadonlyConnection()) {
    throw new Error("Supply report sync is disabled in local PostgreSQL readonly mode");
  }

  await backfillAcceptedSuppliesFromWb(opts.supplyLimit || 200);
  const supplies = await readAcceptedSupplies(opts.supplyLimit || 200, 0);
  const supplyIDs = new Set(supplies.map((supply) => supply.supply_id));
  const bySupplyType = await fetchMatchingDocuments(supplyIDs, opts.documentPageLimit || 8);
  let savedDocuments = 0;
  let missingDocuments = 0;
  const errors: string[] = [];

  for (const supply of supplies) {
    for (const docType of SUPPLY_REPORT_DOCUMENT_TYPES) {
      const existingFile = await getSupplyReportDocumentFilePg(supply.supply_id, docType.key);
      if (existingFile) {
        savedDocuments++;
        continue;
      }

      const match = bySupplyType.get(`${supply.supply_id}:${docType.key}`);
      if (!match) {
        if (opts.download && (docType.key === "acceptance_act" || docType.key === "reconciliation_report")) {
          try {
            const file = await downloadSupplyReportDocumentFromSellerPortal(supply.supply_id, docType.key);
            const dir = ensureSupplyDocumentsDir(supply.supply_id);
            const fileName = safeDownloadFileName(`${docType.key}-${file.fileName}`, file.extension);
            const filePath = path.resolve(dir, fileName);
            if (!filePath.startsWith(path.resolve(dir) + path.sep)) throw new Error("Unsafe document path");
            fs.writeFileSync(filePath, file.buffer);
            savedDocuments++;
            await upsertDocumentStatus({
              supplyID: supply.supply_id,
              type: docType.key,
              status: "saved",
              document: {
                serviceName: `seller-supply-${docType.key}-${supply.supply_id}`,
                name: `${docType.label} ${supply.supply_id}`,
                category: "seller-supply",
                extensions: [file.extension],
                creationTime: new Date().toISOString(),
              },
              extension: file.extension,
              contentType: file.contentType,
              fileName,
              filePath,
              sizeBytes: file.buffer.length,
              sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
              downloadedAt: new Date().toISOString(),
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${supply.supply_id} ${docType.label}: ${message}`);
            await upsertDocumentStatus({
              supplyID: supply.supply_id,
              type: docType.key,
              status: "error",
              error: message.slice(0, 1000),
            });
          }
          await sleep(11000);
          continue;
        }

        missingDocuments++;
        await upsertDocumentStatus({
          supplyID: supply.supply_id,
          type: docType.key,
          status: "missing",
          error: null,
        });
        continue;
      }

      const extension = preferredExtension(match, docType.key);
      try {
        if (!opts.download) {
          await upsertDocumentStatus({
            supplyID: supply.supply_id,
            type: docType.key,
            status: "available",
            document: match,
            extension,
          });
          continue;
        }

        const file = await fetchSupplyReportDocumentFile(
          supply.supply_id,
          docType.key,
          match.serviceName,
          extension
        );
        const dir = ensureSupplyDocumentsDir(supply.supply_id);
        const fileName = safeDownloadFileName(`${docType.key}-${file.fileName}`, file.extension);
        const filePath = path.resolve(dir, fileName);
        if (!filePath.startsWith(path.resolve(dir) + path.sep)) throw new Error("Unsafe document path");
        fs.writeFileSync(filePath, file.buffer);
        savedDocuments++;
        await upsertDocumentStatus({
          supplyID: supply.supply_id,
          type: docType.key,
          status: "saved",
          document: match,
          extension: file.extension,
          contentType: file.contentType,
          fileName,
          filePath,
          sizeBytes: file.buffer.length,
          sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
          downloadedAt: new Date().toISOString(),
        });
        await sleep(11000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${supply.supply_id} ${docType.label}: ${message}`);
        await upsertDocumentStatus({
          supplyID: supply.supply_id,
          type: docType.key,
          status: "error",
          document: match,
          extension,
          error: message.slice(0, 1000),
        });
        await sleep(11000);
      }
    }
  }

  return {
    checkedSupplies: supplies.length,
    discoveredDocuments: bySupplyType.size,
    savedDocuments,
    missingDocuments,
    errors,
  };
}

async function backfillAcceptedSuppliesFromWb(limit: number): Promise<void> {
  const apiKey = getWbApiKey();
  if (!apiKey) return;

  const res = await fetch(`https://supplies-api.wildberries.ru/api/v1/supplies?limit=${Math.min(limit, 1000)}&offset=0`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ statusIDs: [5] }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB supplies API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const rows = (await res.json()) as WbAcceptedSupplyListRow[];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const supplyID = Number(row.supplyID);
    if (!Number.isSafeInteger(supplyID)) continue;
    const { detail, fetched } = await getAcceptedSupplyDetailForBackfill(supplyID, row);
    const now = new Date().toISOString();
    await pgGet(`
      INSERT INTO wb_accepted_supplies (
        supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
        create_date, supply_date, fact_date, updated_date,
        warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
        row_json, detail_json, saved_at, refreshed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      RETURNING supply_id
    `, [
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
      now,
    ]);
    await pgGet(`
      INSERT INTO wb_supply_snapshots (
        supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
        create_date, supply_date, fact_date, updated_date,
        warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
        list_position, row_json, detail_json, saved_at, refreshed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      RETURNING supply_id
    `, [
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
      index,
      JSON.stringify(row),
      JSON.stringify(detail),
      now,
      now,
    ]);
    if (fetched) await sleep(2100);
  }
}

async function getAcceptedSupplyDetailForBackfill(
  supplyID: number,
  row: WbAcceptedSupplyListRow
): Promise<{ detail: WbAcceptedSupplyDetail; fetched: boolean }> {
  const existing = await pgGet<{
    warehouse_name: string | null;
    actual_warehouse_name: string | null;
    quantity: number | null;
    accepted_quantity: number | null;
    detail_json: string | null;
  }>(`
    SELECT warehouse_name, actual_warehouse_name, quantity, accepted_quantity, detail_json
    FROM wb_accepted_supplies
    WHERE supply_id = ?
  `, [supplyID]).catch(() => undefined);
  if (
    existing?.detail_json &&
    (existing.warehouse_name || existing.actual_warehouse_name) &&
    (existing.quantity !== null || existing.accepted_quantity !== null)
  ) {
    try {
      return { detail: JSON.parse(existing.detail_json) as WbAcceptedSupplyDetail, fetched: false };
    } catch {
      // Re-fetch malformed cached detail below.
    }
  }

  const apiKey = getWbApiKey();
  if (!apiKey) return { detail: fallbackAcceptedSupplyDetail(row), fetched: false };

  const res = await fetch(`https://supplies-api.wildberries.ru/api/v1/supplies/${encodeURIComponent(String(supplyID))}`, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  });
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB supplies detail API rate limit: ${text.slice(0, 300)}`);
  }
  if (!res.ok) return { detail: fallbackAcceptedSupplyDetail(row), fetched: false };
  return { detail: (await res.json()) as WbAcceptedSupplyDetail, fetched: true };
}

function fallbackAcceptedSupplyDetail(row: WbAcceptedSupplyListRow): WbAcceptedSupplyDetail {
  return {
      statusID: row.statusID,
      boxTypeID: row.boxTypeID,
      createDate: row.createDate,
      supplyDate: row.supplyDate,
      factDate: row.factDate,
      updatedDate: row.updatedDate,
      isBoxOnPallet: row.isBoxOnPallet,
    };
}

export async function getSupplyReportDocumentFilePg(
  supplyID: number,
  type: SupplyReportDocumentType
): Promise<{ path: string; fileName: string; contentType: string } | null> {
  const row = await pgGet<{ file_path: string | null; file_name: string | null; content_type: string | null }>(`
    SELECT file_path, file_name, content_type
    FROM wb_supply_report_documents
    WHERE supply_id = ? AND document_type = ? AND status = 'saved'
  `, [supplyID, type]).catch(() => undefined);
  if (!row?.file_path || !row.file_name) return null;

  const root = path.resolve(getOrganizationDataDir(), "supply-documents");
  const filePath = path.resolve(row.file_path);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) return null;
  if (row.content_type?.includes("application/json")) return null;
  const fd = fs.openSync(filePath, "r");
  try {
    const headBuffer = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, headBuffer, 0, headBuffer.length, 0);
    const head = headBuffer.subarray(0, bytesRead).toString("utf-8");
    if (/^\s*\{"data":\{/.test(head)) return null;
  } finally {
    fs.closeSync(fd);
  }
  return { path: filePath, fileName: row.file_name, contentType: row.content_type || contentTypeByExtension(row.file_name) };
}

export async function downloadAndStoreSupplyReportDocumentPg(
  supplyID: number,
  type: SupplyReportDocumentType
): Promise<{ path: string; fileName: string; contentType: string }> {
  await ensureSupplyReportTablesPg();
  if (isPostgresReadonlyConnection()) {
    throw new Error("Supply report document download is disabled in local PostgreSQL readonly mode");
  }

  const existing = await getSupplyReportDocumentFilePg(supplyID, type);
  if (existing) return existing;

  const row = await pgGet<SupplyDocumentDbRow>(`
    SELECT
      supply_id, document_type, status, service_name, document_name, category,
      extension, content_type, creation_time, file_name, file_path, size_bytes,
      downloaded_at, checked_at, error
    FROM wb_supply_report_documents
    WHERE supply_id = ? AND document_type = ?
  `, [supplyID, type]);
  if ((!row?.service_name || !row.extension) && type !== "acceptance_act" && type !== "reconciliation_report") {
    throw new Error("Документ ещё не найден в WB. Сначала запустите синхронизацию.");
  }

  const file = row?.service_name && row.extension
    ? await fetchSupplyReportDocumentFile(supplyID, type, row.service_name, row.extension)
    : await downloadSupplyReportDocumentFromSellerPortal(supplyID, type);
  const dir = ensureSupplyDocumentsDir(supplyID);
  const fileName = safeDownloadFileName(`${type}-${file.fileName}`, file.extension);
  const filePath = path.resolve(dir, fileName);
  if (!filePath.startsWith(path.resolve(dir) + path.sep)) throw new Error("Unsafe document path");
  fs.writeFileSync(filePath, file.buffer);

  await upsertDocumentStatus({
    supplyID,
    type,
    status: "saved",
    document: {
      serviceName: row?.service_name || `seller-supply-${type}-${supplyID}`,
      name: row?.document_name || `${DOCUMENT_TYPE_LABELS[type]} ${supplyID}`,
      category: row?.category || "seller-supply",
      extensions: [row?.extension || file.extension],
      creationTime: row?.creation_time || new Date().toISOString(),
    },
    extension: file.extension,
    contentType: file.contentType,
    fileName,
    filePath,
    sizeBytes: file.buffer.length,
    sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    downloadedAt: new Date().toISOString(),
  });

  return { path: filePath, fileName, contentType: file.contentType };
}

async function readAcceptedSupplies(limit: number, offset: number): Promise<AcceptedSupplyDbRow[]> {
  return pgRows<AcceptedSupplyDbRow>(`
    SELECT
      supply_id, preorder_id, status_id, supply_date, fact_date,
      warehouse_name, actual_warehouse_name, quantity, accepted_quantity
    FROM wb_accepted_supplies
    ORDER BY COALESCE(fact_date, supply_date) DESC NULLS LAST, supply_id DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]).catch((error) => {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return [];
    throw error;
  });
}

async function readDocumentsForSupplies(supplyIDs: number[]): Promise<SupplyDocumentDbRow[]> {
  return pgRows<SupplyDocumentDbRow>(`
    SELECT
      supply_id, document_type, status, service_name, document_name, category,
      extension, content_type, creation_time, file_name, file_path, size_bytes,
      downloaded_at, checked_at, error
    FROM wb_supply_report_documents
    WHERE supply_id = ANY(?::bigint[])
  `, [supplyIDs]).catch((error) => {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return [];
    throw error;
  });
}

async function fetchMatchingDocuments(supplyIDs: Set<number>, pageLimit: number): Promise<Map<string, WbDocumentListItem>> {
  const result = new Map<string, WbDocumentListItem>();

  for (const category of DOCUMENT_CATEGORIES) {
    for (let page = 0; page < pageLimit; page++) {
      const docs = await listWbDocuments({ category, limit: 50, offset: page * 50 });
      for (const doc of docs) {
        const supplyID = extractSupplyID(doc);
        const type = classifyDocument(doc);
        if (!supplyID || !type || !supplyIDs.has(supplyID)) continue;
        result.set(`${supplyID}:${type}`, doc);
      }
      if (docs.length < 50) break;
      await sleep(10500);
    }
  }

  return result;
}

function normalizeDocumentRow(
  supplyID: number,
  type: SupplyReportDocumentType,
  row?: SupplyDocumentDbRow
): SupplyReportDocument {
  return {
    supplyID,
    type,
    label: DOCUMENT_TYPE_LABELS[type],
    status: row?.status || "missing",
    serviceName: row?.service_name || null,
    documentName: row?.document_name || null,
    category: row?.category || null,
    extension: row?.extension || null,
    creationTime: row?.creation_time || null,
    fileName: row?.file_name || null,
    sizeBytes: row?.size_bytes ?? null,
    downloadedAt: row?.downloaded_at || null,
    checkedAt: row?.checked_at || null,
    error: row?.error || null,
  };
}

function buildStats(rows: SupplyReportRow[]) {
  let savedDocuments = 0;
  let availableDocuments = 0;
  let missingDocuments = 0;
  let errorDocuments = 0;
  for (const row of rows) {
    for (const doc of Object.values(row.documents)) {
      if (doc.status === "saved") savedDocuments++;
      else if (doc.status === "available") availableDocuments++;
      else if (doc.status === "error") errorDocuments++;
      else missingDocuments++;
    }
  }
  return { supplies: rows.length, savedDocuments, availableDocuments, missingDocuments, errorDocuments };
}

function classifyDocument(doc: WbDocumentListItem): SupplyReportDocumentType | null {
  const text = `${doc.serviceName} ${doc.name} ${doc.category}`.toLowerCase();
  if (text.includes("markirovke") || text.includes("маркиров") || text.includes("честн") || text.includes("уин")) {
    return "honest_sign";
  }
  if (text.includes("сверк") || text.includes("reconciliation") || text.includes("revise")) {
    return "reconciliation_report";
  }
  if (text.includes("act-income") || text.includes("акт приемки") || text.includes("акт приёмки")) {
    return "acceptance_act";
  }
  return null;
}

function extractSupplyID(doc: WbDocumentListItem): number | null {
  const candidates = [doc.serviceName, doc.name];
  for (const value of candidates) {
    const matches = String(value || "").match(/\d{6,}/g) || [];
    for (const match of matches.reverse()) {
      const num = Number(match);
      if (Number.isSafeInteger(num)) return num;
    }
  }
  return null;
}

function preferredExtension(doc: WbDocumentListItem, type: SupplyReportDocumentType): string {
  const extensions = Array.isArray(doc.extensions) ? doc.extensions : [];
  if (type === "honest_sign") {
    return extensions.find((ext) => /csv/i.test(ext)) || extensions.find((ext) => /xml/i.test(ext)) || extensions[0] || "csv";
  }
  return extensions.find((ext) => /xlsx/i.test(ext)) || extensions.find((ext) => /zip/i.test(ext)) || extensions[0] || "xlsx";
}

async function fetchSupplyReportDocumentFile(
  supplyID: number,
  type: SupplyReportDocumentType,
  serviceName: string,
  extension: string
) {
  try {
    return await downloadWbDocument(serviceName, extension);
  } catch (officialError) {
    if (type !== "acceptance_act" && type !== "reconciliation_report") throw officialError;

    try {
      return await downloadSupplyReportDocumentFromSellerPortal(supplyID, type);
    } catch (sellerError) {
      throw new Error(
        `documents-api: ${errorMessage(officialError)}; seller-supply: ${errorMessage(sellerError)}`
      );
    }
  }
}

function downloadSupplyReportDocumentFromSellerPortal(supplyID: number, type: SupplyReportDocumentType) {
  if (type === "acceptance_act") return downloadWbSupplyActFromSellerPortal(supplyID);
  if (type === "reconciliation_report") return downloadWbSupplyReconciliationFromSellerPortal(supplyID);
  throw new Error(`Seller portal fallback is not supported for ${type}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function upsertDocumentStatus(input: {
  supplyID: number;
  type: SupplyReportDocumentType;
  status: "missing" | "available" | "saved" | "error";
  document?: WbDocumentListItem;
  extension?: string;
  contentType?: string;
  fileName?: string;
  filePath?: string;
  sizeBytes?: number;
  sha256?: string;
  downloadedAt?: string;
  error?: string | null;
}) {
  const now = new Date().toISOString();
  await pgGet(`
    INSERT INTO wb_supply_report_documents (
      supply_id, document_type, status, service_name, document_name, category,
      extension, content_type, file_name, file_path, size_bytes, sha256,
      creation_time, downloaded_at, checked_at, error, source_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supply_id, document_type) DO UPDATE SET
      status = EXCLUDED.status,
      service_name = EXCLUDED.service_name,
      document_name = EXCLUDED.document_name,
      category = EXCLUDED.category,
      extension = EXCLUDED.extension,
      content_type = COALESCE(EXCLUDED.content_type, wb_supply_report_documents.content_type),
      file_name = COALESCE(EXCLUDED.file_name, wb_supply_report_documents.file_name),
      file_path = COALESCE(EXCLUDED.file_path, wb_supply_report_documents.file_path),
      size_bytes = COALESCE(EXCLUDED.size_bytes, wb_supply_report_documents.size_bytes),
      sha256 = COALESCE(EXCLUDED.sha256, wb_supply_report_documents.sha256),
      creation_time = EXCLUDED.creation_time,
      downloaded_at = COALESCE(EXCLUDED.downloaded_at, wb_supply_report_documents.downloaded_at),
      checked_at = EXCLUDED.checked_at,
      error = EXCLUDED.error,
      source_json = EXCLUDED.source_json
    RETURNING supply_id
  `, [
    input.supplyID,
    input.type,
    input.status,
    input.document?.serviceName || null,
    input.document?.name || null,
    input.document?.category || null,
    input.extension || null,
    input.contentType || null,
    input.fileName || null,
    input.filePath || null,
    input.sizeBytes ?? null,
    input.sha256 || null,
    input.document?.creationTime || null,
    input.downloadedAt || null,
    now,
    input.error || null,
    input.document ? JSON.stringify(input.document) : null,
  ]);
}

function contentTypeByExtension(fileName: string): string {
  if (/\.xlsx$/i.test(fileName)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.zip$/i.test(fileName)) return "application/zip";
  if (/\.csv$/i.test(fileName)) return "text/csv; charset=utf-8";
  if (/\.xml$/i.test(fileName)) return "application/xml";
  return "application/octet-stream";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
