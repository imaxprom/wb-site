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

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const LOG_PATH = path.join(PROJECT_DIR, "data", "reviews-complaints.log");

const WB_COMPLAINTS_URL =
  "https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v1/feedbacks/complaints";

// ─── Logging ────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

// ─── DB helpers ─────────────────────────────────────────────

function getDb() {
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma("journal_mode = WAL");
  return db;
}

function initComplaintsTable(db) {
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

function getTodayCount(db, accountId) {
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM review_complaints
    WHERE account_id = ? AND date(created_at) = date('now')
  `).get(accountId);
  return row.cnt;
}

// ─── AI text generation via Claude Code CLI ────────────────

const COMPLAINT_REASONS = {
  11: "Отзыв не относится к товару",
  12: "Отзыв оставили конкуренты",
  13: "Спам-реклама в тексте",
  16: "Нецензурная лексика",
  18: "Отзыв с политическим контекстом",
  20: "Угрозы, оскорбления",
  19: "Другое",
};

const DEFAULT_SYSTEM_PROMPT = (
  "Ты — сотрудник бренда IMSI (женское нижнее бельё) на Wildberries. " +
  "Составляешь обращения к модератору по необъективным отзывам. " +
  "Пиши как живой человек, без шаблонов и канцелярита. " +
  "Длина обращения — СТРОГО от 1000 до 1500 символов. " +
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
- ОБЯЗАТЕЛЬНО 1000–1500 символов (меньше — отклонят, больше — потеряют суть)
- Упомяни артикул товара
- 7–9 предложений
- НЕ используй фразы: «голословный», «добросовестный продавец», «просим модератора рассмотреть», «принять решение об удалении», «вводит в заблуждение», «наносит ущерб репутации», «на всех этапах», «бездоказательный», «потенциальных покупателей», «репутационный ущерб»
- Не используй длинные тире
- Реагируй на конкретное содержание отзыва, а не по шаблону

Ответ — строго JSON одной строкой:
{"reason_id": <число>, "explanation": "<текст 1000-1500 символов>"}`;

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

function generateComplaint(review, allowedReasons, config, manager, previousText) {
  return new Promise((resolve) => {
    const sysPrompt = (config && config.system_prompt) || DEFAULT_SYSTEM_PROMPT;
    const userTemplate = (config && config.user_prompt) || DEFAULT_USER_PROMPT;
    let prompt = buildPrompt(userTemplate, review, allowedReasons);

    if (manager && manager.style) {
      prompt += `\n\n---\nПиши в стиле менеджера ${manager.name}: ${manager.style}`;
      if (previousText) {
        prompt += `\n\nТвоё предыдущее обращение (НЕ повторяй структуру, формулировки и порядок аргументов):\n"${previousText.slice(0, 500)}"`;
      }
    }

    const { spawn } = require("child_process");
    // Claude CLI на wb-site недоступен (RU IP блокируется Anthropic).
    // Идём через SSH на claude-cli VM (.106), где настроен tinyproxy через Germany.
    // Скрипт ~/claude-proxy.sh принимает prompt из stdin + system prompt как $1.
    const esc = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
    const proc = spawn("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "UserKnownHostsFile=/home/makson/.ssh/known_hosts",
      "-o", "StrictHostKeyChecking=accept-new",
      "-i", "/home/makson/.ssh/id_ed25519",
      "makson@192.168.55.106",
      `bash /home/makson/claude-proxy.sh ${esc(sysPrompt)}`,
    ], {
      timeout: 120000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.on("close", (code) => {
      if (code !== 0) {
        log(`  AI generation failed: ${stderr || `exit code ${code}`}`);
        resolve(null);
        return;
      }
      try {
        const text = stdout.trim();
        const jsonMatch = text.match(/\{[\s\S]*"reason_id"[\s\S]*"explanation"[\s\S]*\}/);
        if (!jsonMatch) { log(`  AI no JSON found in output`); resolve(null); return; }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!allowedReasons.includes(parsed.reason_id)) {
          parsed.reason_id = allowedReasons[0];
        }
        resolve(parsed);
      } catch (e) {
        log(`  AI JSON parse failed: ${e.message}`);
        resolve(null);
      }
    });
  });
}

// ─── WB API ─────────────────────────────────────────────────

function buildHeaders(account) {
  const headers = {
    "Content-Type": "application/json",
    "Origin": "https://seller.wildberries.ru",
  };
  if (account.wb_authorize_v3) headers["Authorizev3"] = account.wb_authorize_v3;
  if (account.wb_validation_key) {
    headers["Cookie"] = `wbx-validation-key=${account.wb_validation_key}; x-supplier-id-external=e0334427-4f82-4bc3-a0ab-43394e58b6ac`;
  }
  return headers;
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

// ─── Sync complaint statuses from WB ────────────────────────

async function syncComplaintStatuses(db, account) {
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

  const db = getDb();
  initComplaintsTable(db);

  const accounts = getAutoComplaintAccounts(db);
  if (accounts.length === 0) {
    log("No accounts with auto_complaints enabled");
    db.close();
    return;
  }

  const stmtInsert = db.prepare(`
    INSERT INTO review_complaints (review_id, account_id, wb_review_id, complaint_reason_id, explanation, manager_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const stmtSubmitted = db.prepare(`
    UPDATE review_complaints SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  const stmtError = db.prepare(`
    UPDATE review_complaints SET status = 'error', error_message = ? WHERE id = ?
  `);
  const stmtReviewStatus = db.prepare(`
    UPDATE reviews SET complaint_status = ? WHERE id = ?
  `);

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

    const config = getComplaintsConfig(account);
    const todayCount = getTodayCount(db, account.id);
    const remaining = Math.max(0, config.daily_limit - todayCount);

    if (remaining === 0) {
      log(`  Daily limit reached (${config.daily_limit}), skipping`);
      continue;
    }

    // Эффективность-чек: если последние 5 обработанных WB — все rejected → пауза до завтра
    const recent = db.prepare(`
      SELECT status FROM review_complaints
      WHERE account_id = ? AND status IN ('approved','rejected')
      ORDER BY COALESCE(resolved_at, submitted_at) DESC
      LIMIT 5
    `).all(account.id);
    const approved = recent.filter(r => r.status === 'approved').length;
    const rejected = recent.filter(r => r.status === 'rejected').length;
    if (recent.length >= 5 && approved === 0) {
      log(`  Эффективность нулевая: последние 5 отклонены. Пауза до завтра.`);
      continue;
    }
    if (recent.length > 0) {
      log(`  Recent 5: approved=${approved}, rejected=${rejected}`);
    }

    const excludedArticles = config.excluded_articles
      ? config.excluded_articles.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
      : [];

    const reviews = getEligibleReviews(db, account.id, config.ratings, excludedArticles);
    const toSubmit = reviews.slice(0, remaining);

    log(`  Eligible: ${reviews.length}, today used: ${todayCount}/${config.daily_limit}, will submit: ${toSubmit.length}`);

    let submitted = 0;
    let errors = 0;

    for (const review of toSubmit) {
      // Pick random manager
      const managers = config.managers && config.managers.length > 0 ? config.managers : [{ name: "Default", style: "" }];
      const manager = managers[Math.floor(Math.random() * managers.length)];
      const previousText = db.prepare("SELECT explanation FROM review_complaints WHERE account_id = ? AND manager_name = ? AND explanation IS NOT NULL ORDER BY id DESC LIMIT 1").get(account.id, manager.name);

      // AI selects reason + generates complaint text
      const ai = await generateComplaint(review, config.allowed_reasons, config, manager, previousText?.explanation || null);
      if (!ai) {
        log(`  AI failed for ${review.wb_review_id}, skipping`);
        continue;
      }
      const { reason_id: reasonId, explanation } = ai;
      log(`  [${manager.name}] ${review.wb_review_id}: reason=${reasonId}, text="${(explanation || "").slice(0, 80)}..."`);

      const result = stmtInsert.run(review.id, account.id, review.wb_review_id, reasonId, explanation, manager.name);
      const complaintId = result.lastInsertRowid;

      try {
        const res = await submitComplaint(account, review.wb_review_id, reasonId, explanation);

        if (res.ok) {
          stmtSubmitted.run(complaintId);
          stmtReviewStatus.run("submitted", review.id);
          submitted++;
        } else {
          const errMsg = `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
          stmtError.run(errMsg, complaintId);
          errors++;
          log(`  ERROR on review ${review.wb_review_id}: ${errMsg}`);

          // Stop on auth errors
          if (res.status === 401 || res.status === 403) {
            log(`  Auth error, stopping for this account`);
            break;
          }
        }
      } catch (e) {
        stmtError.run(e.message, complaintId);
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
  db.close();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
