import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "path";
import fs from "fs";
import { saveTokens, refreshSellerToken, checkApiSession as checkApi, type WbTokens } from "./wb-seller-api";

// --- Constants ---
const SELLER_AUTH_URL = "https://seller-auth.wildberries.ru";
const SELLER_URL = "https://seller.wildberries.ru";
const REPORT_URL = "https://seller.wildberries.ru/suppliers-mutual-settlements/reports-implementations/reports-weekly-new";
const COOKIES_PATH = path.join(process.cwd(), "data", "wb-cookies.json");
const DOWNLOADS_DIR = path.join(process.cwd(), "data", "reports");

// --- Singleton browser (survives Next.js hot-reload via globalThis) ---
const g = globalThis as unknown as { __wbBrowser?: Browser | null; __wbPage?: Page | null };
function getBrowserInstance() { return g.__wbBrowser ?? null; }
function setBrowserInstance(b: Browser | null) { g.__wbBrowser = b; }
function getPageInstance() { return g.__wbPage ?? null; }
function setPageInstance(p: Page | null) { g.__wbPage = p; }

function ensureDirs() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

async function getBrowser(): Promise<Browser> {
  const existing = getBrowserInstance();
  if (existing && existing.connected) return existing;
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
    ],
  });
  setBrowserInstance(browser);
  return browser;
}

async function getPage(): Promise<Page> {
  const browser = await getBrowser();
  const existing = getPageInstance();
  if (existing && !existing.isClosed()) return existing;
  // Reuse the default about:blank tab instead of creating a new one
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Remove webdriver flag to avoid bot detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  setPageInstance(page);
  return page;
}

// --- Cookie management (via CDP to capture ALL domains) ---

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: string;
  priority?: string;
  sameParty?: boolean;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: string;
}

const COOKIES_META_PATH = path.join(process.cwd(), "data", "wb-cookies-meta.json");

/** Save all cookies from all domains via CDP */
async function saveAllCookies(page: Page): Promise<void> {
  ensureDirs();
  const client = await page.createCDPSession();
  const { cookies } = await client.send("Network.getAllCookies") as { cookies: CdpCookie[] };
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  fs.writeFileSync(COOKIES_META_PATH, JSON.stringify({ savedAt: new Date().toISOString() }));
  await client.detach();
}

