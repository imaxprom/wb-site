#!/usr/bin/env node
/**
 * Auto-complaints script — runs every 30 minutes.
 * For each account with auto_complaints=1 and cabinet tokens:
 * 1. Finds reviews eligible for complaint (matching ratings, no existing complaint)
 * 2. Submits complaints to WB Cabinet API
 * 3. Logs results
 *
 * Usage: node scripts/reviews-complaints.js
 */

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const PROJECT_DIR = path.join(__dirname, "..");
const LOG_PATH = path.join(PROJECT_DIR, "data", "reviews-complaints.log");
const CODEX_GATEWAY_ENV_PATH = path.join(PROJECT_DIR, "data", "codex-gateway.env");

const WB_COMPLAINTS_URL =
  "https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v1/feedbacks/complaints";
const COMPLAINT_PAUSE_LAST_N = 5;
const COMPLAINT_PAUSE_WINDOW_HOURS = 24;
const COMPLAINT_PAUSE_HOURS = 24;

// ─── Logging ────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key) {
        env[key] = value;
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }
    return env;
  } catch {
    return {};
  }
}

loadEnvFile(path.join(PROJECT_DIR, ".env.production.local"));

const USE_PG = true;
let pgPool = null;

function getPgPool() {
  if (!pgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when MPHUB_DB_ENGINE=postgres");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 5),
      application_name: process.env.PGAPPNAME || "mphub-reviews-complaints",
    });
  }
  return pgPool;
}

function getCodexGatewayConfig() {
  const fileEnv = loadEnvFile(CODEX_GATEWAY_ENV_PATH);
  return {
    url: (process.env.CODEX_GATEWAY_URL || fileEnv.CODEX_GATEWAY_URL || "http://192.168.55.106:8080").replace(/\/+$/, ""),
    token: process.env.CODEX_GATEWAY_TOKEN || fileEnv.CODEX_GATEWAY_TOKEN || "",
    model: process.env.CODEX_GATEWAY_MODEL || fileEnv.CODEX_GATEWAY_MODEL || "gpt-5.5",
    timeoutMs: Number(process.env.CODEX_GATEWAY_TIMEOUT_MS || fileEnv.CODEX_GATEWAY_TIMEOUT_MS || 180000),
  };
}

// ─── DB helpers ─────────────────────────────────────────────

function getDb() {
  throw new Error("Removed file-DB review complaints sync is disabled. Use PostgreSQL runtime only.");
}

