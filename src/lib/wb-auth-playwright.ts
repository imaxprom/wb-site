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
import { getWbAuthPaths, type WbAuthPaths } from "./wb-auth-paths";
import { pgQuery } from "./postgres";
const DEFAULT_RATE_LIMIT_SECONDS = 30 * 60;
const MAX_RATE_LIMIT_SECONDS = 24 * 60 * 60;
const SEND_PHONE_TIMEOUT_MS = 75 * 1000;
const SUBMIT_CODE_TIMEOUT_MS = 4 * 60 * 1000;

const g = globalThis as unknown as { __wbAuthProcs?: Map<number, ChildProcess> };

function authProcesses(): Map<number, ChildProcess> {
  if (!g.__wbAuthProcs) g.__wbAuthProcs = new Map();
  return g.__wbAuthProcs;
}

export type AuthStepResult = {
  ok: boolean;
  step: "code" | "captcha" | "authenticated" | "supplier_select" | "error";
  error?: string;
  warning?: string;
  legalEntities?: LegalEntityOption[];
  selectedLegalEntity?: LegalEntityOption;
  suppliers?: string[];
  currentSupplier?: string;
  retryAfterSeconds?: number;
  debug?: unknown;
};

export type LegalEntityOption = {
  id: string;
  name: string;
  subtitle?: string;
  supplierId?: string;
  storeName?: string;
  inn?: string;
};

type AuthCooldown = {
  phoneHash: string;
  blockedUntil: number;
  message: string;
  updatedAt: string;
};

// --- Parse last STATUS line from log ---

function getLastStatus(paths: WbAuthPaths): Record<string, unknown> | null {
  try {
    const log = fs.readFileSync(paths.authLogPath, "utf-8");
    const lines = log.split("\n").filter(l => l.startsWith("STATUS:"));
    if (lines.length === 0) return null;
    const last = lines[lines.length - 1].replace("STATUS:", "");
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function legalEntitiesFromStatus(status: Record<string, unknown>): LegalEntityOption[] {
  if (!Array.isArray(status.legalEntities)) return [];
  return status.legalEntities.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entity = value as Record<string, unknown>;
    const id = String(entity.id || "").trim();
    const name = String(entity.name || "").trim();
    if (!id || !name) return [];
    return [{
      id,
      name,
      subtitle: String(entity.subtitle || "").trim() || undefined,
      supplierId: String(entity.supplierId || "").trim() || undefined,
      storeName: String(entity.storeName || "").trim() || undefined,
      inn: String(entity.inn || "").replace(/\D/g, "") || undefined,
    }];
  });
}

