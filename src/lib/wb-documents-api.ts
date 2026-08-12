import fs from "fs";
import path from "path";
import { getWbApiKey } from "./wb-api-key";
import { loadTokens } from "./wb-seller-api";
import { getOrganizationDataDir } from "./organization-paths";

const DOCUMENTS_API = "https://documents-api.wildberries.ru/api/v1";
const SELLER_SUPPLY_API = "https://seller-supply.wildberries.ru/ns/sm-supply/supply-manager/api/v1";

export interface WbDocumentListItem {
  serviceName: string;
  name: string;
  category: string;
  extensions: string[];
  creationTime: string;
}

class WbDocumentsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface DownloadedDocumentFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  extension: string;
}

function getApiKey() {
  const apiKey = getWbApiKey();
  if (!apiKey) throw new Error("WB API key is not configured");
  return apiKey;
}

async function wbDocumentsFetch(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${DOCUMENTS_API}${pathname}`, {
    ...init,
    headers: {
      Authorization: getApiKey(),
      accept: "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new WbDocumentsApiError(text || `WB documents API HTTP ${res.status}`, res.status);
  }

  return res;
}

export async function listWbDocuments(opts: {
  category?: string;
  beginTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<WbDocumentListItem[]> {
  const params = new URLSearchParams({
    locale: "ru",
    limit: String(Math.min(Math.max(opts.limit || 50, 1), 50)),
    offset: String(Math.max(opts.offset || 0, 0)),
  });
  if (opts.category) params.set("category", opts.category);
  if (opts.beginTime && opts.endTime) {
    params.set("beginTime", opts.beginTime);
    params.set("endTime", opts.endTime);
  }

  const res = await wbDocumentsFetch(`/documents/list?${params.toString()}`);
  const data = (await res.json()) as { data?: { documents?: WbDocumentListItem[] } };
  return Array.isArray(data.data?.documents) ? data.data.documents : [];
}

export async function downloadWbDocument(serviceName: string, extension: string): Promise<DownloadedDocumentFile> {
  const params = new URLSearchParams({ serviceName, extension });
  const res = await wbDocumentsFetch(`/documents/download?${params.toString()}`, {
    headers: { accept: "*/*" },
  });

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const disposition = res.headers.get("content-disposition") || "";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(buffer.toString("utf-8")) as {
      data?: { fileName?: string; extension?: string; document?: string };
    };
    const payload = parsed.data;
    if (!payload?.document) throw new Error("WB document response has no file payload");
    const actualExtension = payload.extension || extension;
    return {
      buffer: Buffer.from(payload.document, "base64"),
      contentType: contentTypeByExtension(actualExtension),
      fileName: safeDownloadFileName(payload.fileName || serviceName, actualExtension),
      extension: actualExtension,
    };
  }

  return {
    buffer,
    contentType,
    fileName: safeDownloadFileName(extractDispositionFileName(disposition) || `${serviceName}.${extension}`, extension),
    extension,
  };
}

export async function downloadWbSupplyActFromSellerPortal(supplyID: number): Promise<DownloadedDocumentFile> {
  const tokens = loadTokens();
  if (!tokens) throw new Error("WB seller session is not authorized");

  const res = await fetch(`${SELLER_SUPPLY_API}/supply/act`, {
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
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new WbDocumentsApiError(text || `WB seller supply API HTTP ${res.status}`, res.status);
  }

  const parsed = JSON.parse(text) as {
    error?: { message?: string; data?: unknown };
    result?: { act?: string; extension?: string; isForming?: boolean };
  };
  if (parsed.error) {
    throw new Error(parsed.error.message || "WB seller supply API returned an error");
  }
  if (parsed.result?.isForming) {
    throw new Error("WB seller supply act is still forming");
  }
  if (!parsed.result?.act) {
    throw new Error("WB seller supply act response has no file payload");
  }

  const extension = parsed.result.extension || "zip";
  return {
    buffer: Buffer.from(parsed.result.act, "base64"),
    contentType: contentTypeByExtension(extension),
    fileName: safeDownloadFileName(`act-income-${supplyID}`, extension),
    extension,
  };
}

export async function downloadWbSupplyReconciliationFromSellerPortal(supplyID: number): Promise<DownloadedDocumentFile> {
  const tokens = loadTokens();
  if (!tokens) throw new Error("WB seller session is not authorized");

  const res = await fetch(`${SELLER_SUPPLY_API}/supply/boxBarcodeIncongruityReport`, {
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
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new WbDocumentsApiError(text || `WB seller supply API HTTP ${res.status}`, res.status);
  }

  const parsed = JSON.parse(text) as {
    error?: { message?: string; data?: unknown };
    result?: { file?: string; mime?: string };
  };
  if (parsed.error) {
    throw new Error(parsed.error.message || "WB seller supply API returned an error");
  }
  if (!parsed.result?.file) {
    throw new Error("WB seller supply reconciliation response has no file payload");
  }

  const contentType = parsed.result.mime || contentTypeByExtension("xlsx");
  return {
    buffer: Buffer.from(parsed.result.file, "base64"),
    contentType,
    fileName: safeDownloadFileName(`box-barcode-incongruity-${supplyID}`, extensionByContentType(contentType)),
    extension: extensionByContentType(contentType),
  };
}

function contentTypeByExtension(extension: string): string {
  if (/xlsx/i.test(extension)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/zip/i.test(extension)) return "application/zip";
  if (/csv/i.test(extension)) return "text/csv; charset=utf-8";
  if (/xml/i.test(extension)) return "application/xml";
  return "application/octet-stream";
}

function extensionByContentType(contentType: string): string {
  if (/spreadsheetml|excel|xlsx/i.test(contentType)) return "xlsx";
  if (/zip/i.test(contentType)) return "zip";
  if (/csv/i.test(contentType)) return "csv";
  if (/xml/i.test(contentType)) return "xml";
  return "bin";
}

function extractDispositionFileName(disposition: string): string | null {
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1]);
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function safeDownloadFileName(fileName: string, extension: string): string {
  const clean = path.basename(fileName).replace(/[^\wа-яА-ЯёЁ .()#-]+/g, "_").trim();
  if (!clean) return `document.${extension}`;
  return clean.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? clean : `${clean}.${extension}`;
}

export function ensureSupplyDocumentsDir(supplyID: number): string {
  const root = path.resolve(getOrganizationDataDir(), "supply-documents");
  const dir = path.resolve(root, String(supplyID));
  if (!dir.startsWith(root + path.sep)) throw new Error("Unsafe supply documents path");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
