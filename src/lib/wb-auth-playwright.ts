/**
 * WB Seller Auth — Playwright-based (Python) for VPS.
 * Communicates via structured STATUS lines in /tmp/wb_auth_log.txt.
 */
import { spawn, type ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { checkApiSession } from "./wb-seller-api";
import { writeSecretFileSync } from "./secure-file";

const DATA_DIR = path.join(process.cwd(), "data");
const TOKENS_PATH = path.join(DATA_DIR, "wb-tokens.json");
const COOLDOWN_PATH = path.join(DATA_DIR, "wb-auth-cooldown.json");
const SMS_CODE_PATH = "/tmp/wb_sms_code";
const AUTH_LOG_PATH = "/tmp/wb_auth_log.txt";
const AUTH_PID_PATH = "/tmp/wb_auth_pid";
const SUPPLIER_CHOICE_PATH = "/tmp/wb_supplier_choice";
const DEFAULT_RATE_LIMIT_SECONDS = 30 * 60;
const MAX_RATE_LIMIT_SECONDS = 24 * 60 * 60;

const g = globalThis as unknown as { __wbAuthProc?: ChildProcess | null };

export type AuthStepResult = {
  ok: boolean;
  step: "code" | "captcha" | "authenticated" | "supplier_select" | "error";
  error?: string;
  warning?: string;
  suppliers?: string[];
  currentSupplier?: string;
  retryAfterSeconds?: number;
  debug?: unknown;
};

type AuthCooldown = {
  phoneHash: string;
  blockedUntil: number;
  message: string;
  updatedAt: string;
};

// --- Parse last STATUS line from log ---

function getLastStatus(): Record<string, unknown> | null {
  try {
    const log = fs.readFileSync(AUTH_LOG_PATH, "utf-8");
    const lines = log.split("\n").filter(l => l.startsWith("STATUS:"));
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1].replace("STATUS:", "");
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function hashPhone(digits: string): string {
  return crypto.createHash("sha256").update(`wb-auth:${digits}`).digest("hex");
}

function parseRetryAfterSeconds(message: string): number | null {
  let total = 0;
  const re = /(\d+)\s*(ч\.?|час[а-яё]*|h|hours?|мин\.?|минут[а-яё]*|m|minutes?|сек\.?|секунд[а-яё]*|s|seconds?)/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(message)) !== null) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) continue;

    if (unit.startsWith("ч") || unit.startsWith("час") || unit === "h" || unit.startsWith("hour")) {
      total += value * 60 * 60;
    } else if (unit.startsWith("м") || unit === "m" || unit.startsWith("minute")) {
      total += value * 60;
    } else if (unit.startsWith("с") || unit === "s" || unit.startsWith("second")) {
      total += value;
    }
  }

  if (total <= 0) return null;
  return Math.min(total, MAX_RATE_LIMIT_SECONDS);
}

function formatRetryAfter(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} мин.`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} ч. ${restMinutes} мин.` : `${hours} ч.`;
}

function getActiveCooldown(digits: string): { message: string; retryAfterSeconds: number } | null {
  try {
    if (!fs.existsSync(COOLDOWN_PATH)) return null;

    const cooldown = JSON.parse(fs.readFileSync(COOLDOWN_PATH, "utf-8")) as Partial<AuthCooldown>;
    if (cooldown.phoneHash !== hashPhone(digits) || typeof cooldown.blockedUntil !== "number") {
      return null;
    }

    const retryAfterSeconds = Math.ceil((cooldown.blockedUntil - Date.now()) / 1000);
    if (retryAfterSeconds <= 0) return null;

    const retryText = formatRetryAfter(retryAfterSeconds);
    const baseMessage = (cooldown.message || "WB временно не даёт запросить новый SMS.")
      .replace(/\s*Повтор через.*$/i, "")
      .trim();
    return {
      message: `${baseMessage || "WB временно не даёт запросить новый SMS."} Повтор через ${retryText}`,
      retryAfterSeconds,
    };
  } catch {
    return null;
  }
}

function saveCooldown(digits: string, message: string): number {
  const retryAfterSeconds = parseRetryAfterSeconds(message) || DEFAULT_RATE_LIMIT_SECONDS;
  const cooldown: AuthCooldown = {
    phoneHash: hashPhone(digits),
    blockedUntil: Date.now() + retryAfterSeconds * 1000,
    message,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COOLDOWN_PATH, JSON.stringify(cooldown, null, 2));
  } catch (err) {
    console.error("[wb-auth-pw] Failed to save auth cooldown:", err);
  }

  return retryAfterSeconds;
}