function loadCookiesRaw(): CdpCookie[] | null {
  if (!fs.existsSync(COOKIES_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8")) as CdpCookie[];
  } catch {
    return null;
  }
}

export function clearCookies(): void {
  if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
  const tokensPath = path.join(process.cwd(), "data", "wb-tokens.json");
  if (fs.existsSync(tokensPath)) fs.unlinkSync(tokensPath);
}

/** Restore all cookies via CDP (supports cross-domain) */
async function restoreCookies(page: Page): Promise<boolean> {
  const cookies = loadCookiesRaw();
  if (!cookies || cookies.length === 0) return false;
  const client = await page.createCDPSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.send("Network.setCookies", { cookies: cookies as any });
  await client.detach();
  return true;
}

// --- Auth step results ---

export type AuthStep = "code" | "captcha" | "authenticated" | "error";

export interface AuthStepResult {
  ok: boolean;
  step: AuthStep;
  /** Base64 PNG of captcha image (when step === "captcha") */
  captchaImage?: string;
  error?: string;
}

// --- Token capture after login ---

/**
 * After successful login, navigate to seller portal and intercept
 * the authorizev3 header from outgoing requests via CDP.
 * Then refresh wb-seller-lk via API and save both tokens.
 */
async function captureAuthTokens(page: Page): Promise<void> {
  try {
    let authToken = "";

    const client = await page.createCDPSession();
    await client.send("Network.enable");

    // Listen for requests that carry the authorizev3 header
    const tokenPromise = new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve(""), 25000);
      client.on("Network.requestWillBeSent", (params: { request: { headers: Record<string, string>; url: string } }) => {
        const hdr = params.request.headers["authorizev3"] || params.request.headers["Authorizev3"] || params.request.headers["AuthorizeV3"];
        if (hdr && hdr.length > 50) {
          clearTimeout(timeout);
          resolve(hdr);
        }
      });
    });

    // Close any popups/modals/ads that WB shows after login
    async function dismissPopups() {
      await page.evaluate(() => {
        // Close modals by clicking overlay/close buttons
        const closeSelectors = [
          '[class*="close" i]', '[class*="Close"]', '[aria-label="close" i]',
          '[class*="modal"] button', '[class*="Modal"] button',
          '[class*="popup"] button', '[class*="Popup"] button',
          '[class*="overlay" i]', 'button[class*="dismiss" i]',
        ];
        for (const sel of closeSelectors) {
          const els = document.querySelectorAll(sel);
          els.forEach(el => { try { (el as HTMLElement).click(); } catch {} });
        }
        // Press Escape
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
    }

    // Navigate to a page that will trigger API calls with authorizev3
    const targetPages = [
      "https://seller.wildberries.ru/feedbacks-questions/feedbacks",
      "https://seller.wildberries.ru/analytics/orders-stats",
      "https://seller.wildberries.ru/",
    ];

    for (const targetUrl of targetPages) {
      await dismissPopups();
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      await dismissPopups();
      // Wait for XHR requests to fire
      await new Promise(r => setTimeout(r, 3000));
      authToken = await Promise.race([
        tokenPromise,
        new Promise<string>(r => setTimeout(() => r(""), 5000)),
      ]);
      if (authToken) break;
    }

    // Fallback: try extracting from localStorage/sessionStorage
    if (!authToken) {
      console.log("[wb-scraper] CDP intercept failed, trying localStorage...");
      authToken = await page.evaluate(() => {
        // WB stores token in various places
        for (const storage of [localStorage, sessionStorage]) {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key) continue;
            const val = storage.getItem(key) || "";
            if (val.startsWith("eyJ") && val.length > 100 && val.includes(".")) {
              try {
                const payload = JSON.parse(atob(val.split(".")[1]));
                if (payload.user || payload.client_id) return val;
              } catch { /* not JWT */ }
            }
          }
        }
        return "";
      }).catch(() => "");
    }

    await client.send("Network.disable");
    await client.detach();

    if (!authToken) {
      console.warn("[wb-scraper] Could not capture authorizev3 token via CDP or localStorage");
      // Save debug screenshot
      await page.screenshot({ path: path.join(process.cwd(), "data", "debug-token-capture.png"), fullPage: true }).catch(() => {});
      console.warn("[wb-scraper] Debug screenshot saved to data/debug-token-capture.png");
      console.warn("[wb-scraper] Current URL:", page.url());
      return;
    }

    console.log("[wb-scraper] Captured authorizev3 token, length:", authToken.length);

    // Extract cookies needed for API calls
    const cdpClient2 = await page.createCDPSession();
    const { cookies: allCookies } = await cdpClient2.send("Network.getAllCookies") as { cookies: CdpCookie[] };
    await cdpClient2.detach();

    const cookieParts: string[] = [];
    for (const c of allCookies) {
      if (c.name === "wbx-validation-key" || c.name === "x-supplier-id-external") {
        cookieParts.push(`${c.name}=${c.value}`);
      }
    }
    const cookieString = cookieParts.join("; ");
    console.log("[wb-scraper] Cookies for API:", cookieString.slice(0, 80));

    // Save partial tokens first (in case refresh fails)
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

    // Now refresh wb-seller-lk via API
    const refreshed = await refreshSellerToken(authToken);
    if (!refreshed) {
      console.warn("[wb-scraper] Could not refresh wb-seller-lk token (will retry later)");
      return;
    }

    saveTokens({
      ...baseTokens,
      wbSellerLk: refreshed.wbSellerLk,
      wbSellerLkExpires: refreshed.wbSellerLkExpires,
      supplierId: refreshed.supplierId,
      supplierUuid: refreshed.supplierUuid,
    });

    console.log("[wb-scraper] Tokens saved successfully. Supplier:", refreshed.supplierId);
  } catch (err) {
    console.error("[wb-scraper] captureAuthTokens error:", err);
  }
}

// --- Helpers to detect what appeared on screen ---

/**
 * After an action, detect what WB is showing us:
 * - captcha image → need user to solve it
 * - SMS code input → need user to enter code
 * - seller dashboard → already authenticated
 */