function initComplaintsTable(db) {
  if (USE_PG) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER REFERENCES reviews(id),
      account_id INTEGER REFERENCES review_accounts(id),
      wb_review_id TEXT NOT NULL,
      complaint_reason_id INTEGER NOT NULL,
      explanation TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME,
      resolved_at DATETIME
    )
  `);
}

function getAutoComplaintAccounts(db) {
  if (USE_PG) {
    return getPgPool().query(`
      SELECT * FROM review_accounts
      WHERE auto_complaints = 1
        AND wb_authorize_v3 IS NOT NULL
        AND wb_authorize_v3 != ''
    `).then(result => result.rows);
  }

  return db.prepare(`
    SELECT * FROM review_accounts
    WHERE auto_complaints = 1
      AND wb_authorize_v3 IS NOT NULL
      AND wb_authorize_v3 != ''
  `).all();
}

function getComplaintsConfig(account) {
  const defaults = {
    ratings: [1, 2],
    allowed_reasons: [11, 16, 13, 12, 20, 18, 19],
    excluded_articles: "",
    daily_limit: 50,
    delay_min_minutes: 1,
    delay_max_minutes: 10,
    managers: [],
  };
  try {
    const settings = account.settings_json ? JSON.parse(account.settings_json) : {};
    return { ...defaults, ...settings.auto_complaints_config };
  } catch {
    return defaults;
  }
}

function getEligibleReviews(db, accountId, ratings, excludedArticles) {
  const ratingPlaceholders = ratings.map(() => "?").join(",");
  const params = [accountId, ...ratings];

  let excludeClause = "";
  if (excludedArticles.length > 0) {
    const artPlaceholders = excludedArticles.map(() => "?").join(",");
    excludeClause = `AND product_article NOT IN (${artPlaceholders})`;
    params.push(...excludedArticles);
  }

  return db.prepare(`
    SELECT * FROM reviews
    WHERE account_id = ?
      AND rating IN (${ratingPlaceholders})
      AND complaint_status IS NULL
      AND is_hidden = 0
      AND is_excluded_rating = 0
      AND wb_review_id IS NOT NULL
      ${excludeClause}
    ORDER BY date DESC
  `).all(...params);
}

async function getEligibleReviewsPg(accountId, ratings, excludedArticles) {
  const params = [accountId, ...ratings];
  const ratingPlaceholders = ratings.map((_, index) => `$${index + 2}`).join(",");

  let excludeClause = "";
  if (excludedArticles.length > 0) {
    const offset = params.length;
    const artPlaceholders = excludedArticles.map((_, index) => `$${offset + index + 1}`).join(",");
    excludeClause = `AND product_article NOT IN (${artPlaceholders})`;
    params.push(...excludedArticles);
  }

  const result = await getPgPool().query(`
    SELECT * FROM reviews
    WHERE account_id = $1
      AND rating IN (${ratingPlaceholders})
      AND complaint_status IS NULL
      AND is_hidden = 0
      AND is_excluded_rating = 0
      AND wb_review_id IS NOT NULL
      ${excludeClause}
    ORDER BY date DESC
  `, params);
  return result.rows;
}

function getTodayCount(db, accountId) {
  if (USE_PG) {
    return getPgPool().query(`
      SELECT COUNT(*)::int as cnt FROM review_complaints
      WHERE account_id = $1 AND created_at::date = CURRENT_DATE
    `, [accountId]).then(result => result.rows[0]?.cnt || 0);
  }

  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM review_complaints
    WHERE account_id = ? AND date(created_at) = date('now')
  `).get(accountId);
  return row.cnt;
}

async function getRecentComplaintStatusesPg(accountId) {
  const result = await getPgPool().query(`
    SELECT status FROM review_complaints
    WHERE account_id = $1 AND status IN ('approved','rejected')
      AND COALESCE(resolved_at, submitted_at, created_at)::timestamptz >= CURRENT_TIMESTAMP - make_interval(hours => $2::int)
    ORDER BY COALESCE(resolved_at, submitted_at, created_at)::timestamptz DESC
    LIMIT $3
  `, [accountId, COMPLAINT_PAUSE_WINDOW_HOURS, COMPLAINT_PAUSE_LAST_N]);
  return result.rows;
}

