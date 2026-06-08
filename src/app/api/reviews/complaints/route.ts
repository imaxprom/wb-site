import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import fs from "fs";
import path from "path";
import {
  getReviewAccountByIdPg,
  getReviewAccountsPg,
  getReviewByIdPg,
  getReviewsForAutoComplaintPg,
  createComplaintPg,
  updateComplaintStatusPg,
  updateComplaintContentPg,
  updateReviewComplaintStatusPg,
  getComplaintsByAccountPg,
  getComplaintByReviewIdPg,
  getTodayComplaintsCountPg,
  getLastComplaintByManagerPg,
  shouldPauseByRecentRejectionsPg,
  type ReviewAccount,
  type Review,
  type ReviewComplaint,
} from "@/lib/reviews-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

export const maxDuration = 300;

const WB_COMPLAINTS_URL =
  "https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v1/feedbacks/complaints";
const CODEX_GATEWAY_ENV_PATH = path.join(process.cwd(), "data", "codex-gateway.env");

interface Manager {
  name: string;
  style: string;
}

interface ComplaintsConfig {
  ratings: number[];
  allowed_reasons: number[];
  excluded_articles: string;
  daily_limit: number;
  delay_min_minutes: number;
  delay_max_minutes: number;
  system_prompt: string;
  user_prompt: string;
  managers: Manager[];
}

function randomDelay(minMin: number, maxMin: number): number {
  return (minMin + Math.random() * (maxMin - minMin)) * 60 * 1000;
}

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key) env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
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

async function readReviewAccountById(id: number): Promise<ReviewAccount | null> {
  return await getReviewAccountByIdPg(id);
}

async function readReviewAccountsWithCabinetTokens(): Promise<ReviewAccount[]> {
  const accounts = await getReviewAccountsPg();
  return accounts.filter(a => a.wb_authorize_v3);
}

async function readReviewById(id: number): Promise<Review | null> {
  return await getReviewByIdPg(id);
}

async function readComplaintByReviewId(reviewId: number): Promise<ReviewComplaint | null> {
  return await getComplaintByReviewIdPg(reviewId);
}

async function readTodayComplaintsCount(accountId: number): Promise<number> {
  return await getTodayComplaintsCountPg(accountId);
}

async function readReviewsForAutoComplaint(accountId: number, ratings: number[], excludedArticles: string[]): Promise<Review[]> {
  return await getReviewsForAutoComplaintPg(accountId, ratings, excludedArticles);
}

async function readLastComplaintByManager(accountId: number, managerName: string): Promise<string | null> {
  return await getLastComplaintByManagerPg(accountId, managerName);
}

async function readPauseByRecentRejections(accountId: number, lastN: number): Promise<{ pause: boolean; rejected: number; approved: number }> {
  return await shouldPauseByRecentRejectionsPg(accountId, lastN);
}

async function writeComplaint(data: {
  review_id: number;
  account_id: number;
  wb_review_id: string;
  complaint_reason_id: number;
  explanation?: string;
  manager_name?: string;
}): Promise<number> {
  return await createComplaintPg(data);
}

async function writeComplaintStatus(id: number, status: string, errorMessage?: string): Promise<void> {
  await updateComplaintStatusPg(id, status, errorMessage);
}

async function writeComplaintContent(id: number, reasonId: number, explanation: string, managerName: string): Promise<void> {
  await updateComplaintContentPg(id, reasonId, explanation, managerName);
}

async function writeReviewComplaintStatus(reviewId: number, complaintStatus: string): Promise<void> {
  await updateReviewComplaintStatusPg(reviewId, complaintStatus);
}

function getComplaintsConfig(account: ReviewAccount): ComplaintsConfig {
  const defaults: ComplaintsConfig = {
    ratings: [1, 2],
    allowed_reasons: [11, 16, 13, 12, 20, 18, 19],
    excluded_articles: "",
    daily_limit: 50,
    delay_min_minutes: 1,
    delay_max_minutes: 10,
    system_prompt: "",
    user_prompt: "",
    managers: [],
  };
  try {
    const settings = account.settings_json ? JSON.parse(account.settings_json) : {};
    return { ...defaults, ...settings.auto_complaints_config };
  } catch {
    return defaults;
  }
}

const COMPLAINT_REASONS: Record<number, string> = {
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

interface AiComplaintResult {
  reason_id: number;
  explanation: string;
}

interface AvailableComplaintReason {
  id: number;
  label: string;
  explanationRequired: boolean;
}

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

function buildPrompt(
  template: string,
  review: { review_text?: string | null; pros?: string | null; cons?: string | null; product_name?: string | null; product_article?: string | null; rating?: number },
  allowedReasons: number[],
): string {
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

function normalizeExplanation(value: unknown): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 1000) return text;
  return text.slice(0, 1000).replace(/\s+\S*$/, "").trim();
}