function selectedLegalEntityFromStatus(status: Record<string, unknown>): LegalEntityOption | undefined {
  const value = status.selectedLegalEntity;
  if (!value || typeof value !== "object") return undefined;
  return legalEntitiesFromStatus({ legalEntities: [value] })[0];
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

function getActiveCooldown(paths: WbAuthPaths, digits: string): { message: string; retryAfterSeconds: number } | null {
  try {
    if (!fs.existsSync(paths.cooldownPath)) return null;

    const cooldown = JSON.parse(fs.readFileSync(paths.cooldownPath, "utf-8")) as Partial<AuthCooldown>;
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

function saveCooldown(paths: WbAuthPaths, digits: string, message: string): number {
  const retryAfterSeconds = parseRetryAfterSeconds(message) || DEFAULT_RATE_LIMIT_SECONDS;
  const cooldown: AuthCooldown = {
    phoneHash: hashPhone(digits),
    blockedUntil: Date.now() + retryAfterSeconds * 1000,
    message,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
    writeSecretFileSync(paths.cooldownPath, JSON.stringify(cooldown, null, 2));
  } catch (err) {
    console.error("[wb-auth-pw] Failed to save auth cooldown:", err);
  }

  return retryAfterSeconds;
}

// --- Step 1: Send phone ---

export async function playwrightSendPhone(phone: string): Promise<AuthStepResult> {
  try {
    const paths = getWbAuthPaths();
    let digits = phone.replace(/\D/g, "");
    if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
    if (digits.startsWith("7") && digits.length === 11) digits = digits.slice(1);

    const cooldown = getActiveCooldown(paths, digits);
    if (cooldown) {
      return { ok: false, step: "error", error: cooldown.message, retryAfterSeconds: cooldown.retryAfterSeconds };
    }

    killAuthProcess(paths);
    clearBrowserProfile(paths);
    try { fs.unlinkSync(paths.smsCodePath); } catch {}
    try { fs.unlinkSync(paths.authLogPath); } catch {}
    try { fs.unlinkSync(paths.supplierChoicePath); } catch {}

    const scriptPath = path.join(process.cwd(), "scripts", "wb-seller-login.py");
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, step: "error", error: "Скрипт wb-seller-login.py не найден" };
    }

    console.log("[wb-auth-pw] Launching auth for phone:", digits);
    const proc = spawn("python3", [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WB_PHONE: digits,
        MPHUB_ORGANIZATION_ID: String(paths.organizationId),
        WB_TOKENS_PATH: paths.tokensPath,
        WB_PROFILE_DIR: paths.profileDir,
        WB_AUTH_LOG_PATH: paths.authLogPath,
        WB_SMS_CODE_PATH: paths.smsCodePath,
        WB_SUPPLIER_CHOICE_PATH: paths.supplierChoicePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    authProcesses().set(paths.organizationId, proc);
    if (proc.pid) fs.writeFileSync(paths.authPidPath, String(proc.pid), { mode: 0o600 });
    const spawnedPid = proc.pid;
    proc.once("exit", () => {
      if (authProcesses().get(paths.organizationId) === proc) {
        authProcesses().delete(paths.organizationId);
      }
      try {
        const savedPid = Number(fs.readFileSync(paths.authPidPath, "utf-8").trim());
        if (spawnedPid && savedPid === spawnedPid) fs.unlinkSync(paths.authPidPath);
      } catch {}
    });

    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.stderr?.on("data", (d) => { output += d.toString(); });
    proc.unref();

    // Wait for status
    const startTime = Date.now();
    while (Date.now() - startTime < SEND_PHONE_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 1000));

      const status = getLastStatus(paths);
      if (status) {
        const state = status.state as string;

        if (state === "sms_sent") {
          return { ok: true, step: "code" };
        }

        if (state === "blocked") {
          const message = (status.message as string) || "SMS заблокирован.";
          const retryAfterSeconds = saveCooldown(paths, digits, message);
          killAuthProcess(paths);
          return { ok: false, step: "error", error: message, retryAfterSeconds };
        }

        if (state === "failed") {
          killAuthProcess(paths);
          return { ok: false, step: "error", error: (status.message as string) || "Ошибка авторизации." };
        }
      }

      if (proc.exitCode !== null) {
        const status = getLastStatus(paths);
        if (status?.state === "blocked") {
          const message = (status.message as string) || "SMS заблокирован.";
          const retryAfterSeconds = saveCooldown(paths, digits, message);
          return { ok: false, step: "error", error: message, retryAfterSeconds };
        }
        if (status?.state === "failed") {
          return { ok: false, step: "error", error: (status.message as string) || "Ошибка авторизации." };
        }
        return { ok: false, step: "error", error: `Скрипт завершился с кодом ${proc.exitCode}`, debug: output.slice(-300) };
      }
    }

    const finalStatus = getLastStatus(paths);
    killAuthProcess(paths);
    if (finalStatus?.state === "failed") {
      return { ok: false, step: "error", error: (finalStatus.message as string) || "Ошибка авторизации." };
    }
    return { ok: false, step: "error", error: "Таймаут: WB не ответил на запрос SMS за 75 секунд." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 2: Submit SMS code ---

export async function playwrightSubmitCode(code: string): Promise<AuthStepResult> {
  try {
    const paths = getWbAuthPaths();
    const digits = code.replace(/\D/g, "");
    if (digits.length < 4) {
      return { ok: false, step: "error", error: "Код должен быть минимум 4 цифры" };
    }

    fs.writeFileSync(paths.smsCodePath, digits, { mode: 0o600 });
    console.log("[wb-auth-pw] SMS code submitted");

    // Wait for status change
    const startTime = Date.now();
    while (Date.now() - startTime < SUBMIT_CODE_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 2000));

      const status = getLastStatus(paths);
      if (!status) continue;
      const state = status.state as string;

      if (state === "code_error") {
        // Wrong code — user can retry
        return { ok: false, step: "code", error: (status.message as string) || "Неверный SMS-код." };
      }

      if (state === "code_expired") {
        killAuthProcess(paths);
        return { ok: false, step: "error", error: (status.message as string) || "Код истёк." };
      }

      if (state === "supplier_select") {
        const legalEntities = legalEntitiesFromStatus(status);
        return {
          ok: true,
          step: "supplier_select",
          legalEntities,
          suppliers: (status.suppliers as string[]) || [],
          currentSupplier: (status.current as string) || "",
        };
      }

      if (state === "success") {
        // Refresh seller tokens
        await refreshSellerTokenFromAuth(paths);
        const mismatch = checkSupplierMismatch(paths);
        return {
          ok: true,
          step: "authenticated",
          selectedLegalEntity: selectedLegalEntityFromStatus(status),
          warning: mismatch || undefined,
        };
      }

      if (state === "failed") {
        killAuthProcess(paths);
        return { ok: false, step: "error", error: (status.message as string) || "Авторизация не удалась." };
      }

      // Check if process died
      const proc = authProcesses().get(paths.organizationId);
      if (proc && proc.exitCode !== null) {
        const s = getLastStatus(paths);
        if (s?.state === "success") {
          await refreshSellerTokenFromAuth(paths);
          return { ok: true, step: "authenticated" };
        }
        return { ok: false, step: "error", error: (s?.message as string) || "Скрипт завершился." };
      }
    }

    killAuthProcess(paths);
    return { ok: false, step: "error", error: "Таймаут обработки кода: WB принял код, но токены не успели сохраниться." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Step 3: Select supplier ---

export async function playwrightSelectSupplier(entityId: string): Promise<AuthStepResult> {
  try {
    const paths = getWbAuthPaths();
    const pendingStatus = getLastStatus(paths);
    if (!pendingStatus || pendingStatus.state !== "supplier_select") {
      return { ok: false, step: "error", error: "Нет ожидающего выбора юрлица. Запросите SMS-код заново." };
    }
    const legalEntities = legalEntitiesFromStatus(pendingStatus);
    const selected = legalEntities.find((entity) => entity.id === entityId);
    if (!selected) {
      return { ok: false, step: "error", error: "Выбранное юрлицо отсутствует в текущей сессии WB." };
    }

    fs.writeFileSync(paths.supplierChoicePath, selected.id, { mode: 0o600 });
    console.log("[wb-auth-pw] Legal entity choice written:", selected.id);

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      await new Promise(r => setTimeout(r, 2000));

      const status = getLastStatus(paths);
      if (!status) continue;
      const state = status.state as string;

      if (state === "success") {
        await refreshSellerTokenFromAuth(paths);
        const mismatch = checkSupplierMismatch(paths);
        return {
          ok: true,
          step: "authenticated",
          selectedLegalEntity: selectedLegalEntityFromStatus(status) || selected,
          warning: mismatch || undefined,
        };
      }

      if (state === "failed") {
        killAuthProcess(paths);
        return { ok: false, step: "error", error: (status.message as string) || "Не удалось переключить кабинет." };
      }
    }

    killAuthProcess(paths);
    return { ok: false, step: "error", error: "Таймаут переключения кабинета." };
  } catch (err) {
    return { ok: false, step: "error", error: `Ошибка: ${err instanceof Error ? err.message : err}` };
  }
}

// --- Refresh seller token ---

async function refreshSellerTokenFromAuth(paths: WbAuthPaths): Promise<void> {
  try {
    if (!fs.existsSync(paths.tokensPath)) return;
    const tokens = JSON.parse(fs.readFileSync(paths.tokensPath, "utf-8"));
    const refreshToken = tokens.authorizev3;
    if (refreshToken) {
      const slideRes = await fetch("https://seller-auth.wildberries.ru/auth/v2/auth/slide-v3", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: (tokens.cookies || "").slice(0, 2000),
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        body: JSON.stringify({ token: refreshToken }),
      });

      if (slideRes.ok) {
        const slideData = await slideRes.json() as { payload?: { access_token?: string } };
        const accessToken = slideData.payload?.access_token;
        if (accessToken) {
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

          if (sellerRes.ok) {
            const sellerData = await sellerRes.json() as Record<string, unknown>;
            const result = sellerData.result as Record<string, unknown> | undefined;
            const sellerToken = (result?.token as string) || ((result?.data as Record<string, unknown>)?.token as string) || "";

            if (sellerToken) {
              const payload = JSON.parse(Buffer.from(sellerToken.split(".")[1], "base64").toString());
              const sd = (payload.data || {}) as Record<string, string>;
              tokens.authorizev3 = accessToken;
              tokens.wbSellerLk = sellerToken;
              tokens.wbSellerLkExpires = payload.exp || 0;
              tokens.supplierId = sd["Z-Sfid"] || sd["Z-Soid"] || tokens.supplierId || "";
              tokens.supplierUuid = sd["Z-Sid"] || tokens.supplierUuid || "";
              writeSecretFileSync(paths.tokensPath, JSON.stringify(tokens, null, 2));
              console.log("[wb-auth-pw] Seller token refreshed, supplierId:", tokens.supplierId);
            }
          }
        }
      }
    }

    await pgQuery(`
      UPDATE public.organizations
      SET supplier_id = COALESCE(NULLIF($1, ''), supplier_id),
          store_name = COALESCE(NULLIF($2, ''), store_name),
          inn = COALESCE(NULLIF($3, ''), inn),
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [
      String(tokens.supplierId || ""),
      String(tokens.storeName || ""),
      String(tokens.inn || ""),
      paths.organizationId,
    ]);
  } catch (err) {
    console.error("[wb-auth-pw] refreshSellerToken error:", err);
  }
}

// --- Supplier mismatch check ---

function checkSupplierMismatch(paths: WbAuthPaths): string | null {
  try {
    const apiKeyPath = path.join(paths.dataDir, "wb-api-key.txt");
    if (!fs.existsSync(apiKeyPath)) return null;
    const apiKey = fs.readFileSync(apiKeyPath, "utf-8").trim();
    if (!apiKey) return null;
    const apiPayload = JSON.parse(Buffer.from(apiKey.split(".")[1], "base64").toString());
    const apiOid = String(apiPayload.oid || "");
    if (!fs.existsSync(paths.tokensPath)) return null;
    const tokens = JSON.parse(fs.readFileSync(paths.tokensPath, "utf-8"));
    const tokenSid = String(tokens.supplierId || "");
    if (apiOid && tokenSid && apiOid !== tokenSid) {
      return `Внимание: API-ключ привязан к кабинету ${apiOid}, а авторизация — к кабинету ${tokenSid}.`;
    }
    return null;
  } catch { return null; }
}

// --- Helpers ---

function clearBrowserProfile(paths: WbAuthPaths): void {
  const dataDir = path.resolve(paths.dataDir);
  const profileDir = path.resolve(paths.profileDir);
  if (profileDir !== path.join(dataDir, "wb-playwright-profile")) {
    throw new Error("Небезопасный путь профиля WB");
  }
  fs.rmSync(profileDir, { recursive: true, force: true });
}

function killAuthProcess(paths: WbAuthPaths): void {
  const processes = authProcesses();
  const proc = processes.get(paths.organizationId);
  if (proc && proc.exitCode === null) {
    try { process.kill(-proc.pid!, "SIGTERM"); } catch {}
    try { proc.kill("SIGTERM"); } catch {}
  }
  processes.delete(paths.organizationId);
  try {
    const pid = parseInt(fs.readFileSync(paths.authPidPath, "utf-8").trim());
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch {}
  try { fs.unlinkSync(paths.authPidPath); } catch {}
}

export async function playwrightCheckSession(): Promise<{ ok: boolean; error?: string }> {
  return checkApiSession();
}

export function playwrightLogout(): void {
  const paths = getWbAuthPaths();
  killAuthProcess(paths);
  clearBrowserProfile(paths);
  try { fs.unlinkSync(paths.tokensPath); } catch {}
  try { fs.unlinkSync(paths.smsCodePath); } catch {}
  try { fs.unlinkSync(paths.authLogPath); } catch {}
  try { fs.unlinkSync(paths.supplierChoicePath); } catch {}
}
