/**
 * WB Seller Portal API client — pure HTTP, no browser.
 * Uses authorizev3 + wb-seller-lk tokens extracted after Puppeteer login.
 */
import fs from "fs";
import path from "path";

const TOKEN_PATH = path.join(process.cwd(), "data", "wb-tokens.json");
const DATA_DIR = path.join(process.cwd(), "data");
const REPORTS_DIR = path.join(DATA_DIR, "reports");

// --- Token storage ---

export interface WbTokens {
  authorizev3: string;
  wbSellerLk: string;
  wbSellerLkExpires: number; // unix timestamp (seconds)
  supplierId: string;
  supplierUuid: string;
  /** Cookie string: "wbx-validation-key=...; x-supplier-id-external=..." */
  cookies: string;
  savedAt: string;
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

export function saveTokens(tokens: WbTokens): void {
  ensureDirs();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

/**
 * Common token save + refresh logic (shared by CDP and HTTP auth flows).
 * Accepts pre-extracted cookie string.
 */
export async function saveAuthTokensCommon(authToken: string, cookieString: string, label: string): Promise<void> {
  const baseTokens: WbTokens = {
    authorizev3: authToken,
    wbSellerLk: "",
    wbSellerLkExpires: 0,
    supplierId: "",
    supplierUuid: "",
    cookies: cookieString,
    savedAt: new Date().toISOString(),
  };
  saveTokens(baseTokens);

  const refreshed = await refreshSellerToken(authToken);
  if (refreshed) {
    saveTokens({
      ...baseTokens,
      wbSellerLk: refreshed.wbSellerLk,
      wbSellerLkExpires: refreshed.wbSellerLkExpires,
      supplierId: refreshed.supplierId,
      supplierUuid: refreshed.supplierUuid,
    });
    console.log(`[${label}] Tokens saved. Supplier:`, refreshed.supplierId);
  } else {
    console.warn(`[${label}] Could not refresh wb-seller-lk`);
  }
}

export function loadTokens(): WbTokens | null {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")) as WbTokens;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

// --- JWT decode (no verification — just parse payload) ---

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// --- Token refresh ---

/**
 * Refresh the short-lived wb-seller-lk token using authorizev3.
 */
export async function refreshSellerToken(authorizev3: string): Promise<{
  wbSellerLk: string;
  wbSellerLkExpires: number;
  supplierId: string;
  supplierUuid: string;
} | null> {
  try {
    const tokens = loadTokens();
    const res = await fetch(
      "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorizev3,
          cookie: tokens?.cookies || "",
          origin: "https://seller.wildberries.ru",
          referer: "https://seller.wildberries.ru/",
        },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { result?: { data?: { token?: string }; token?: string } };
    const token = data?.result?.data?.token || data?.result?.token;
    if (!token) return null;

    const payload = decodeJwtPayload(token);
    const exp = (payload?.exp as number) || Math.floor(Date.now() / 1000) + 300;
    const supplierData = payload?.data as Record<string, string> | undefined;
    const supplierUuid = supplierData?.["Z-Sid"] || "";
    const supplierId = supplierData?.["Z-Sfid"] || supplierData?.["Z-Soid"] || "";

    return { wbSellerLk: token, wbSellerLkExpires: exp, supplierId, supplierUuid };
  } catch (err) {
    console.error("[wb-seller-api] refreshSellerToken error:", err);
    return null;
  }
}

/**
 * Get valid tokens — refreshes wb-seller-lk if expired.
 */
export async function getValidTokens(): Promise<WbTokens | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokens.wbSellerLkExpires - now < 30) {
    const refreshed = await refreshSellerToken(tokens.authorizev3);
    if (!refreshed) return null;

    tokens.wbSellerLk = refreshed.wbSellerLk;
    tokens.wbSellerLkExpires = refreshed.wbSellerLkExpires;
    tokens.supplierId = refreshed.supplierId || tokens.supplierId;
    tokens.supplierUuid = refreshed.supplierUuid || tokens.supplierUuid;
    saveTokens(tokens);
  }

  return tokens;
}

// --- API helpers ---

function apiHeaders(tokens: WbTokens): Record<string, string> {
  return {
    authorizev3: tokens.authorizev3,
    "wb-seller-lk": tokens.wbSellerLk,
    cookie: tokens.cookies || "",
    "content-type": "application/json",
    accept: "application/json",
    origin: "https://seller.wildberries.ru",
    referer: "https://seller.wildberries.ru/",
  };
}

// --- Reports API ---

export interface WeeklyReport {
  id: number;
  realizationreport_id: number;
  dateFrom: string;
  dateTo: string;
  create_dt: string;
  [key: string]: unknown;
}

/**
 * Get list of weekly realization reports.
 */
export async function getWeeklyReports(opts?: {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  skip?: number;
}): Promise<{ ok: boolean; reports?: WeeklyReport[]; total?: number; error?: string }> {
  const tokens = await getValidTokens();
  if (!tokens) return { ok: false, error: "Нет токенов авторизации" };

  try {
    const params = new URLSearchParams({
      dateFrom: opts?.dateFrom || "",
      dateTo: opts?.dateTo || "",
      limit: String(opts?.limit || 15),
      skip: String(opts?.skip || 0),
      searchBy: "",
      type: "6",
    });

    const res = await fetch(
      `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports-weekly?${params}`,
      { headers: apiHeaders(tokens) }
    );

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Токен авторизации истёк" };
    }

    if (!res.ok) {
      return { ok: false, error: `API error: ${res.status} ${res.statusText}` };
    }

    const data = (await res.json()) as { data?: { reports?: WeeklyReport[]; total?: number } };
    return { ok: true, reports: data?.data?.reports || [], total: data?.data?.total || 0 };
  } catch (err) {
    return { ok: false, error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Download a specific report by ID.
 */
export async function downloadReportById(reportId: number): Promise<{
  ok: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}> {
  const tokens = await getValidTokens();
  if (!tokens) return { ok: false, error: "Нет токенов авторизации" };

  ensureDirs();

  try {
    const url = `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports/${reportId}/details/archived-excel?format=binary`;
    const res = await fetch(url, { headers: apiHeaders(tokens) });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `Download error ${res.status}: ${errText.slice(0, 200)}` };
    }

    return await saveReportResponse(res, reportId);
  } catch (err) {
    return { ok: false, error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

async function saveReportResponse(
  res: Response,
  reportId: number
): Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }> {
  const disposition = res.headers.get("content-disposition") || "";
  let fileName = `report-${reportId}.xlsx`;
  const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
  if (match) fileName = decodeURIComponent(match[1]);

  const buffer = Buffer.from(await res.arrayBuffer());
  const filePath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  return { ok: true, filePath, fileName };
}

/**
 * Quick API session check — uses lightweight request.
 */
export async function checkApiSession(): Promise<{ ok: boolean; error?: string }> {
  const tokens = await getValidTokens();
  if (!tokens) return { ok: false, error: "Нет токенов авторизации" };

  try {
    const res = await fetch(
      "https://seller.wildberries.ru/ns/suppliers/suppliers-portal-core/suppliers",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorizev3: tokens.authorizev3,
          cookie: tokens.cookies || "",
          origin: "https://seller.wildberries.ru",
          referer: "https://seller.wildberries.ru/",
        },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
      }
    );

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Токен авторизации истёк" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
