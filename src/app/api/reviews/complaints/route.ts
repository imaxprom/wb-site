import { NextRequest, NextResponse } from "next/server";
import {
  getReviewAccountById,
  getReviewAccounts,
  getReviewById,
  getReviewsForAutoComplaint,
  createComplaint,
  updateComplaintStatus,
  updateComplaintContent,
  updateReviewComplaintStatus,
  getComplaintsByAccount,
  getComplaintByReviewId,
  getTodayComplaintsCount,
  getLastComplaintByManager,
  type ReviewAccount,
} from "@/lib/reviews-db";

export const maxDuration = 300;

const WB_COMPLAINTS_URL =
  "https://seller-reviews.wildberries.ru/ns/fa-seller-api/reviews-ext-seller-portal/api/v1/feedbacks/complaints";

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

function getComplaintsConfig(account: ReviewAccount): ComplaintsConfig {
  const defaults: ComplaintsConfig = {
    ratings: [1, 2],
    allowed_reasons: [11, 13, 16, 20],
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
  16: "Нецензурная лексика",
  18: "Отзыв с политическим контекстом",
  20: "Угрозы, оскорбления",
  19: "Другое",
};

interface AiComplaintResult {
  reason_id: number;
  explanation: string;
}

const DEFAULT_SYSTEM_PROMPT = "Ты — сотрудник бренда IMSI (женское нижнее бельё) на Wildberries. Ты составляешь обращения к модератору по отзывам покупателей. Пиши как живой человек. Отвечай только JSON.";

const DEFAULT_USER_PROMPT = `Составь обращение к модератору Wildberries по отзыву покупателя.

Отзыв:
- Товар: {product_name} (арт. {product_article})
- Оценка: {rating}/5
- Текст: {review_text}
- Фото/видео от покупателя: нет

Категории обращения (выбери одну):
{reasons_list}

Правила:
- НЕ используй фразы: «голословный», «добросовестный продавец», «просим модератора рассмотреть», «принять решение об удалении», «вводит в заблуждение», «наносит ущерб репутации», «на всех этапах», «бездоказательный», «потенциальных покупателей», «репутационный ущерб»
- Реагируй на содержание конкретного отзыва, а не по шаблону:
  * отзыв пустой → отсутствие содержания, нарушение правил площадки
  * есть текст но нет фото → нет подтверждения заявленному
  * эмоциональный отзыв → субъективная оценка без конкретики
  * претензия к размеру/качеству → неправильный подбор размера, несоблюдение рекомендаций по уходу

Ответ — строго JSON, одной строкой:
{"reason_id": <число>, "explanation": "<текст обращения>"}`;

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

  // Add manager personality + previous text
  if (options?.manager) {
    prompt += `\n\n---\nПиши в стиле менеджера ${options.manager.name}: ${options.manager.style}`;
    if (options.previousText) {
      prompt += `\n\nТвоё предыдущее обращение (НЕ повторяй структуру, формулировки и порядок аргументов):\n"${options.previousText.slice(0, 500)}"`;
    }
  }

  const { spawn } = await import("child_process");
  return new Promise((resolve) => {
    // Claude CLI на wb-site недоступен (RU IP). Идём через SSH на .106 (tinyproxy Germany).
    // ВАЖНО: SSH склеивает remote-аргументы в shell-команду. sysPrompt может содержать
    // скобки, кавычки — экранируем в одинарные кавычки.
    const esc = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
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
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", (err: Error) => {
      console.error("AI spawn error:", err.message);
      resolve(null);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.on("close", (code: number) => {
      if (code !== 0) {
        console.error("AI exit code:", code, stderr);
        resolve(null);
        return;
      }
      try {
        const text = stdout.trim();
        const jsonMatch = text.match(/\{[\s\S]*"reason_id"[\s\S]*"explanation"[\s\S]*\}/);
        if (!jsonMatch) { console.error("AI no JSON found in:", text); resolve(null); return; }
        const parsed = JSON.parse(jsonMatch[0]) as AiComplaintResult;
        if (!allowedReasons.includes(parsed.reason_id)) {
          parsed.reason_id = allowedReasons[0];
        }
        resolve(parsed);
      } catch {
        console.error("AI JSON parse failed:", stdout);
        resolve(null);
      }
    });
  });
}

function buildHeaders(account: ReviewAccount): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Origin": "https://seller.wildberries.ru",
  };
  if (account.wb_authorize_v3) headers["Authorizev3"] = account.wb_authorize_v3;
  if (account.wb_validation_key) {
    headers["Cookie"] = `wbx-validation-key=${account.wb_validation_key}; x-supplier-id-external=e0334427-4f82-4bc3-a0ab-43394e58b6ac`;
  }
  return headers;
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

