/**
 * WB Seller Auth — pure HTTP, no browser.
 * Replicates the auth flow via direct API calls to seller-auth.wildberries.ru.
 */
import fs from "fs";
import path from "path";
import { saveAuthTokensCommon, checkApiSession } from "./wb-seller-api";

const DATA_DIR = path.join(process.cwd(), "data");
const AUTH_LOG_PATH = path.join(DATA_DIR, "wb-auth-log.json");

// Session state (survives hot-reload)
const g = globalThis as unknown as {
  __wbAuthCookies?: Record<string, string>;
  __wbAuthToken?: string;
  __wbAuthLog?: Array<Record<string, unknown>>;
};

function getCookies(): Record<string, string> {
  if (!g.__wbAuthCookies) g.__wbAuthCookies = {};
  return g.__wbAuthCookies;
}

function getAuthLog(): Array<Record<string, unknown>> {
  if (!g.__wbAuthLog) g.__wbAuthLog = [];
  return g.__wbAuthLog;
}

function cookieHeader(): string {
  return Object.entries(getCookies()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function parseCookies(resp: Response): void {
  const cookies = getCookies();
  for (const header of resp.headers.getSetCookie?.() || []) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) cookies[match[1]] = match[2];
  }
}

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "Origin": "https://seller-auth.wildberries.ru",
  "Referer": "https://seller-auth.wildberries.ru/",
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

async function doRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; data: unknown; resp: Response }> {
  const headers: Record<string, string> = {
    ...COMMON_HEADERS,
    "Cookie": cookieHeader(),
  };
  if (body) headers["Content-Type"] = "application/json";

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  parseCookies(resp);

  let data: unknown;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("json")) {
    data = await resp.json().catch(() => null);
  } else {
    data = await resp.text().catch(() => "");
  }

  // Log
  const log = getAuthLog();
  log.push({
    timestamp: new Date().toISOString(),
    method,
    url,
    requestBody: body,
    responseStatus: resp.status,
    responseBody: data,
    cookies: { ...getCookies() },
  });

  // Save log
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_LOG_PATH, JSON.stringify(log, null, 2));

  console.log(`[wb-auth-http] [${resp.status}] ${method} ${url}`);
  return { status: resp.status, data, resp };
}

export type AuthHttpResult = {
  ok: boolean;
  step: "code" | "captcha" | "authenticated" | "error";
  captchaImage?: string;
  captchaUrl?: string;
  error?: string;
  debug?: unknown;
};

// --- Step 1: Send phone ---

export async function httpSendPhone(phone: string): Promise<AuthHttpResult> {
  // Reset state
  g.__wbAuthCookies = {};
  g.__wbAuthLog = [];
  g.__wbAuthToken = "";

  // Clean phone
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  const phoneFormatted = "+" + digits;

  // Load auth page for initial cookies
  await doRequest("GET", "https://seller-auth.wildberries.ru/");

  // Step 1: Request SMS code via /auth/v2/code/wb
  const codeEndpoints = [
    "https://seller-auth.wildberries.ru/auth/v2/code/wb",
    "https://seller-auth.wildberries.ru/auth/v2/code/wb-captcha",
  ];

  for (const url of codeEndpoints) {
    const { status, data } = await doRequest("POST", url, { phone: phoneFormatted });

    if (status === 404 || status === 405) continue;

    const d = data as Record<string, unknown> | null;

    // Rate limit
    if (status === 429) {
      return { ok: false, step: "error", error: "WB: слишком много попыток. Попробуйте позже.", debug: d };
    }

    if (d) {
      const bodyStr = JSON.stringify(d);

      // Save token for next step
      const token = (d.token || "") as string;
      if (token) g.__wbAuthToken = token;

      // Rate limit in body
      if (bodyStr.includes("Запрос кода возможен") || bodyStr.includes("too many") || (d.result as number) === 30) {
        const retryAfter = (d.retry_after || d.retryAfter || "") as string;
        return {
          ok: false,
          step: "error",
          error: retryAfter
            ? `WB заблокировал отправку кода. Повтор через ${retryAfter}`
            : "WB заблокировал отправку кода. Попробуйте позже.",
          debug: d,
        };
      }

      // Captcha required
      if (bodyStr.toLowerCase().includes("captcha")) {
        const captchaImg = (d.captcha_image || d.captchaImage || "") as string;
        const captchaUrl = (d.captcha_url || d.captchaUrl || "") as string;
        return {
          ok: true,
          step: "captcha",
          captchaImage: captchaImg,
          captchaUrl: captchaUrl,
          debug: d,
        };
      }

      // Success — SMS sent
      if (status >= 200 && status < 300) {
        return { ok: true, step: "code", debug: d };
      }
    }

    return { ok: false, step: "error", error: `WB API ${url}: ${status}`, debug: d };
  }

  return {
    ok: false,
    step: "error",
    error: "Все эндпоинты WB для запроса кода вернули 404. Проверьте data/wb-auth-log.json",
  };
}