async function detectCurrentStep(page: Page): Promise<AuthStepResult> {
  // Poll the page for up to 60 seconds, checking every 2 seconds
  // WB SPA can take a while: spinner → timer → code fields
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const url = page.url();

    // Already on seller dashboard?
    if (url.startsWith(SELLER_URL) && !url.includes("seller-auth")) {
      await saveAllCookies(page);
      await captureAuthTokens(page);
      await closeBrowser();
      return { ok: true, step: "authenticated" };
    }

    const pageState = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";

      // Rate limit: "Запрос кода возможен через ..."
      const rateLimitMatch = bodyText.match(/Запрос кода возможен через\s+(.+)/i);
      const rateLimitText = rateLimitMatch ? rateLimitMatch[1].trim().split("\n")[0] : "";

      const hasCaptcha =
        !!document.querySelector('img[src*="captcha" i], [class*="captcha" i], [class*="Captcha"], iframe[src*="captcha"], iframe[src*="hcaptcha"]') ||
        bodyText.toLowerCase().includes("captcha");

      // WB SMS code: multiple approaches to detect code input
      const codeCells = document.querySelectorAll('input[class*="InputCell"]');
      const numericInputs = document.querySelectorAll('input[inputmode="numeric"]');
      const shortInputs = document.querySelectorAll('input[maxlength="1"], input[maxlength="2"]');
      const telInputs = document.querySelectorAll('input[type="tel"], input[type="number"]');
      const codeInputCount = Math.max(codeCells.length, numericInputs.length, shortInputs.length, telInputs.length);
      const hasSmsText = bodyText.includes("Введите код") || bodyText.includes("код из СМС") || bodyText.includes("Код подтверждения");

      return { hasCaptcha, codeCellCount: codeInputCount, hasSmsText, rateLimitText };
    });

    // Rate limited by WB
    if (pageState.rateLimitText) {
      return {
        ok: false,
        step: "error",
        error: `WB заблокировал отправку кода. Повторный запрос возможен через ${pageState.rateLimitText}`,
      };
    }

    // Captcha found
    if (pageState.hasCaptcha) {
      const pageShot = await page.screenshot({ encoding: "binary", fullPage: false }) as Buffer;
      return { ok: true, step: "captcha", captchaImage: pageShot.toString("base64") };
    }

    // SMS code fields appeared
    if (pageState.codeCellCount >= 4 || pageState.hasSmsText) {
      return { ok: true, step: "code" };
    }

    // Not ready yet — wait and re-check
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Timed out — save debug screenshot
  const debugShot = await page.screenshot({ encoding: "binary", fullPage: false }) as Buffer;
  ensureDirs();
  fs.writeFileSync(path.join(process.cwd(), "data", "debug-auth.png"), debugShot);

  return {
    ok: false,
    step: "error",
    error: "Таймаут ожидания. Скриншот: data/debug-auth.png",
  };
}

// --- Public API ---

/**
 * Step 1: Open WB auth page and submit phone number.
 * Returns what appeared next: captcha, code input, or error.
 */