async function ensureComplaintPauseTablePg() {
  await getPgPool().query(`
    CREATE TABLE IF NOT EXISTS review_complaint_pauses (
      account_id INTEGER PRIMARY KEY,
      paused_until TIMESTAMPTZ NOT NULL,
      reason TEXT,
      stats_json JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getActiveComplaintPausePg(accountId) {
  await ensureComplaintPauseTablePg();
  const result = await getPgPool().query(`
    SELECT account_id, paused_until, reason, stats_json, created_at, updated_at
    FROM review_complaint_pauses
    WHERE account_id = $1 AND paused_until > CURRENT_TIMESTAMP
  `, [accountId]);
  return result.rows[0] || null;
}

async function setComplaintPausePg(accountId, stats) {
  await ensureComplaintPauseTablePg();
  const result = await getPgPool().query(`
    INSERT INTO review_complaint_pauses (account_id, paused_until, reason, stats_json)
    VALUES (
      $1,
      CURRENT_TIMESTAMP + make_interval(hours => $2::int),
      $3,
      $4::jsonb
    )
    ON CONFLICT (account_id) DO UPDATE SET
      paused_until = EXCLUDED.paused_until,
      reason = EXCLUDED.reason,
      stats_json = EXCLUDED.stats_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING account_id, paused_until, reason, stats_json, created_at, updated_at
  `, [
    accountId,
    COMPLAINT_PAUSE_HOURS,
    `Последние ${COMPLAINT_PAUSE_LAST_N} обработанных жалоб за ${COMPLAINT_PAUSE_WINDOW_HOURS} ч отклонены WB`,
    JSON.stringify(stats),
  ]);
  return result.rows[0] || null;
}

async function clearComplaintPausePg(accountId) {
  await ensureComplaintPauseTablePg();
  await getPgPool().query("DELETE FROM review_complaint_pauses WHERE account_id = $1", [accountId]);
}

async function getLastComplaintTextPg(accountId, managerName) {
  const result = await getPgPool().query(`
    SELECT explanation FROM review_complaints
    WHERE account_id = $1 AND manager_name = $2 AND explanation IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `, [accountId, managerName]);
  return result.rows[0] || null;
}

async function insertComplaintPg(reviewId, accountId, wbReviewId, reasonId, explanation, managerName) {
  const result = await getPgPool().query(`
    INSERT INTO review_complaints (review_id, account_id, wb_review_id, complaint_reason_id, explanation, manager_name)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [reviewId, accountId, wbReviewId, reasonId, explanation || null, managerName || null]);
  return result.rows[0].id;
}

