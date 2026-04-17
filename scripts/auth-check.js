#!/usr/bin/env node
/**
 * Ежедневная проверка актуальности доступа к WB.
 * Запуск по крону в 22:00 МСК (19:00 UTC).
 *
 * Проверяет:
 * 1. API-ключ (wb-api-key.txt) — запрос /api/v1/supplier/stocks
 * 2. ЛК-авторизация (wb-tokens.json) — запрос /auth/token
 *
 * При провале одного из каналов:
 * - Пишет статус в public/data/monitor/auth-status.json
 * - Шлёт Telegram-алерт (если с последнего алерта прошло > 20ч)
 *
 * При успехе: просто обновляет auth-status.json, ничего не шлёт.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_DIR = path.join(__dirname, "..");
const API_KEY_PATH = path.join(PROJECT_DIR, "data", "wb-api-key.txt");
const TOKENS_PATH = path.join(PROJECT_DIR, "data", "wb-tokens.json");
const STATUS_PATH = path.join(PROJECT_DIR, "public", "data", "monitor", "auth-status.json");
const LOG_PATH = path.join(PROJECT_DIR, "data", "auth-check.log");

// Telegram — берём из env или fallback
const TG_TOKEN = process.env.TG_TOKEN || "8654488203:AAE3vc3L-baecS3IpxE6fwnYnSjrxNM8hEc";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "317252096";

const ALERT_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20 часов

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

async function checkApiKey() {
  try {
    if (!fs.existsSync(API_KEY_PATH)) return { ok: false, reason: "Файл wb-api-key.txt не найден" };
    const apiKey = fs.readFileSync(API_KEY_PATH, "utf-8").trim();
    if (!apiKey) return { ok: false, reason: "Пустой ключ" };

    const dateNow = new Date().toISOString().slice(0, 19);
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${dateNow}`,
      { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Ключ отозван или истёк (HTTP ${res.status})` };
    }
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
}

async function checkLkAuth() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return { ok: false, reason: "Нет файла wb-tokens.json" };
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    if (!tokens.authorizev3 || !tokens.cookies) return { ok: false, reason: "Неполные токены" };

    const res = await fetch(
      "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorizev3: tokens.authorizev3,
          cookie: tokens.cookies,
          origin: "https://seller.wildberries.ru",
          referer: "https://seller.wildberries.ru/",
        },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data?.result?.data?.token) return { ok: true };
      return { ok: false, reason: "Ответ 200, но токен не получен" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `authorizev3 отозван (HTTP ${res.status}) — нужна повторная авторизация по SMS` };
    }
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
}

/**
 * Отправка через scripts/tg-send.sh → SSH на claude-cli VM → tinyproxy → Germany.
 * VPS (российский IP) заблокирован для api.telegram.org, поэтому идём через туннель.
 */
function sendTelegram(text) {
  try {
    const body = JSON.stringify({
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    const bodyB64 = Buffer.from(body).toString("base64");
    const scriptPath = path.join(__dirname, "tg-send.sh");
    const out = execFileSync("bash", [scriptPath, TG_TOKEN, bodyB64], {
      timeout: 20000,
      encoding: "utf-8",
    });
    // Telegram отвечает JSON с полем "ok"
    try {
      const parsed = JSON.parse(out);
      if (parsed.ok) return true;
      log(`Telegram rejected: ${out.slice(0, 200)}`);
      return false;
    } catch {
      log(`Telegram non-JSON response: ${out.slice(0, 200)}`);
      return false;
    }
  } catch (err) {
    log(`Telegram error: ${err.message || err}`);
    return false;
  }
}

function loadPreviousStatus() {
  try {
    if (fs.existsSync(STATUS_PATH)) return JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
  } catch {}
  return { api: null, lk: null, checkedAt: null, lastAlertSentAt: null };
}

function saveStatus(status) {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

async function main() {
  log("Auth check started");
  const [api, lk] = await Promise.all([checkApiKey(), checkLkAuth()]);

  log(`API: ${api.ok ? "ok" : "FAIL — " + api.reason}`);
  log(`LK: ${lk.ok ? "ok" : "FAIL — " + lk.reason}`);

  const prev = loadPreviousStatus();
  const now = new Date().toISOString();
  const allOk = api.ok && lk.ok;

  const status = {
    api: api.ok ? "ok" : "dead",
    apiReason: api.ok ? null : api.reason,
    lk: lk.ok ? "ok" : "dead",
    lkReason: lk.ok ? null : lk.reason,
    checkedAt: now,
    lastAlertSentAt: prev.lastAlertSentAt,
  };

  if (!allOk) {
    const lastAlertTs = prev.lastAlertSentAt ? new Date(prev.lastAlertSentAt).getTime() : 0;
    const nowTs = Date.now();
    const cooldownPassed = nowTs - lastAlertTs > ALERT_COOLDOWN_MS;

    if (cooldownPassed) {
      const apiLine = api.ok ? "✅ ok" : `❌ ${api.reason}`;
      const lkLine = lk.ok ? "✅ ok" : `❌ ${lk.reason}`;
      const msg = [
        "⚠️ <b>MpHub: проблема с доступом к WB</b>",
        "",
        `<b>API-ключ:</b> ${apiLine}`,
        `<b>ЛК:</b> ${lkLine}`,
        "",
        "👉 Открой <a href=\"https://hub.imaxprom.site/settings\">hub.imaxprom.site/settings</a> → обнови доступ.",
      ].join("\n");
      const sent = sendTelegram(msg);
      if (sent) {
        status.lastAlertSentAt = now;
        log("Telegram alert sent");
      }
    } else {
      log(`Alert skipped (cooldown, last sent ${prev.lastAlertSentAt})`);
    }
  } else {
    // Всё ok — сбрасываем lastAlertSentAt, чтобы при следующем падении алерт ушёл сразу
    status.lastAlertSentAt = null;
    log("All channels ok");
  }

  saveStatus(status);
  log("Auth check done");
}

main().catch((err) => {
  log(`FATAL: ${err.message || err}`);
  process.exit(1);
});