export async function startAuth(phone: string): Promise<AuthStepResult> {
  try {
    const page = await getPage();
    await page.goto(SELLER_AUTH_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // WB renders via JS — wait for SPA to mount
    await new Promise((r) => setTimeout(r, 3000));

    // WB auth uses: input.SimpleInput with inputMode="numeric" and placeholder "999 999-99-99"
    // Also try generic selectors as fallback
    const phoneSelector =
      'input[class*="SimpleInput"], input[inputmode="numeric"], ' +
      'form[class*="PhoneInput"] input, input[placeholder*="999"]';
    await page.waitForSelector(phoneSelector, { timeout: 15000 });

    const phoneInput = await page.$(phoneSelector);
    if (!phoneInput) {
      return { ok: false, step: "error", error: "Не найдено поле ввода телефона" };
    }

    // WB already has +7 prefix — strip it from user input
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("7") && digits.length === 11) digits = digits.slice(1);
    if (digits.startsWith("8") && digits.length === 11) digits = digits.slice(1);

    // Clear and type only the 10-digit number (WB formats it automatically)
    await phoneInput.click({ clickCount: 3 });
    await phoneInput.type(digits, { delay: 80 });

    // Small delay for the submit button to become active
    await new Promise((r) => setTimeout(r, 500));

    // Submit — WB uses button[type="submit"] (icon button, no text)
    const btn = await page.$('button[type="submit"]');
    if (btn) {
      await btn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Detect what appeared
    return await detectCurrentStep(page);
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Submit captcha solution, then detect next step (code input or another captcha).
 */
export async function submitCaptcha(captchaText: string): Promise<AuthStepResult> {
  try {
    const page = await getPage();

    // Check that the browser is actually on the WB auth page
    const currentUrl = page.url();
    if (!currentUrl.includes("wildberries") && !currentUrl.includes("wb.ru")) {
      await closeBrowser();
      return { ok: false, step: "error", error: "Сессия браузера потеряна. Нажмите «Назад» и введите номер заново." };
    }

    // Find captcha input field
    const captchaInput = await page.$(
      'input[name*="captcha" i], input[placeholder*="капч" i], input[placeholder*="captcha" i], ' +
      'input[class*="captcha" i], input[aria-label*="captcha" i], ' +
      'input[placeholder*="код" i][type="text"]'
    );

    if (captchaInput) {
      await captchaInput.click({ clickCount: 3 });
      await captchaInput.type(captchaText, { delay: 50 });

      // Submit captcha
      const submitBtn = await page.$(
        'button[type="submit"], button[class*="submit" i], button[class*="Button" i]'
      );
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
    } else {
      // Maybe hCaptcha iframe — try typing into focused element
      await page.keyboard.type(captchaText);
      await page.keyboard.press("Enter");
    }

    return await detectCurrentStep(page);
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка капчи: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Submit SMS code, then detect if auth succeeded.
 */
export async function submitCode(code: string): Promise<AuthStepResult> {
  try {
    const page = await getPage();
    const digits = code.replace(/\D/g, "");

    // Check that the browser is actually on the WB auth page
    const currentUrl = page.url();
    if (!currentUrl.includes("wildberries") && !currentUrl.includes("wb.ru")) {
      await closeBrowser();
      return { ok: false, step: "error", error: "Сессия браузера потеряна. Нажмите «Назад» и введите номер заново." };
    }

    // Wait for SPA to render code fields
    await new Promise(r => setTimeout(r, 1500));

    // Enumerate ALL inputs on the page for flexible matching
    const inputInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      return inputs.map((el, i) => ({
        i,
        type: el.type,
        inputMode: el.inputMode,
        maxLength: el.maxLength,
        className: el.className.slice(0, 200),
        id: el.id,
        name: el.name,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute("aria-label") || "",
        visible: el.offsetParent !== null,
      }));
    });

    // Find SMS code cells — filter out phone inputs (have placeholder like "999 999-99-99")
    // Strategy 1: InputCell class (WB markup: InputCell-XXXX)
    let codeCells = await page.$$('input[class*="InputCell"]');

    // Strategy 2: numeric inputs WITHOUT phone placeholder
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

    // Strategy 3: short maxlength inputs (1-2 chars, 4+ fields = digit cells)
    if (codeCells.length < 4) {
      const shortInputs = await page.$$('input[maxlength="1"], input[maxlength="2"]');
      if (shortInputs.length >= 4) codeCells = shortInputs;
    }

    // Strategy 4: visible text inputs without placeholder (code cells have no placeholder)
    if (codeCells.length < 4) {
      const allInputs = await page.$$('input[type="text"]');
      const noPh = [];
      for (const el of allInputs) {
        const ok = await el.evaluate(e =>
          e.offsetParent !== null && !e.placeholder && !e.className.includes("SimpleInput")
        );
        if (ok) noPh.push(el);
      }
      if (noPh.length >= 4) codeCells = noPh;
    }

    if (codeCells.length >= 4) {
      // Multiple cells — type one digit per cell
      for (let i = 0; i < Math.min(digits.length, codeCells.length); i++) {
        await codeCells[i].click();
        await codeCells[i].type(digits[i], { delay: 50 });
      }
    } else if (codeCells.length === 1) {
      // Single input — type all digits
      await codeCells[0].click({ clickCount: 3 });
      await codeCells[0].type(digits, { delay: 60 });
    } else {
      // Debug: return info about what inputs were found
      const debugInfo = inputInfo.filter(i => i.visible).map(i =>
        `${i.type}|${i.inputMode}|ml=${i.maxLength}|${i.className.slice(0,40)}`
      ).join("; ");
      return { ok: false, step: "error", error: `Не найдены поля ввода кода. Inputs: [${debugInfo}]` };
    }

    // After entering the last digit WB auto-submits; wait for navigation
    try {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
    } catch {
      // May not navigate if code is wrong or captcha appears
    }

    // Save cookies immediately after navigation — even before detecting step
    // This captures all auth tokens from all domains
    await saveAllCookies(page);

    return await detectCurrentStep(page);
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка кода: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Check session: verifies API tokens are valid via a real API call.
 * No browser needed — pure HTTP check.
 */
export async function checkSession(): Promise<{ ok: boolean; error?: string }> {
  return checkApi();
}

/**
 * Full session verification: open browser, restore cookies, check if finance page loads.
 */
export async function verifySession(): Promise<{ ok: boolean; error?: string }> {
  const cookies = loadCookiesRaw();
  if (!cookies || cookies.length === 0) {
    return { ok: false, error: "Нет сохранённых куки" };
  }
  try {
    const page = await getPage();
    await restoreCookies(page);
    await page.goto(REPORT_URL, { waitUntil: "networkidle2", timeout: 30000 });

    const url = page.url();
    if (url.includes("seller-auth") || url.includes("login")) {
      return { ok: false, error: "Сессия истекла — требуется повторная авторизация" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Take a screenshot of the current browser page (for debugging).
 */
export async function takeScreenshot(): Promise<string | null> {
  try {
    const page = await getPage();
    const buf = await page.screenshot({ encoding: "binary", fullPage: false }) as Buffer;
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Get debug info about current page (URL, inputs, buttons, text) — no screenshots.
 */
export async function getPageDebugInfo(): Promise<{ url: string; inputs: unknown[]; buttons: unknown[]; text: string } | null> {
  try {
    const page = await getPage();
    const url = page.url();
    const info = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input")).map(el => ({
        type: el.type, inputMode: el.inputMode, maxLength: el.maxLength,
        className: el.className.slice(0, 120), id: el.id,
        placeholder: el.placeholder, visible: el.offsetParent !== null,
      }));
      const buttons = Array.from(document.querySelectorAll("button")).map(el => ({
        text: el.textContent?.trim().slice(0, 60),
        className: el.className.slice(0, 80), visible: el.offsetParent !== null,
      }));
      const text = document.body?.innerText?.slice(0, 3000) || "";
      return { inputs, buttons, text };
    });
    return { url, ...info };
  } catch {
    return null;
  }
}

/**
 * Navigate the live browser to a URL and return page info (for debugging/exploration).
 * Also saves localStorage to data/wb-localstorage.json.
 */
export async function navigateAndInspect(targetUrl: string): Promise<{
  url: string; text: string; links: { text: string; href: string }[];
  buttons: string[]; localStorage: Record<string, string>;
} | null> {
  try {
    const page = await getPage();
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for SPA to render
    for (let i = 0; i < 10; i++) {
      const len = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
      if (len > 50) break;
      await new Promise(r => setTimeout(r, 2000));
    }

    const url = page.url();
    const info = await page.evaluate(() => {
      const text = document.body?.innerText?.slice(0, 8000) || "";
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map(a => ({ text: a.textContent?.trim().slice(0, 80) || "", href: a.getAttribute("href") || "" }))
        .filter(l => l.text);
      const buttons = Array.from(document.querySelectorAll("button"))
        .filter(b => b.offsetParent !== null)
        .map(b => b.textContent?.trim().slice(0, 80) || "")
        .filter(Boolean);
      const ls: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        ls[key] = localStorage.getItem(key)?.slice(0, 200) || "";
      }
      return { text, links, buttons, localStorage: ls };
    });

    // Save localStorage
    ensureDirs();
    fs.writeFileSync(
      path.join(process.cwd(), "data", "wb-localstorage.json"),
      JSON.stringify(info.localStorage, null, 2)
    );

    // Also re-save cookies (may have changed after navigation)
    await saveAllCookies(page);

    return { url, ...info };
  } catch (err) {
    return null;
  }
}

// --- Report download (READ-ONLY) ---

export type ReportType = "daily" | "weekly";

export interface ReportRequest {
  type: ReportType;
  dateFrom?: string;
  dateTo?: string;
}

export interface ReportResult {
  ok: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}

export async function downloadReport(req: ReportRequest): Promise<ReportResult> {
  try {
    const page = await getPage();
    ensureDirs();

    const restored = await restoreCookies(page);
    if (!restored) {
      return { ok: false, error: "Нет авторизации. Сначала войдите в систему." };
    }

    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS_DIR,
    });

    await page.goto(REPORT_URL, { waitUntil: "networkidle2", timeout: 30000 });

    if (page.url().includes("seller-auth") || page.url().includes("login")) {
      clearCookies();
      return { ok: false, error: "Сессия истекла. Необходима повторная авторизация." };
    }

    // Wait for page content
    await page.waitForSelector('[class*="Report"], [class*="report"], [class*="Finance"]', {
      timeout: 15000,
    }).catch(() => {});

    if (req.type === "weekly") {
      const weeklyTab = await page.$('button:has-text("Еженедельный"), [data-tab="weekly"]');
      if (weeklyTab) {
        await weeklyTab.click();
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (req.dateFrom) {
      await setDateFilter(page, req.dateFrom, req.dateTo);
    }

    const downloadBtn = await findDownloadButton(page);
    if (!downloadBtn) {
      return { ok: false, error: "Не найдена кнопка скачивания отчёта" };
    }

    const filesBefore = new Set(fs.readdirSync(DOWNLOADS_DIR));
    await downloadBtn.click();

    const filePath = await waitForDownload(filesBefore, 60000);
    if (!filePath) {
      return { ok: false, error: "Файл не был скачан в течение 60 секунд" };
    }

    return { ok: true, filePath, fileName: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: `Ошибка скачивания: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Helpers ---

async function setDateFilter(page: Page, dateFrom: string, dateTo?: string) {
  const dateInputs = await page.$$('input[type="date"], input[placeholder*="дат"], input[class*="date"]');
  if (dateInputs.length >= 1) {
    await dateInputs[0].click({ clickCount: 3 });
    await dateInputs[0].type(dateFrom);
  }
  if (dateInputs.length >= 2 && dateTo) {
    await dateInputs[1].click({ clickCount: 3 });
    await dateInputs[1].type(dateTo);
  }
}

async function findDownloadButton(page: Page): Promise<ReturnType<Page["$"]>> {
  const selectors = [
    'button:has-text("Скачать")',
    'button:has-text("Загрузить")',
    'button:has-text("Сформировать")',
    'a[download]',
    'button[class*="download" i]',
    '[class*="download" i] button',
  ];

  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) return btn;
    } catch { continue; }
  }

  const buttons = await page.$$("button, a.btn, a.button");
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.textContent?.toLowerCase() || "", btn);
    if (text.includes("скачать") || text.includes("загрузить") || text.includes("сформировать")) {
      return btn;
    }
  }
  return null;
}

async function waitForDownload(filesBefore: Set<string>, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const file of fs.readdirSync(DOWNLOADS_DIR)) {
      if (!filesBefore.has(file) && !file.endsWith(".crdownload") && !file.endsWith(".tmp")) {
        return path.join(DOWNLOADS_DIR, file);
      }
    }
  }
  return null;
}

export function listReports() {
  ensureDirs();
  return fs
    .readdirSync(DOWNLOADS_DIR)
    .filter((f) => f.endsWith(".xls") || f.endsWith(".xlsx") || f.endsWith(".csv"))
    .map((f) => {
      const p = path.join(DOWNLOADS_DIR, f);
      const s = fs.statSync(p);
      return { name: f, path: p, size: s.size, date: s.mtime };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function closeBrowser() {
  const pg = getPageInstance();
  if (pg && !pg.isClosed()) { await pg.close(); setPageInstance(null); }
  const br = getBrowserInstance();
  if (br && br.connected) { await br.close(); setBrowserInstance(null); }
}