async function markComplaintSubmittedPg(id) {
  await getPgPool().query(`UPDATE review_complaints SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
}

async function markComplaintErrorPg(id, errorMessage) {
  await getPgPool().query(`UPDATE review_complaints SET status = 'error', error_message = $1 WHERE id = $2`, [errorMessage, id]);
}

async function updateReviewComplaintStatusPg(reviewId, status) {
  await getPgPool().query(`UPDATE reviews SET complaint_status = $1 WHERE id = $2`, [status, reviewId]);
}

// ─── AI text generation via Codex gateway ───────────────────

const COMPLAINT_REASONS = {
  11: "Отзыв не относится к товару",
  12: "Отзыв оставили конкуренты",
  13: "Спам-реклама в тексте",
  14: "Спам-реклама на фото",
  15: "Непристойный контент на фото",
  16: "Нецензурная лексика",
  17: "Фото не относится к товару",
  18: "Отзыв с политическим контекстом",
  20: "Угрозы, оскорбления",
  19: "Другое",
};

const DEFAULT_SYSTEM_PROMPT = (
  "Ты — сотрудник бренда IMSI (женское нижнее бельё) на Wildberries. " +
  "Составляешь обращения к модератору по необъективным отзывам. " +
  "Пиши как живой человек, без шаблонов и канцелярита. " +
  "Длина обращения — 600-1000 символов. " +
  "Предпочитай причину 11 («Отзыв не относится к товару») если отзыв: пустой, про доставку, " +
  "про упаковку, про размер без реального дефекта, содержит эмоции без конкретики. " +
  "Причина 19 («Другое») — только когда ни одна из специфических не подходит. " +
  "Отвечай СТРОГО JSON."
);

const DEFAULT_USER_PROMPT = `Составь обращение к модератору Wildberries по отзыву покупателя.

Отзыв:
- Товар: {product_name} (арт. {product_article})
- Оценка: {rating}/5
- Текст: {review_text}
- Фото/видео от покупателя: нет

Категории обращения (выбирай по порядку приоритета; первая подходящая — твой выбор):
{reasons_list}

Приоритет ПРИЧИН (строго соблюдать):
1. Отзыв пустой/без фото/про доставку/упаковку/про несоответствие размера без дефекта → reason_id=11
2. Реклама/спам/URL в тексте → reason_id=13
3. Нецензурная лексика → reason_id=16
4. Угрозы/оскорбления → reason_id=20
5. Политический контекст → reason_id=18
6. Явно конкурентный отзыв → reason_id=12
7. Только если ни одна из выше не подходит → reason_id=19

Требования к тексту обращения:
- ОБЯЗАТЕЛЬНО 600–1000 символов
- Упомяни артикул товара
- 4–7 предложений
- НЕ используй фразы: «голословный», «добросовестный продавец», «просим модератора рассмотреть», «принять решение об удалении», «вводит в заблуждение», «наносит ущерб репутации», «на всех этапах», «бездоказательный», «потенциальных покупателей», «репутационный ущерб»
- Не используй длинные тире
- Реагируй на конкретное содержание отзыва, а не по шаблону

Ответ — строго JSON одной строкой:
{"reason_id": <число>, "explanation": "<текст 600-1000 символов>"}`;

function buildPrompt(template, review, allowedReasons) {
  const reviewText = [
    review.review_text,
    review.pros ? `Достоинства: ${review.pros}` : "",
    review.cons ? `Недостатки: ${review.cons}` : "",
  ].filter(Boolean).join("\n");

  const reasonsList = allowedReasons
    .map((id) => `  ${id} — ${COMPLAINT_REASONS[id] || "Неизвестно"}`)
    .join("\n");

  return template
    .replace(/\{product_name\}/g, review.product_name || "неизвестен")
    .replace(/\{product_article\}/g, review.product_article || "?")
    .replace(/\{rating\}/g, String(review.rating || "?"))
    .replace(/\{review_text\}/g, reviewText || "(покупатель не оставил текст)")
    .replace(/\{reasons_list\}/g, reasonsList);
}

function normalizeExplanation(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 1000) return text;
  return text.slice(0, 1000).replace(/\s+\S*$/, "").trim();
}

function defaultReasonId(reasonIds) {
  return reasonIds.includes(19) ? 19 : reasonIds[0];
}

async function generateComplaint(review, allowedReasons, config, manager, previousText) {
  const sysPrompt = (config && config.system_prompt) || DEFAULT_SYSTEM_PROMPT;
  const userTemplate = (config && config.user_prompt) || DEFAULT_USER_PROMPT;
  let prompt = buildPrompt(userTemplate, review, allowedReasons);
  prompt += "\n\nТехническое ограничение WB: поле explanation должно быть обычным текстом 600-1000 символов. Не используй поле text.";

  if (manager && manager.style) {
    prompt += `\n\n---\nПиши в стиле менеджера ${manager.name}: ${manager.style}`;
    if (previousText) {
      prompt += `\n\nТвоё предыдущее обращение (НЕ повторяй структуру, формулировки и порядок аргументов):\n"${previousText.slice(0, 500)}"`;
    }
  }

  const gateway = getCodexGatewayConfig();
  if (!gateway.token) {
    log("  AI generation failed: CODEX_GATEWAY_TOKEN is not configured");
    return null;
  }

  try {
    const res = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${gateway.token}`,
      },
      body: JSON.stringify({
        model: gateway.model,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(gateway.timeoutMs),
    });
    const body = await res.text();
    if (!res.ok) {
      log(`  AI generation failed: Codex gateway HTTP ${res.status}: ${body.slice(0, 300)}`);
      return null;
    }

    const completion = JSON.parse(body);
    const text = String(completion?.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*"reason_id"[\s\S]*"explanation"[\s\S]*\}/);
    if (!jsonMatch) { log("  AI no JSON found in output"); return null; }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!allowedReasons.includes(parsed.reason_id)) {
      parsed.reason_id = defaultReasonId(allowedReasons);
    }
    parsed.explanation = normalizeExplanation(parsed.explanation);
    return parsed;
  } catch (e) {
    log(`  AI JSON/gateway failed: ${e.message}`);
    return null;
  }
}

// ─── WB API ─────────────────────────────────────────────────