function defaultReasonId(reasonIds: number[]): number {
  return reasonIds.includes(19) ? 19 : reasonIds[0];
}

interface GenerateOptions {
  system_prompt?: string;
  user_prompt?: string;
  manager?: Manager;
  previousText?: string | null;
}

async function generateComplaint(
  review: { review_text?: string | null; pros?: string | null; cons?: string | null; product_name?: string | null; product_article?: string | null; rating?: number },
  allowedReasons: number[],
  options?: GenerateOptions,
): Promise<AiComplaintResult & { manager_name?: string } | null> {
  const sysPrompt = options?.system_prompt || DEFAULT_SYSTEM_PROMPT;
  const userTemplate = options?.user_prompt || DEFAULT_USER_PROMPT;
  let prompt = buildPrompt(userTemplate, review, allowedReasons);
  prompt += "\n\nТехническое ограничение WB: поле explanation должно быть обычным текстом 600-1000 символов. Не используй поле text.";

  // Add manager personality + previous text
  if (options?.manager) {
    prompt += `\n\n---\nПиши в стиле менеджера ${options.manager.name}: ${options.manager.style}`;
    if (options.previousText) {
      prompt += `\n\nТвоё предыдущее обращение (НЕ повторяй структуру, формулировки и порядок аргументов):\n"${options.previousText.slice(0, 500)}"`;
    }
  }

  const gateway = getCodexGatewayConfig();
  if (!gateway.token) {
    console.error("AI generation failed: CODEX_GATEWAY_TOKEN is not configured");
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
      console.error("AI gateway HTTP error:", res.status, body.slice(0, 300));
      return null;
    }

    const completion = JSON.parse(body);
    const text = String(completion?.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*"reason_id"[\s\S]*"explanation"[\s\S]*\}/);
    if (!jsonMatch) { console.error("AI no JSON found in:", text); return null; }
    const parsed = JSON.parse(jsonMatch[0]) as AiComplaintResult;
    if (!allowedReasons.includes(parsed.reason_id)) {
      parsed.reason_id = defaultReasonId(allowedReasons);
    }
    parsed.explanation = normalizeExplanation(parsed.explanation);
    return parsed;
  } catch (err) {
    console.error("AI gateway/JSON error:", err);
    return null;
  }
}

function buildHeaders(account: ReviewAccount): Record<string, string> {
  const headers: Record<string, string> = {
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

function getSupplierUuid(account: ReviewAccount): string {
  if (!account.wb_seller_lk) return "";
  try {
    const payload = JSON.parse(Buffer.from(account.wb_seller_lk.split(".")[1] || "", "base64url").toString("utf-8"));
    return String(payload?.data?.["Z-Sid"] || "");
  } catch {
    return "";
  }
}

async function submitComplaintToWB(
  account: ReviewAccount,
  wbReviewId: string,
  reasonId: number,
  explanation?: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const headers = buildHeaders(account);
  const body: Record<string, unknown> = {
    feedbackId: wbReviewId,
    feedbackComplaint: {
      id: reasonId,
      ...(explanation ? { explanation } : {}),
    },
  };

  const res = await fetch(WB_COMPLAINTS_URL, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");

  // WB returns 200 even on auth errors — check body for "error": true
  let wbOk = res.ok;
  if (wbOk && text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.error === true) {
        wbOk = false;
      }
    } catch { /* not JSON, treat as ok */ }
  }

  return { ok: wbOk, status: res.status, body: text };
}

async function fetchAvailableComplaintReasons(
  account: ReviewAccount,
  wbReviewId: string,
): Promise<{ ok: boolean; status: number; body: string; reasons: AvailableComplaintReason[] }> {
  const res = await fetch(`${WB_COMPLAINTS_URL}/${encodeURIComponent(wbReviewId)}`, {
    method: "GET",
    headers: buildHeaders(account),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text().catch(() => "");
  let reasons: AvailableComplaintReason[] = [];
  let ok = res.ok;

  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.error === true) ok = false;
      const rawReasons = parsed?.data?.feedbackComplaints;
      if (Array.isArray(rawReasons)) {
        reasons = rawReasons
          .map((item: Record<string, unknown>) => ({
            id: Number(item.id),
            label: String(item.label || COMPLAINT_REASONS[Number(item.id)] || ""),
            explanationRequired: Boolean(item.explanationRequired),
          }))
          .filter((item: AvailableComplaintReason) => Number.isFinite(item.id));
      }
    } catch {
      ok = false;
    }
  }

  return { ok, status: res.status, body, reasons };
}