// ─── POST: Submit complaint(s) ─────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();

    // Mode 1: Auto-submit for an account
    if (json.auto && json.account_id) {
      const account = getReviewAccountById(json.account_id);
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
      if (!account.wb_authorize_v3) return NextResponse.json({ error: "Cabinet tokens not configured" }, { status: 400 });

      const config = getComplaintsConfig(account);
      const todayCount = getTodayComplaintsCount(account.id);
      const remaining = Math.max(0, config.daily_limit - todayCount);
      if (remaining === 0) return NextResponse.json({ submitted: 0, message: "Daily limit reached" });

      const excludedArticles = config.excluded_articles
        ? config.excluded_articles.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean)
        : [];

      const reviews = getReviewsForAutoComplaint(account.id, config.ratings, excludedArticles);
      const toSubmit = reviews.slice(0, remaining);

      let submitted = 0;
      let errors = 0;

      for (const review of toSubmit) {
        // Pick random manager
        const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
        const manager = managers[Math.floor(Math.random() * managers.length)];
        const previousText = getLastComplaintByManager(account.id, manager.name);

        const ai = await generateComplaint(review, config.allowed_reasons, {
          system_prompt: config.system_prompt,
          user_prompt: config.user_prompt,
          manager,
          previousText,
        });
        if (!ai) continue;
        const { reason_id: reasonId, explanation } = ai;

        const complaintId = createComplaint({
          review_id: review.id,
          account_id: account.id,
          wb_review_id: review.wb_review_id!,
          complaint_reason_id: reasonId,
          explanation,
          manager_name: manager.name,
        });

        const result = await submitComplaintToWB(account, review.wb_review_id!, reasonId, explanation);

        if (result.ok) {
          updateComplaintStatus(complaintId, "submitted");
          updateReviewComplaintStatus(review.id, "submitted");
          submitted++;
        } else {
          updateComplaintStatus(complaintId, "error", `HTTP ${result.status}: ${result.body}`);
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
      const existing = getComplaintByReviewId(reviewId);
      if (existing && existing.status !== "error") {
        return NextResponse.json({ error: "Complaint already submitted" }, { status: 400 });
      }

      const review = getReviewById(reviewId);
      if (!review || !review.wb_review_id) {
        return NextResponse.json({ error: "Review not found" }, { status: 404 });
      }

      const account = getReviewAccountById(review.account_id);
      if (!account || !account.wb_authorize_v3) {
        return NextResponse.json({ error: "Cabinet tokens not configured for this account" }, { status: 400 });
      }

      // Dry-run остаётся синхронным — быстрый предпросмотр AI
      if (json.dry_run) {
        const config = getComplaintsConfig(account);
        const reasons = json.reason_id ? [json.reason_id] : config.allowed_reasons;
        const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
        const manager = managers[Math.floor(Math.random() * managers.length)];
        const previousText = getLastComplaintByManager(account.id, manager.name);
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

      // Создаём pending-запись сразу
      const complaintId = createComplaint({
        review_id: review.id,
        account_id: account.id,
        wb_review_id: review.wb_review_id,
        complaint_reason_id: json.reason_id || 0,
        explanation: json.explanation || "",
        manager_name: "",
      });
      updateReviewComplaintStatus(review.id, "pending");

      // Запускаем обработку на фоне (не await). Клиент сразу получает 202.
      // Внутри — вызов Claude (долгий) + отправка на WB + обновление БД.
      (async () => {
        try {
          const config = getComplaintsConfig(account);
          let reasonId = json.reason_id;
          let explanation = json.explanation;
          let managerName = "";

          if (!reasonId || !explanation) {
            const reasons = json.reason_id ? [json.reason_id] : config.allowed_reasons;
            const managers = config.managers?.length ? config.managers : [{ name: "Default", style: "" }];
            const manager = managers[Math.floor(Math.random() * managers.length)];
            const previousText = getLastComplaintByManager(account.id, manager.name);
            const ai = await generateComplaint(review, reasons, {
              system_prompt: config.system_prompt,
              user_prompt: config.user_prompt,
              manager,
              previousText,
            });
            if (!ai) {
              updateComplaintStatus(complaintId, "error", "AI generation failed");
              updateReviewComplaintStatus(review.id, "error");
              return;
            }
            reasonId = reasonId || ai.reason_id;
            explanation = explanation || ai.explanation;
            managerName = manager.name;
            updateComplaintContent(complaintId, reasonId, explanation, managerName);
          }

          const result = await submitComplaintToWB(account, review.wb_review_id!, reasonId, explanation);
          if (result.ok) {
            updateComplaintStatus(complaintId, "submitted");
            updateReviewComplaintStatus(review.id, "submitted");
          } else {
            updateComplaintStatus(complaintId, "error", `HTTP ${result.status}: ${result.body}`);
            updateReviewComplaintStatus(review.id, "error");
          }
        } catch (err: unknown) {
          updateComplaintStatus(complaintId, "error", (err as Error).message);
          updateReviewComplaintStatus(review.id, "error");
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
  const accounts = getReviewAccounts().filter(a => a.wb_authorize_v3);
  let totalUpdated = 0;

  for (const account of accounts) {
    const pending = getComplaintsByAccount(account.id, "submitted");
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
          updateComplaintStatus(complaint.id, status);
          updateReviewComplaintStatus(complaint.review_id, status);
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
  try {
    const sp = req.nextUrl.searchParams;
    const shouldSync = sp.get("sync") === "true";
    const accountId = sp.get("account_id") ? Number(sp.get("account_id")) : undefined;
    const status = sp.get("status") || undefined;

    if (shouldSync) {
      await syncComplaintStatuses();
    }

    const complaints = getComplaintsByAccount(accountId, status);
    return NextResponse.json({ complaints });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