function buildHeaders(account) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Origin": "https://seller.wildberries.ru",
    "Referer": "https://seller.wildberries.ru/",
  };
  if (account.wb_authorize_v3) headers["authorizev3"] = account.wb_authorize_v3;
  if (account.wb_seller_lk) headers["wb-seller-lk"] = account.wb_seller_lk;
  if (account.wb_validation_key) {
    const cookieParts = [`wbx-validation-key=${account.wb_validation_key}`];
    if (account.supplier_id) cookieParts.push(`x-supplier-id=${account.supplier_id}`);
    const supplierUuid = getSupplierUuid(account);
    if (supplierUuid) cookieParts.push(`x-supplier-id-external=${supplierUuid}`);
    headers["Cookie"] = cookieParts.join("; ");
  }
  return headers;
}

function getSupplierUuid(account) {
  if (!account.wb_seller_lk) return "";
  try {
    const payload = JSON.parse(Buffer.from((account.wb_seller_lk.split(".")[1] || ""), "base64url").toString("utf-8"));
    return String(payload?.data?.["Z-Sid"] || "");
  } catch {
    return "";
  }
}

async function submitComplaint(account, wbReviewId, reasonId, explanation) {
  const headers = buildHeaders(account);
  const complaint = { id: reasonId };
  if (explanation) complaint.explanation = explanation;
  const body = JSON.stringify({
    feedbackId: wbReviewId,
    feedbackComplaint: complaint,
  });

  const res = await fetch(WB_COMPLAINTS_URL, {
    method: "PATCH",
    headers,
    body,
  });

  const text = await res.text().catch(() => "");

  // WB returns 200 even on auth errors — check body for "error": true
  let wbOk = res.ok;
  if (wbOk && text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.error === true) wbOk = false;
    } catch {}
  }

  return { ok: wbOk, status: res.status, body: text };
}

async function fetchAvailableComplaintReasons(account, wbReviewId) {
  const res = await fetch(`${WB_COMPLAINTS_URL}/${encodeURIComponent(wbReviewId)}`, {
    method: "GET",
    headers: buildHeaders(account),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text().catch(() => "");
  let reasons = [];
  let ok = res.ok;

  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.error === true) ok = false;
      const rawReasons = parsed?.data?.feedbackComplaints;
      if (Array.isArray(rawReasons)) {
        reasons = rawReasons
          .map(item => ({
            id: Number(item.id),
            label: String(item.label || COMPLAINT_REASONS[Number(item.id)] || ""),
            explanationRequired: Boolean(item.explanationRequired),
          }))
          .filter(item => Number.isFinite(item.id));
      }
    } catch {
      ok = false;
    }
  }

  return { ok, status: res.status, body, reasons };
}

function getTextComplaintReasons(availableReasons, preferredReasonIds) {
  const withText = availableReasons.filter(reason => reason.explanationRequired);
  const byId = new Map(withText.map(reason => [reason.id, reason]));
  const preferred = preferredReasonIds.map(id => byId.get(id)).filter(Boolean);
  return preferred.length ? preferred : withText;
}

function reasonErrorMessage(wbReviewId, availableReasons, preferredReasonIds) {
  if (availableReasons.length === 0) {
    return `WB не вернул доступные причины жалобы для отзыва ${wbReviewId}`;
  }
  const available = availableReasons.map(reason => `${reason.id}:${reason.label || "без названия"}${reason.explanationRequired ? "" : " (без текста)"}`).join(", ");
  return `Для отзыва ${wbReviewId} WB не принимает текстовое пояснение по настроенным причинам [${preferredReasonIds.join(", ")}]. Доступно: ${available}`;
}

// ─── Sync complaint statuses from WB ────────────────────────

