/**
 * WB Seller Auth — CDP-based approach.
 * Opens headless browser, lets F.A.C.C.T. antibot generate captcha_token,
 * then makes direct fetch() calls from inside the page.
 * No DOM manipulation, no InputCell, no button clicks.
 */
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "path";
import fs from "fs";
import { saveAuthTokensCommon, checkApiSession } from "./wb-seller-api";

const DATA_DIR = path.join(process.cwd(), "data");
const SELLER_AUTH_URL = "https://seller-auth.wildberries.ru/";

// Singleton (survives hot-reload)
const g = globalThis as unknown as {
  __wbCdpBrowser?: Browser | null;
  __wbCdpPage?: Page | null;
  __wbCdpSticker?: string;
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function getBrowser(): Promise<Browser> {
  const existing = g.__wbCdpBrowser;
  if (existing && existing.connected) return existing;
  const browser = await puppeteer.launch({
    headless: "new" as unknown as boolean,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
    ],
  });
  g.__wbCdpBrowser = browser;
  return browser;
}

async function getPage(): Promise<Page> {
  const browser = await getBrowser();
  const existing = g.__wbCdpPage;
  if (existing && !existing.isClosed()) return existing;
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  g.__wbCdpPage = page;
  return page;
}

async function closeBrowser() {
  const pg = g.__wbCdpPage;
  if (pg && !pg.isClosed()) { await pg.close().catch(() => {}); g.__wbCdpPage = null; }
  const br = g.__wbCdpBrowser;
  if (br && br.connected) { await br.close().catch(() => {}); g.__wbCdpBrowser = null; }
}

// --- Types ---

export type AuthStepResult = {
  ok: boolean;
  step: "code" | "captcha" | "authenticated" | "error";
  captchaImage?: string;
  error?: string;
  warning?: string;
  debug?: unknown;
};

// --- Step 1: Send phone ---

export async function cdpSendPhone(phone: string): Promise<AuthStepResult> {
  try {
    // Clean phone: +79991234567 → 79991234567
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
    if (!digits.startsWith("7")) digits = "7" + digits;

    const page = await getPage();

    // Load WB auth page — this triggers F.A.C.C.T. antibot SDK
    console.log("[wb-auth-cdp] Loading auth page...");
    await page.goto(SELLER_AUTH_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for antibot SDK to initialize
    console.log("[wb-auth-cdp] Waiting for antibot SDK...");
    await page.waitForFunction(() => {
      return typeof (window as unknown as Record<string, unknown>).gib !== "undefined";
    }, { timeout: 15000 }).catch(() => {
      console.warn("[wb-auth-cdp] Antibot SDK (window.gib) not found");
    });

    // Extra wait for SDK to fully initialize
    await new Promise(r => setTimeout(r, 3000));

    // Intercept the captcha_token from outgoing requests via CDP
    const client = await page.createCDPSession();
    await client.send("Network.enable");

    let interceptedCaptchaToken = "";
    const tokenPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(""), 30000);
      client.on("Network.requestWillBeSent", (params: { request: { url: string; postData?: string } }) => {
        if (params.request.url.includes("/code/wb-captcha") && params.request.postData) {
          try {
            const body = JSON.parse(params.request.postData);
            if (body.captcha_token && body.captcha_token.length > 10) {
              clearTimeout(timeout);
              resolve(body.captcha_token);
            }
          } catch {}
        }
      });
    });

    // Now interact with the page — type phone and submit via the real UI
    // This lets the antibot SDK generate the token naturally
    console.log("[wb-auth-cdp] Entering phone via page UI...");

    // Wait for phone input
    const phoneSelector = 'input[class*="SimpleInput"], input[inputmode="numeric"], input[placeholder*="999"]';
    await page.waitForSelector(phoneSelector, { timeout: 15000 });
    const phoneInput = await page.$(phoneSelector);
    if (!phoneInput) {
      await client.send("Network.disable");
      await client.detach();
      return { ok: false, step: "error", error: "Не найдено поле ввода телефона" };
    }

    // WB already has +7 prefix — type only 10 digits
    let phoneDigits = digits;
    if (phoneDigits.startsWith("7") && phoneDigits.length === 11) phoneDigits = phoneDigits.slice(1);

    await phoneInput.click({ clickCount: 3 });
    await phoneInput.type(phoneDigits, { delay: 80 });
    await new Promise(r => setTimeout(r, 500));

    // Click submit button
    const btn = await page.$('button[type="submit"]');
    if (btn) {
      await btn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for the antibot to generate token and WB to send the request
    console.log("[wb-auth-cdp] Waiting for captcha_token from antibot...");
    interceptedCaptchaToken = await tokenPromise;
    console.log("[wb-auth-cdp] Captcha token intercepted:", interceptedCaptchaToken ? interceptedCaptchaToken.slice(0, 50) + "..." : "empty");

    await client.send("Network.disable");
    await client.detach();

    // Now wait for the page to react — check what appeared
    await new Promise(r => setTimeout(r, 3000));

    // Check page state
    const result = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const rateLimitMatch = bodyText.match(/Запрос кода возможен через\s+(.+)/i);
      if (rateLimitMatch) return { type: "ratelimit", text: rateLimitMatch[1].trim().split("\n")[0] };
      if (bodyText.includes("Введите код") || bodyText.includes("код из СМС")) return { type: "code" };
      if (bodyText.toLowerCase().includes("captcha")) return { type: "captcha" };
      return { type: "unknown", text: bodyText.slice(0, 200) };
    });

    console.log("[wb-auth-cdp] Page state:", result.type);

    if (result.type === "ratelimit") {
      await closeBrowser();
      return { ok: false, step: "error", error: `WB заблокировал отправку кода. Повтор через ${result.text}` };
    }

    if (result.type === "code") {
      return { ok: true, step: "code" };
    }

    if (result.type === "captcha") {
      // Slide captcha appeared — it's interactive, user can't solve it from our UI
      return { ok: false, step: "error", error: "WB показал slide-капчу. Попробуйте ещё раз." };
    }

    // Unknown state
    return { ok: true, step: "code", debug: result };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 2: Submit captcha ---