// --- Step 2: Submit captcha ---

export async function httpSubmitCaptcha(captchaText: string): Promise<AuthHttpResult> {
  const token = g.__wbAuthToken || "";

  // slide-v3-confirm for slide captcha, slide-v3 for initial
  const endpoints = [
    {
      url: "https://seller-auth.wildberries.ru/auth/v2/auth/slide-v3-confirm",
      body: { token, captchaCode: captchaText },
    },
    {
      url: "https://seller-auth.wildberries.ru/auth/v2/auth/slide-v3",
      body: { token, captchaCode: captchaText },
    },
  ];

  for (const ep of endpoints) {
    const { status, data } = await doRequest("POST", ep.url, ep.body);
    if (status === 404 || status === 405) continue;

    const d = data as Record<string, unknown> | null;
    if (d) {
      const newToken = (d.token || "") as string;
      if (newToken) g.__wbAuthToken = newToken;

      const bodyStr = JSON.stringify(d).toLowerCase();
      if (bodyStr.includes("captcha")) {
        const captchaImg = (d.captcha_image || d.captchaImage || "") as string;
        return { ok: true, step: "captcha", captchaImage: captchaImg, debug: d };
      }

      return { ok: true, step: "code", debug: d };
    }
  }

  return { ok: false, step: "error", error: "Captcha endpoints failed" };
}

// --- Step 3: Submit SMS code ---

export async function httpSubmitCode(code: string): Promise<AuthHttpResult> {
  const token = g.__wbAuthToken || "";
  const cleanCode = code.replace(/\D/g, "");

  // /auth/v2/auth — confirm code (same endpoint, but now with token + code)
  const endpoints = [
    {
      url: "https://seller-auth.wildberries.ru/auth/v2/auth",
      body: { token, options: { notify_code: cleanCode } },
    },
    {
      url: "https://seller-auth.wildberries.ru/auth/v2/auth",
      body: { token, code: cleanCode },
    },
  ];

  for (const ep of endpoints) {
    const { status, data, resp } = await doRequest("POST", ep.url, ep.body);
    if (status === 404 || status === 405) continue;

    const d = data as Record<string, unknown> | null;

    // Check cookies for auth tokens
    const cookies = getCookies();
    const authToken = cookies["WBTokenV3"] || cookies["wbx-validation-key"] || "";

    if (status >= 200 && status < 400) {
      // Extract token from response
      let capturedToken = authToken;
      if (d) {
        capturedToken = capturedToken || (d.token || d.access_token || "") as string;
      }

      if (capturedToken) {
        // Save tokens
        await saveAuthTokens(capturedToken);
        return { ok: true, step: "authenticated", debug: d };
      }

      // Maybe need captcha after code?
      if (d && JSON.stringify(d).toLowerCase().includes("captcha")) {
        return { ok: true, step: "captcha", debug: d };
      }

      // Got 200 but no token — still try to save what we have
      if (d) {
        return { ok: true, step: "authenticated", debug: d };
      }
    }

    return { ok: false, step: "error", error: `WB API ${ep.url}: ${status}`, debug: d };
  }

  return { ok: false, step: "error", error: "Все эндпоинты для кода вернули 404" };
}

// --- Token extraction ---

async function saveAuthTokens(authToken: string): Promise<void> {
  const cookies = getCookies();
  const cookieParts: string[] = [];
  for (const name of ["wbx-validation-key", "x-supplier-id-external"]) {
    if (cookies[name]) cookieParts.push(`${name}=${cookies[name]}`);
  }

  await saveAuthTokensCommon(authToken, cookieParts.join("; "), "wb-auth-http");
}

// --- Session check ---

export async function httpCheckSession(): Promise<{ ok: boolean; error?: string }> {
  return checkApiSession();
}

// --- Logout ---

export function httpLogout(): void {
  g.__wbAuthCookies = {};
  g.__wbAuthToken = "";
  g.__wbAuthLog = [];
  const tokensPath = path.join(DATA_DIR, "wb-tokens.json");
  if (fs.existsSync(tokensPath)) fs.unlinkSync(tokensPath);
  const cookiesPath = path.join(DATA_DIR, "wb-cookies.json");
  if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
}