async function syncComplaintStatuses(db, account) {
  if (USE_PG) {
    const pendingResult = await getPgPool().query(
      "SELECT id, wb_review_id, review_id FROM review_complaints WHERE account_id = $1 AND status = 'submitted'",
      [account.id],
    );
    const pending = pendingResult.rows;
    if (pending.length === 0) return;

    log(`  Checking ${pending.length} pending complaint statuses...`);
    const headers = buildHeaders(account);
    const pendingMap = new Map(pending.map(p => [p.wb_review_id, p]));
    let updated = 0;

    let nextCursor = "";
    for (let page = 0; page < 30 && pendingMap.size > 0; page++) {
      const cursorParam = nextCursor ? `cursor=${encodeURIComponent(nextCursor)}` : "cursor=";
      const url = `https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v2/feedbacks?${cursorParam}&isAnswered=true&limit=100&sortOrder=dateDesc`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!res || !res.ok) break;

      const data = await res.json().catch(() => null);
      if (!data || data.error) break;
      const feedbacks = data.data?.feedbacks || [];
      if (feedbacks.length === 0) break;

      for (const fb of feedbacks) {
        if (!pendingMap.has(fb.id)) continue;
        const status = fb.supplierComplaints?.feedbackComplaint?.status;
        if (status === 'approved' || status === 'rejected') {
          const complaint = pendingMap.get(fb.id);
          await getPgPool().query("UPDATE review_complaints SET status = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2", [status, complaint.id]);
          await getPgPool().query("UPDATE reviews SET complaint_status = $1 WHERE wb_review_id = $2", [status, fb.id]);
          if (status === "approved") {
            await clearComplaintPausePg(account.id);
          }
          pendingMap.delete(fb.id);
          updated++;
          log(`  ${fb.id}: ${status}`);
        }
      }

      nextCursor = data.data?.pages?.next || "";
      if (!nextCursor) break;
      await new Promise(r => setTimeout(r, 150));
    }

    log(`  Status sync: ${updated} updated, ${pendingMap.size} still pending`);
    return;
  }

  const pending = db.prepare("SELECT id, wb_review_id, review_id FROM review_complaints WHERE account_id = ? AND status = 'submitted'").all(account.id);
  if (pending.length === 0) return;

  log(`  Checking ${pending.length} pending complaint statuses...`);
  const headers = buildHeaders(account);
  const pendingMap = new Map(pending.map(p => [p.wb_review_id, p]));
  let updated = 0;

  // Paginate through feedbacks using pages.next cursor
  let nextCursor = "";
  for (let page = 0; page < 30 && pendingMap.size > 0; page++) {
    const cursorParam = nextCursor ? `cursor=${encodeURIComponent(nextCursor)}` : "cursor=";
    const url = `https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v2/feedbacks?${cursorParam}&isAnswered=true&limit=100&sortOrder=dateDesc`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res || !res.ok) break;

    const data = await res.json().catch(() => null);
    if (!data || data.error) break;
    const feedbacks = data.data?.feedbacks || [];
    if (feedbacks.length === 0) break;

    for (const fb of feedbacks) {
      if (!pendingMap.has(fb.id)) continue;
      const status = fb.supplierComplaints?.feedbackComplaint?.status;
      if (status === 'approved' || status === 'rejected') {
        const complaint = pendingMap.get(fb.id);
        db.prepare("UPDATE review_complaints SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, complaint.id);
        db.prepare("UPDATE reviews SET complaint_status = ? WHERE wb_review_id = ?").run(status, fb.id);
        pendingMap.delete(fb.id);
        updated++;
        log(`  ${fb.id}: ${status}`);
      }
    }

    nextCursor = data.data?.pages?.next || "";
    if (!nextCursor) break;
    await new Promise(r => setTimeout(r, 150));
  }

  log(`  Status sync: ${updated} updated, ${pendingMap.size} still pending`);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  log("=== Auto-complaints started ===");

  const db = USE_PG ? null : getDb();
  if (db) initComplaintsTable(db);

  const accounts = await getAutoComplaintAccounts(db);
  if (accounts.length === 0) {
    log("No accounts with auto_complaints enabled");
    if (db) db.close();
    if (pgPool) await pgPool.end();
    return;
  }

  const stmtInsert = db ? db.prepare(`
    INSERT INTO review_complaints (review_id, account_id, wb_review_id, complaint_reason_id, explanation, manager_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `) : null;
  const stmtSubmitted = db ? db.prepare(`
    UPDATE review_complaints SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?
  `) : null;
  const stmtError = db ? db.prepare(`
    UPDATE review_complaints SET status = 'error', error_message = ? WHERE id = ?
  `) : null;
  const stmtReviewStatus = db ? db.prepare(`
    UPDATE reviews SET complaint_status = ? WHERE id = ?
  `) : null;

  // Часовое окно подачи по МСК: 18, 19, 20 (анализ показал лучшую конверсию).
  const mskHour = (new Date().getUTCHours() + 3) % 24;
  const ALLOWED_HOURS = [18, 19, 20];
  if (!ALLOWED_HOURS.includes(mskHour)) {
    log(`Outside submission window (${mskHour}:00 МСК, allowed ${ALLOWED_HOURS.join(',')}). Only syncing statuses.`);
  }

  for (const account of accounts) {
    log(`Processing account: ${account.name} (id=${account.id})`);

    // Sync statuses of previously submitted complaints
    try {
      await syncComplaintStatuses(db, account);
    } catch (e) {
      log(`  Status sync error: ${e.message}`);
    }

    // Если вне окна — только синк статусов, новых жалоб не подаём
    if (!ALLOWED_HOURS.includes(mskHour)) continue;

    if (USE_PG) {
      const activePause = await getActiveComplaintPausePg(account.id);
      if (activePause) {
        log(`  Автожалобы на паузе до ${activePause.paused_until}: ${activePause.reason || "без причины"}`);
        continue;
      }
    }

    const config = getComplaintsConfig(account);
    const todayCount = await getTodayCount(db, account.id);
    const remaining = Math.max(0, config.daily_limit - todayCount);

    if (remaining === 0) {
      log(`  Daily limit reached (${config.daily_limit}), skipping`);
      continue;
    }

    // Эффективность-чек: если свежие последние 5 обработанных WB за 24 часа все rejected → явная пауза на 24 часа.
    // Исторические rejected не должны держать вечный стоп.
    const recent = USE_PG
      ? await getRecentComplaintStatusesPg(account.id)
      : db.prepare(`
        SELECT status FROM review_complaints
        WHERE account_id = ? AND status IN ('approved','rejected')
          AND COALESCE(resolved_at, submitted_at, created_at) >= datetime('now', '-24 hours')
        ORDER BY COALESCE(resolved_at, submitted_at) DESC
        LIMIT 5
      `).all(account.id);
    const approved = recent.filter(r => r.status === 'approved').length;
    const rejected = recent.filter(r => r.status === 'rejected').length;
    if (recent.length >= COMPLAINT_PAUSE_LAST_N && approved === 0) {
      if (USE_PG) {
        await setComplaintPausePg(account.id, {
          pause: true,
          rejected,
          approved,
          total: recent.length,
          windowHours: COMPLAINT_PAUSE_WINDOW_HOURS,
        });
      }
      log(`  Эффективность нулевая: свежие последние ${COMPLAINT_PAUSE_LAST_N} отклонены за ${COMPLAINT_PAUSE_WINDOW_HOURS} ч. Пауза на ${COMPLAINT_PAUSE_HOURS} ч.`);
      continue;
    }
    if (recent.length > 0) {
      log(`  Recent ${recent.length}/${COMPLAINT_PAUSE_WINDOW_HOURS}h: approved=${approved}, rejected=${rejected}`);
    }

    const excludedArticles = config.excluded_articles
      ? config.excluded_articles.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
      : [];

    const reviews = USE_PG
      ? await getEligibleReviewsPg(account.id, config.ratings, excludedArticles)
      : getEligibleReviews(db, account.id, config.ratings, excludedArticles);
    const toSubmit = reviews.slice(0, remaining);

    log(`  Eligible: ${reviews.length}, today used: ${todayCount}/${config.daily_limit}, will submit: ${toSubmit.length}`);

    let submitted = 0;
    let errors = 0;

    for (const review of toSubmit) {
      const available = await fetchAvailableComplaintReasons(account, review.wb_review_id);
      const textReasons = available.ok ? getTextComplaintReasons(available.reasons, config.allowed_reasons) : [];
      if (!available.ok || textReasons.length === 0) {
        const complaintId = USE_PG
          ? await insertComplaintPg(review.id, account.id, review.wb_review_id, 0, "", "")
          : stmtInsert.run(review.id, account.id, review.wb_review_id, 0, "", "").lastInsertRowid;
        const errMsg = available.ok
          ? reasonErrorMessage(review.wb_review_id, available.reasons, config.allowed_reasons)
          : `WB reasons HTTP ${available.status}: ${available.body.slice(0, 200)}`;
        if (USE_PG) {
          await markComplaintErrorPg(complaintId, errMsg);
          await updateReviewComplaintStatusPg(review.id, "error");
        } else {
          stmtError.run(errMsg, complaintId);
          stmtReviewStatus.run("error", review.id);
        }
        errors++;
        log(`  ERROR on review ${review.wb_review_id}: ${errMsg}`);
        continue;
      }
      const reasonIds = textReasons.map(reason => reason.id);

      // Pick random manager
      const managers = config.managers && config.managers.length > 0 ? config.managers : [{ name: "Default", style: "" }];
      const manager = managers[Math.floor(Math.random() * managers.length)];
      const previousText = USE_PG
        ? await getLastComplaintTextPg(account.id, manager.name)
        : db.prepare("SELECT explanation FROM review_complaints WHERE account_id = ? AND manager_name = ? AND explanation IS NOT NULL ORDER BY id DESC LIMIT 1").get(account.id, manager.name);

      // AI selects reason + generates complaint text
      const ai = await generateComplaint(review, reasonIds, config, manager, previousText?.explanation || null);
      if (!ai) {
        log(`  AI failed for ${review.wb_review_id}, skipping`);
        continue;
      }
      let { reason_id: reasonId, explanation } = ai;
      if (!reasonIds.includes(reasonId)) reasonId = defaultReasonId(reasonIds);
      log(`  [${manager.name}] ${review.wb_review_id}: reason=${reasonId}, text="${(explanation || "").slice(0, 80)}..."`);

      const complaintId = USE_PG
        ? await insertComplaintPg(review.id, account.id, review.wb_review_id, reasonId, explanation, manager.name)
        : stmtInsert.run(review.id, account.id, review.wb_review_id, reasonId, explanation, manager.name).lastInsertRowid;

      try {
        const res = await submitComplaint(account, review.wb_review_id, reasonId, explanation);

        if (res.ok) {
          if (USE_PG) {
            await markComplaintSubmittedPg(complaintId);
            await updateReviewComplaintStatusPg(review.id, "submitted");
          } else {
            stmtSubmitted.run(complaintId);
            stmtReviewStatus.run("submitted", review.id);
          }
          submitted++;
        } else {
          const errMsg = `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
          if (USE_PG) {
            await markComplaintErrorPg(complaintId, errMsg);
          } else {
            stmtError.run(errMsg, complaintId);
          }
          errors++;
          log(`  ERROR on review ${review.wb_review_id}: ${errMsg}`);

          // Stop on auth errors
          if (res.status === 401 || res.status === 403) {
            log(`  Auth error, stopping for this account`);
            break;
          }
        }
      } catch (e) {
        if (USE_PG) {
          await markComplaintErrorPg(complaintId, e.message);
        } else {
          stmtError.run(e.message, complaintId);
        }
        errors++;
        log(`  EXCEPTION on review ${review.wb_review_id}: ${e.message}`);
      }

      // Random delay between requests
      if (toSubmit.indexOf(review) < toSubmit.length - 1) {
        const delayMs = (config.delay_min_minutes + Math.random() * (config.delay_max_minutes - config.delay_min_minutes)) * 60 * 1000;
        const delayMin = (delayMs / 60000).toFixed(1);
        log(`  Waiting ${delayMin} min before next complaint...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    log(`  Done: submitted=${submitted}, errors=${errors}`);
  }

  log("=== Auto-complaints finished ===");
  if (db) db.close();
  if (pgPool) await pgPool.end();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