export async function cdpSubmitCaptcha(captchaText: string): Promise<AuthStepResult> {
  try {
    const page = await getPage();

    const result = await page.evaluate(async (code: string) => {
      const res = await fetch("/auth/v2/auth/slide-v3-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "wb-apptype": "web",
          "wb-appversion": "v1.91.0",
          "app-name": "seller.seller-auth",
          "locale": "ru",
        },
        credentials: "include",
        body: JSON.stringify({ captchaCode: code }),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    }, captchaText);

    const d = result.data as Record<string, unknown> | null;
    if (d?.sticker) g.__wbCdpSticker = d.sticker as string;

    if (d && (d.result as number) === 0) {
      return { ok: true, step: "code", debug: d };
    }

    return { ok: false, step: "error", error: `Captcha error: ${JSON.stringify(d)}`, debug: d };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка капчи: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 3: Submit SMS code ---

export async function cdpSubmitCode(code: string): Promise<AuthStepResult> {
  try {
    const page = await getPage();
    const digits = code.replace(/\D/g, "");

    // Check page is on WB
    const currentUrl = page.url();
    if (!currentUrl.includes("wildberries")) {
      await closeBrowser();
      return { ok: false, step: "error", error: "Сессия браузера потеряна. Нажмите «Назад» и введите номер заново." };
    }

    console.log("[wb-auth-cdp] Entering SMS code via page UI...");

    // Set up CDP to intercept the auth response
    const client = await page.createCDPSession();
    await client.send("Network.enable");

    let authToken = "";
    const tokenPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(""), 25000);
      client.on("Network.responseReceived", async (params: { requestId: string; response: { url: string; status: number } }) => {
        if (params.response.url.includes("/auth/v2/auth") && !params.response.url.includes("slide") && !params.response.url.includes("upgrade")) {
          try {
            const { body } = await client.send("Network.getResponseBody", { requestId: params.requestId });
            const data = JSON.parse(body);
            console.log("[wb-auth-cdp] Auth response:", JSON.stringify(data));
            if (data.result === 0 && data.payload?.access_token) {
              clearTimeout(timeout);
              resolve(data.payload.access_token);
            } else if (data.result === 17) {
              clearTimeout(timeout);
              resolve("INCORRECT_CODE");
            } else if (data.result === 8) {
              clearTimeout(timeout);
              resolve("EXPIRED_TOKEN");
            }
          } catch {}
        }
      });
    });

    // Find code input cells and type digits
    await new Promise(r => setTimeout(r, 1000));
    let codeCells = await page.$$('input[class*="InputCell"]');
    if (codeCells.length < 4) {
      const allNumeric = await page.$$('input[inputmode="numeric"]');
      const filtered = [];
      for (const el of allNumeric) {
        const isPhoneField = await el.evaluate(e =>
          e.placeholder.includes("999") || e.className.includes("SimpleInput")
        );
        if (!isPhoneField) filtered.push(el);
      }
      if (filtered.length >= 4) codeCells = filtered;
    }

    if (codeCells.length >= 4) {
      for (let i = 0; i < Math.min(digits.length, codeCells.length); i++) {
        await codeCells[i].click();
        await codeCells[i].type(digits[i], { delay: 50 });
      }
    } else {
      await client.send("Network.disable");
      await client.detach();
      return { ok: false, step: "error", error: "Не найдены поля ввода кода" };
    }

    // Wait for auth response
    console.log("[wb-auth-cdp] Waiting for auth response...");
    authToken = await tokenPromise;

    await client.send("Network.disable");
    await client.detach();

    if (authToken === "INCORRECT_CODE") {
      return { ok: false, step: "error", error: "Неверный SMS-код" };
    }

    if (authToken === "EXPIRED_TOKEN") {
      return { ok: false, step: "error", error: "Токен истёк. Запросите код заново." };
    }

    if (authToken && authToken.length > 50) {
      await saveAuthTokens(page, authToken);
      await closeBrowser();
      const mismatch = checkSupplierMismatch();
      return {
        ok: true,
        step: "authenticated",
        warning: mismatch || undefined,
      };
    }

    // Fallback: check URL — maybe already redirected to seller
    await new Promise(r => setTimeout(r, 3000));
    const url = page.url();
    if (url.includes("seller.wildberries.ru") && !url.includes("seller-auth")) {
      // Capture token from page
      const cookies = await page.cookies();
      const wbToken = cookies.find(c => c.name === "WBTokenV3");
      if (wbToken) {
        await saveAuthTokens(page, wbToken.value);
        await closeBrowser();
        return { ok: true, step: "authenticated" };
      }
    }

    return { ok: false, step: "error", error: "Не удалось получить токен авторизации" };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка кода: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Supplier mismatch check ---

function checkSupplierMismatch(): string | null {
  try {
    const apiKeyPath = path.join(process.cwd(), "data", "wb-api-key.txt");
    if (!fs.existsSync(apiKeyPath)) return null;
    const apiKey = fs.readFileSync(apiKeyPath, "utf-8").trim();
    if (!apiKey) return null;

    // Decode API key JWT → oid
    const apiPayload = JSON.parse(Buffer.from(apiKey.split(".")[1], "base64").toString());
    const apiOid = String(apiPayload.oid || "");

    // Read saved tokens → supplierId
    const tokensPath = path.join(DATA_DIR, "wb-tokens.json");
    if (!fs.existsSync(tokensPath)) return null;
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    const tokenSid = String(tokens.supplierId || "");

    if (apiOid && tokenSid && apiOid !== tokenSid) {
      console.warn(`[wb-auth-cdp] SUPPLIER MISMATCH! API key: ${apiOid}, Token: ${tokenSid}`);
      return `Внимание: API-ключ привязан к кабинету ${apiOid}, а авторизация — к кабинету ${tokenSid}. Финансовые отчёты будут от другого юрлица.`;
    }
    return null;
  } catch {
    return null;
  }
}

// --- Token extraction ---

async function saveAuthTokens(page: Page, authToken: string): Promise<void> {
  ensureDirs();

  // Navigate to seller portal to establish all cookies
  console.log("[wb-auth-cdp] Navigating to seller portal to get cookies...");
  await page.goto("https://seller.wildberries.ru/", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // Get all cookies via CDP (includes cross-domain)
  const client = await page.createCDPSession();
  const { cookies } = await client.send("Network.getAllCookies") as {
    cookies: Array<{ name: string; value: string; domain: string }>;
  };
  await client.detach();

  console.log("[wb-auth-cdp] Total cookies:", cookies.length);
  const cookieParts: string[] = [];
  for (const c of cookies) {
    if (c.name === "wbx-validation-key" || c.name === "x-supplier-id-external") {
      cookieParts.push(`${c.name}=${c.value}`);
      console.log(`[wb-auth-cdp] Cookie: ${c.name}=${c.value.slice(0, 20)}...`);
    }
  }

  await saveAuthTokensCommon(authToken, cookieParts.join("; "), "wb-auth-cdp");
}

// --- Session check ---

export async function cdpCheckSession(): Promise<{ ok: boolean; error?: string }> {
  return checkApiSession();
}

// --- Logout ---

export function cdpLogout(): void {
  g.__wbCdpSticker = "";
  closeBrowser().catch(() => {});
  const tokensPath = path.join(DATA_DIR, "wb-tokens.json");
  if (fs.existsSync(tokensPath)) fs.unlinkSync(tokensPath);
  const cookiesPath = path.join(DATA_DIR, "wb-cookies.json");
  if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
}