function getTextComplaintReasons(
  availableReasons: AvailableComplaintReason[],
  preferredReasonIds: number[],
): AvailableComplaintReason[] {
  const withText = availableReasons.filter((reason) => reason.explanationRequired);
  const byId = new Map(withText.map((reason) => [reason.id, reason]));
  const preferred = preferredReasonIds
    .map((id) => byId.get(id))
    .filter((reason): reason is AvailableComplaintReason => Boolean(reason));
  return preferred.length ? preferred : withText;
}

function reasonErrorMessage(
  wbReviewId: string,
  availableReasons: AvailableComplaintReason[],
  preferredReasonIds: number[],
): string {
  if (availableReasons.length === 0) {
    return `WB не вернул доступные причины жалобы для отзыва ${wbReviewId}`;
  }
  const available = availableReasons.map((reason) => `${reason.id}:${reason.label || "без названия"}${reason.explanationRequired ? "" : " (без текста)"}`).join(", ");
  return `Для отзыва ${wbReviewId} WB не принимает текстовое пояснение по настроенным причинам [${preferredReasonIds.join(", ")}]. Доступно: ${available}`;
}

// ─── POST: Submit complaint(s) ─────────────────────────────

export async function POST(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review complaint writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const json = await req.json();

    // Mode 1: Auto-submit for an account
    if (json.auto && json.account_id) {
      const account = await readReviewAccountById(json.account_id);
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
      if (!account.wb_authorize_v3) return NextResponse.json({ error: "Cabinet tokens not configured" }, { status: 400 });

      const config = getComplaintsConfig(account);
      const todayCount = await readTodayComplaintsCount(account.id);
      const remaining = Math.max(0, config.daily_limit - todayCount);
      if (remaining === 0) return NextResponse.json({ submitted: 0, message: "Daily limit reached" });

      const excludedArticles = config.excluded_articles
        ? config.excluded_articles.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean)
        : [];

      const reviews = await readReviewsForAutoComplaint(account.id, config.ratings, excludedArticles);
      const toSubmit = reviews.slice(0, remaining);

      let submitted = 0;
      let errors = 0;

      for (const review of toSubmit) {
        const available = await fetchAvailableComplaintReasons(account, review.wb_review_id!);
        const textReasons = available.ok ? getTextComplaintReasons(available.reasons, config.allowed_reasons) : [];
        if (!available.ok || textReasons.length === 0) {
          const complaintId = await writeComplaint({
            review_id: review.id,
            account_id: account.id,
            wb_review_id: review.wb_review_id!,
            complaint_reason_id: 0,
            explanation: "",
            manager_name: "",
          });
          await writeComplaintStatus(complaintId, "error", available.ok
            ? reasonErrorMessage(review.wb_review_id!, available.reasons, config.allowed_reasons)
            : `WB reasons HTTP ${available.status}: ${available.body}`);
          await writeReviewComplaintStatus(review.id, "error");
          errors++;
          continue;
        }

        // Pick random manager
        const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
        const manager = managers[Math.floor(Math.random() * managers.length)];
        const previousText = await readLastComplaintByManager(account.id, manager.name);
        const reasonIds = textReasons.map((reason) => reason.id);

        const ai = await generateComplaint(review, reasonIds, {
          system_prompt: config.system_prompt,
          user_prompt: config.user_prompt,
          manager,
          previousText,
        });
        if (!ai) continue;
        let { reason_id: reasonId, explanation } = ai;
        if (!reasonIds.includes(reasonId)) reasonId = defaultReasonId(reasonIds);

        const complaintId = await writeComplaint({
          review_id: review.id,
          account_id: account.id,
          wb_review_id: review.wb_review_id!,
          complaint_reason_id: reasonId,
          explanation,
          manager_name: manager.name,
        });

        const result = await submitComplaintToWB(account, review.wb_review_id!, reasonId, explanation);

        if (result.ok) {
          await writeComplaintStatus(complaintId, "submitted");
          await writeReviewComplaintStatus(review.id, "submitted");
          submitted++;
        } else {
          await writeComplaintStatus(complaintId, "error", `HTTP ${result.status}: ${result.body}`);
          errors++;
        }

        if (toSubmit.indexOf(review) < toSubmit.length - 1) {
          await new Promise(r => setTimeout(r, randomDelay(config.delay_min_minutes, config.delay_max_minutes)));
        }
      }

      return NextResponse.json({ submitted, errors, total_eligible: reviews.length });
    }

    // Mode 2: Manual single complaint — АСИНХРОННЫЙ flow (202 Accepted + polling)
    if (json.review_id) {
      const reviewId = Number(json.review_id);
      const existing = await readComplaintByReviewId(reviewId);
      if (existing && existing.status !== "error") {
        return NextResponse.json({ error: "Complaint already submitted" }, { status: 400 });
      }

      const review = await readReviewById(reviewId);
      if (!review || !review.wb_review_id) {
        return NextResponse.json({ error: "Review not found" }, { status: 404 });
      }

      const account = await readReviewAccountById(review.account_id);
      if (!account || !account.wb_authorize_v3) {
        return NextResponse.json({ error: "Cabinet tokens not configured for this account" }, { status: 400 });
      }

      // Эффективность-чек: если последние 5 обработанных — все rejected,
      // даём пользователю знать и не даём подать. Обходится ручной отменой или после нового approved.
      if (!json.dry_run && !json.force) {
        const eff = await readPauseByRecentRejections(account.id, 5);
        if (eff.pause) {
          return NextResponse.json({
            error: `Пауза: последние 5 жалоб все отклонены WB. Проверь настройки промпта/менеджеров. Передай force=true чтобы подать принудительно.`,
            paused: true,
            stats: eff,
          }, { status: 429 });
        }
      }

      // Dry-run остаётся синхронным — быстрый предпросмотр AI
      if (json.dry_run) {
        const config = getComplaintsConfig(account);
        const preferredReasons = json.reason_id ? [Number(json.reason_id)] : config.allowed_reasons;
        const available = await fetchAvailableComplaintReasons(account, review.wb_review_id);
        if (!available.ok) {
          return NextResponse.json({ error: `WB reasons HTTP ${available.status}: ${available.body}` }, { status: 502 });
        }
        const textReasons = getTextComplaintReasons(available.reasons, preferredReasons);
        if (textReasons.length === 0) {
          return NextResponse.json({ error: reasonErrorMessage(review.wb_review_id, available.reasons, preferredReasons) }, { status: 400 });
        }
        const reasons = textReasons.map((reason) => reason.id);
        const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
        const manager = managers[Math.floor(Math.random() * managers.length)];
        const previousText = await readLastComplaintByManager(account.id, manager.name);
        const ai = await generateComplaint(review, reasons, {
          system_prompt: config.system_prompt,
          user_prompt: config.user_prompt,
          manager,
          previousText,
        });
        if (!ai) return NextResponse.json({ error: "AI generation failed" }, { status: 502 });
        return NextResponse.json({
          ok: true, dry_run: true,
          reason_id: ai.reason_id,
          reason_label: COMPLAINT_REASONS[ai.reason_id] || "Неизвестно",
          explanation: ai.explanation,
          review: {
            wb_review_id: review.wb_review_id,
            product_name: review.product_name,
            product_article: review.product_article,
            rating: review.rating,
            review_text: review.review_text,
          },
        });
      }

      const config = getComplaintsConfig(account);
      const preferredReasons = json.reason_id ? [Number(json.reason_id)] : config.allowed_reasons;
      const available = await fetchAvailableComplaintReasons(account, review.wb_review_id);
      if (!available.ok) {
        return NextResponse.json({ error: `WB reasons HTTP ${available.status}: ${available.body}` }, { status: 502 });
      }
      const textReasons = getTextComplaintReasons(available.reasons, preferredReasons);
      if (textReasons.length === 0) {
        return NextResponse.json({ error: reasonErrorMessage(review.wb_review_id, available.reasons, preferredReasons) }, { status: 400 });
      }
      const reasonIds = textReasons.map((reason) => reason.id);

      // Создаём pending-запись сразу
      const complaintId = await writeComplaint({
        review_id: review.id,
        account_id: account.id,
        wb_review_id: review.wb_review_id,
        complaint_reason_id: reasonIds.includes(Number(json.reason_id)) ? Number(json.reason_id) : defaultReasonId(reasonIds),
        explanation: json.explanation || "",
        manager_name: "",
      });
      await writeReviewComplaintStatus(review.id, "pending");

      // Запускаем обработку на фоне (не await). Клиент сразу получает 202.
      // Внутри — вызов Codex gateway (с retry) + отправка на WB (с retry) + обновление БД.
      (async () => {
        const MAX_TRIES = 3;
        const RETRY_DELAY_MS = 15000;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        try {
          let reasonId = reasonIds.includes(Number(json.reason_id)) ? Number(json.reason_id) : undefined;
          let explanation = json.explanation;
          let managerName = "";

          if (!reasonId || !explanation) {
            const reasons = reasonId ? [reasonId] : reasonIds;
            const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
            const manager = managers[Math.floor(Math.random() * managers.length)];
            const previousText = await readLastComplaintByManager(account.id, manager.name);

            // Retry AI generation: Codex gateway can be slow while spawning codex exec.
            let ai = null;
            let lastError = "";
            for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
              ai = await generateComplaint(review, reasons, {
                system_prompt: config.system_prompt,
                user_prompt: config.user_prompt,
                manager,
                previousText,
              });
              if (ai) break;
              lastError = `attempt ${attempt}/${MAX_TRIES} failed`;
              console.log(`[complaint ${complaintId}] AI ${lastError}`);
              if (attempt < MAX_TRIES) await sleep(RETRY_DELAY_MS);
            }
            if (!ai) {
              await writeComplaintStatus(complaintId, "error", `AI generation failed after ${MAX_TRIES} attempts`);
              await writeReviewComplaintStatus(review.id, "error");
              return;
            }
            reasonId = reasonId || ai.reason_id;
            if (!reasonIds.includes(reasonId)) reasonId = defaultReasonId(reasonIds);
            explanation = explanation || ai.explanation;
            managerName = manager.name;
            await writeComplaintContent(complaintId, reasonId, explanation, managerName);
          }
          if (!reasonId) reasonId = defaultReasonId(reasonIds);

          // Retry WB submit: API может вернуть 5xx или timeout
          let wbResult: { ok: boolean; status: number; body: string } | null = null;
          for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
            wbResult = await submitComplaintToWB(account, review.wb_review_id!, reasonId, explanation);
            if (wbResult.ok) break;
            // 4xx — клиентская ошибка, retry не поможет; 5xx / timeout — повторяем
            if (wbResult.status >= 400 && wbResult.status < 500) break;
            console.log(`[complaint ${complaintId}] WB attempt ${attempt}/${MAX_TRIES}: HTTP ${wbResult.status}`);
            if (attempt < MAX_TRIES) await sleep(RETRY_DELAY_MS);
          }

          if (wbResult?.ok) {
            await writeComplaintStatus(complaintId, "submitted");
            await writeReviewComplaintStatus(review.id, "submitted");
          } else {
            await writeComplaintStatus(complaintId, "error", `HTTP ${wbResult?.status}: ${wbResult?.body}`);
            await writeReviewComplaintStatus(review.id, "error");
          }
        } catch (err: unknown) {
          await writeComplaintStatus(complaintId, "error", (err as Error).message);
          await writeReviewComplaintStatus(review.id, "error");
        }
      })();

      return NextResponse.json(
        { ok: true, complaint_id: complaintId, status: "pending" },
        { status: 202 }
      );
    }

    return NextResponse.json({ error: "Missing review_id or auto+account_id" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ─── Sync complaint statuses from WB ───────────────────────

async function syncComplaintStatuses(): Promise<number> {
  const accounts = await readReviewAccountsWithCabinetTokens();
  let totalUpdated = 0;

  for (const account of accounts) {
    const pending = await getComplaintsByAccountPg(account.id, "submitted");
    if (pending.length === 0) continue;

    const headers = buildHeaders(account);
    const pendingMap = new Map(pending.map(p => [p.wb_review_id, p]));

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
        if (status === "approved" || status === "rejected") {
          const complaint = pendingMap.get(fb.id)!;
          await writeComplaintStatus(complaint.id, status);
          await writeReviewComplaintStatus(complaint.review_id, status);
          pendingMap.delete(fb.id);
          totalUpdated++;
        }
      }

      nextCursor = data.data?.pages?.next || "";
      if (!nextCursor) break;
    }
  }

  return totalUpdated;
}

// ─── GET: Complaints history + sync ────────────────────────

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const sp = req.nextUrl.searchParams;
    const shouldSync = sp.get("sync") === "true";
    const accountId = sp.get("account_id") ? Number(sp.get("account_id")) : undefined;
    const status = sp.get("status") || undefined;

    if (shouldSync && isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review complaint status sync is disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    if (shouldSync) {
      await syncComplaintStatuses();
    }

    const complaints = await getComplaintsByAccountPg(accountId, status);
    return NextResponse.json({ complaints });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