// --- Step 1: Send phone ---

export async function playwrightSendPhone(phone: string): Promise<AuthStepResult> {
  try {
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
    if (digits.startsWith("7") && digits.length === 11) digits = digits.slice(1);

    const cooldown = getActiveCooldown(digits);
    if (cooldown) {
      return { ok: false, step: "error", error: cooldown.message, retryAfterSeconds: cooldown.retryAfterSeconds };
    }

    killAuthProcess();
    try { fs.unlinkSync(SMS_CODE_PATH); } catch {}
    try { fs.unlinkSync(AUTH_LOG_PATH); } catch {}
    try { fs.unlinkSync(SUPPLIER_CHOICE_PATH); } catch {}

    const scriptPath = path.join(process.cwd(), "scripts", "wb-seller-login.py");
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, step: "error", error: "Скрипт wb-seller-login.py не найден" };
    }

    console.log("[wb-auth-pw] Launching auth for phone:", digits);
    const proc = spawn("python3", [scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, WB_PHONE: digits },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    g.__wbAuthProc = proc;
    if (proc.pid) fs.writeFileSync(AUTH_PID_PATH, String(proc.pid));

    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.stderr?.on("data", (d) => { output += d.toString(); });
    proc.unref();

    // Wait for status
    const startTime = Date.now();
    while (Date.now() - startTime < 35000) {
      await new Promise(r => setTimeout(r, 1000));

      const status = getLastStatus();
      if (status) {
        const state = status.state as string;

        if (state === "sms_sent") {
          return { ok: true, step: "code" };
        }

        if (state === "blocked") {
          const message = (status.message as string) || "SMS заблокирован.";
          const retryAfterSeconds = saveCooldown(digits, message);
          killAuthProcess();
          return { ok: false, step: "error", error: message, retryAfterSeconds };
        }

        if (state === "failed") {
          killAuthProcess();
          return { ok: false, step: "error", error: (status.message as string) || "Ошибка авторизации." };
        }
      }

      if (proc.exitCode !== null) {
        const status = getLastStatus();
        if (status?.state === "blocked") {
          const message = (status.message as string) || "SMS заблокирован.";
          const retryAfterSeconds = saveCooldown(digits, message);
          return { ok: false, step: "error", error: message, retryAfterSeconds };
        }
        return { ok: false, step: "error", error: `Скрипт завершился с кодом ${proc.exitCode}`, debug: output.slice(-300) };
      }
    }

    return { ok: false, step: "error", error: "Таймаут: не удалось отправить SMS за 35с." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 2: Submit SMS code ---

export async function playwrightSubmitCode(code: string): Promise<AuthStepResult> {
  try {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 4) {
      return { ok: false, step: "error", error: "Код должен быть минимум 4 цифры" };
    }

    fs.writeFileSync(SMS_CODE_PATH, digits);
    console.log("[wb-auth-pw] Code written:", digits);

    // Wait for status change
    const startTime = Date.now();
    while (Date.now() - startTime < 60000) {
      await new Promise(r => setTimeout(r, 2000));

      const status = getLastStatus();
      if (!status) continue;
      const state = status.state as string;

      if (state === "code_error") {
        // Wrong code — user can retry
        return { ok: false, step: "code", error: (status.message as string) || "Неверный SMS-код." };
      }

      if (state === "code_expired") {
        killAuthProcess();
        return { ok: false, step: "error", error: (status.message as string) || "Код истёк." };
      }

      if (state === "supplier_select") {
        return {
          ok: true,
          step: "supplier_select",
          suppliers: (status.suppliers as string[]) || [],
          currentSupplier: (status.current as string) || "",
        };
      }

      if (state === "success") {
        // Refresh seller tokens
        await refreshSellerTokenFromAuth();
        const mismatch = checkSupplierMismatch();
        return { ok: true, step: "authenticated", warning: mismatch || undefined };
      }

      if (state === "failed") {
        killAuthProcess();
        return { ok: false, step: "error", error: (status.message as string) || "Авторизация не удалась." };
      }

      // Check if process died
      const proc = g.__wbAuthProc;
      if (proc && proc.exitCode !== null) {
        const s = getLastStatus();
        if (s?.state === "success") {
          await refreshSellerTokenFromAuth();
          return { ok: true, step: "authenticated" };
        }
        return { ok: false, step: "error", error: (s?.message as string) || "Скрипт завершился." };
      }
    }

    killAuthProcess();
    return { ok: false, step: "error", error: "Таймаут обработки кода." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 3: Select supplier ---

export async function playwrightSelectSupplier(supplierName: string): Promise<AuthStepResult> {
  try {
    fs.writeFileSync(SUPPLIER_CHOICE_PATH, supplierName);
    console.log("[wb-auth-pw] Supplier choice written:", supplierName);

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      await new Promise(r => setTimeout(r, 2000));

      const status = getLastStatus();
      if (!status) continue;
      const state = status.state as string;

      if (state === "success") {
        await refreshSellerTokenFromAuth();
        const mismatch = checkSupplierMismatch();
        return { ok: true, step: "authenticated", warning: mismatch || undefined };
      }

      if (state === "failed") {
        killAuthProcess();
        return { ok: false, step: "error", error: (status.message as string) || "Не удалось переключить кабинет." };
      }
    }

    killAuthProcess();
    return { ok: false, step: "error", error: "Таймаут переключения кабинета." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Refresh seller token ---

async function refreshSellerTokenFromAuth(): Promise<void> {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return;
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    const refreshToken = tokens.authorizev3;
    if (!refreshToken) return;

    const slideRes = await fetch("https://seller-auth.wildberries.ru/auth/v2/auth/slide-v3", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: (tokens.cookies || "").slice(0, 2000),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ token: refreshToken }),
    });

    if (!slideRes.ok) return;
    const slideData = await slideRes.json() as { payload?: { access_token?: string } };
    const accessToken = slideData.payload?.access_token;
    if (!accessToken) return;

    const sellerRes = await fetch(
      "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorizev3: accessToken,
          cookie: (tokens.cookies || "").slice(0, 2000),
          origin: "https://seller.wildberries.ru",
          referer: "https://seller.wildberries.ru/",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
      }
    );

    if (!sellerRes.ok) return;
    const sellerData = await sellerRes.json() as Record<string, unknown>;
    const result = sellerData.result as Record<string, unknown> | undefined;
    const sellerToken = (result?.token as string) || ((result?.data as Record<string, unknown>)?.token as string) || "";

    if (sellerToken) {
      const payload = JSON.parse(Buffer.from(sellerToken.split(".")[1], "base64").toString());
      const sd = (payload.data || {}) as Record<string, string>;
      tokens.authorizev3 = accessToken;
      tokens.wbSellerLk = sellerToken;
      tokens.wbSellerLkExpires = payload.exp || 0;
      tokens.supplierId = sd["Z-Sfid"] || sd["Z-Soid"] || "";
      tokens.supplierUuid = sd["Z-Sid"] || "";
      writeSecretFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
      console.log("[wb-auth-pw] Seller token refreshed, supplierId:", tokens.supplierId);
    }
  } catch (err) {
    console.error("[wb-auth-pw] refreshSellerToken error:", err);
  }
}

// --- Supplier mismatch check ---

function checkSupplierMismatch(): string | null {
  try {
    const apiKeyPath = path.join(DATA_DIR, "wb-api-key.txt");
    if (!fs.existsSync(apiKeyPath)) return null;
    const apiKey = fs.readFileSync(apiKeyPath, "utf-8").trim();
    if (!apiKey) return null;
    const apiPayload = JSON.parse(Buffer.from(apiKey.split(".")[1], "base64").toString());
    const apiOid = String(apiPayload.oid || "");
    if (!fs.existsSync(TOKENS_PATH)) return null;
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    const tokenSid = String(tokens.supplierId || "");
    if (apiOid && tokenSid && apiOid !== tokenSid) {
      return `Внимание: API-ключ привязан к кабинету ${apiOid}, а авторизация — к кабинету ${tokenSid}.`;
    }
    return null;
  } catch { return null; }
}

// --- Helpers ---

function killAuthProcess(): void {
  const proc = g.__wbAuthProc;
  if (proc && proc.exitCode === null) {
    try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
    try { proc.kill("SIGTERM"); } catch {}
  }
  g.__wbAuthProc = null;
  try {
    const pid = parseInt(fs.readFileSync(AUTH_PID_PATH, "utf-8").trim());
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch {}
  try { fs.unlinkSync(AUTH_PID_PATH); } catch {}
}

export async function playwrightCheckSession(): Promise<{ ok: boolean; error?: string }> {
  return checkApiSession();
}

export function playwrightLogout(): void {
  killAuthProcess();
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
  try { fs.unlinkSync(SMS_CODE_PATH); } catch {}
  try { fs.unlinkSync(AUTH_LOG_PATH); } catch {}
  try { fs.unlinkSync(SUPPLIER_CHOICE_PATH); } catch {}
}
