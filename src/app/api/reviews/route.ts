import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 600; // 10 minutes for full sync
import {
  getReviews,
  getReviewsCount,
  ensureDefaultAccount,
  getDefaultAccountApiKey,
  upsertReviewsFromWB,
  cleanDemoData,
  setSyncStatusDb,
  getReviewsForEnrichment,
  enrichReviewsByShkId,
  getEnrichedCount,
  type WBFeedback,
} from "@/lib/reviews-db";

const WB_TOKEN_PATH = "/Users/octopus/.openclaw/agents/prince/agent/.wb_token";

const WB_FEEDBACKS_URL =
  "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";

// ─── Sync status (SQLite-backed) ────────────────────────────

/**
 * Read API key: first try DB, then fall back to file and persist to DB.
 */
function resolveApiKey(): string {
  const fromDb = getDefaultAccountApiKey();
  if (fromDb) return fromDb;

  // First run — read from file
  const tokenPath = path.resolve(WB_TOKEN_PATH);
  const token = fs.readFileSync(tokenPath, "utf-8").trim();
  ensureDefaultAccount(token);
  return token;
}


const WB_ORDERS_URL = "https://statistics-api.wildberries.ru/api/v1/supplier/orders";
const WB_STATISTICS_URL = "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";

/**
 * Enrich reviews with price & region from Orders API (realtime, sticker=shk_id),
 * then fill remaining from Statistics API (detail report, 7-10 day delay).
 */
async function enrichFromStatistics(apiKey: string, accountId: number): Promise<number> {
  const reviews = getReviewsForEnrichment(accountId);
  if (reviews.length === 0) return 0;

  setSyncStatusDb({ status: "syncing", message: `Обогащение: загрузка заказов (реалтайм)...` });

  const shkLookup = new Map<number, number>();
  for (const r of reviews) {
    shkLookup.set(r.shk_id, r.id);
  }

  let totalEnriched = 0;
  const fmtN = (n: number) => n.toLocaleString("ru-RU");

  // ── Step 1: Orders API (realtime, last 30 days) ──
  try {
    const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(`${WB_ORDERS_URL}?dateFrom=${dateFrom}`, {
      headers: { Authorization: apiKey },
    });
    if (res.ok) {
      const orders = await res.json();
      if (Array.isArray(orders)) {
        const batch: { shk_id: number; price: number; pickup_point: string }[] = [];
        for (const o of orders) {
          const sticker = Number(o.sticker);
          const price = Math.abs(o.finishedPrice || 0);
          if (sticker && shkLookup.has(sticker) && price > 0) {
            batch.push({
              shk_id: sticker,
              price,
              pickup_point: o.regionName || "",
            });
            shkLookup.delete(sticker);
          }
        }
        if (batch.length > 0) {
          enrichReviewsByShkId(batch);
          totalEnriched += batch.length;
        }
        setSyncStatusDb({
          message: `Обогащение: заказы — ${fmtN(totalEnriched)} совпадений. Загрузка статистики...`,
        });
      }
    }
  } catch { /* continue to statistics */ }

  // ── Step 2: Statistics API (detail report, last 90 days) for remaining ──
  if (shkLookup.size > 0) {
    const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const dateTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    let rrdid = 0;

    for (let page = 0; page < 50; page++) {
      const url = `${WB_STATISTICS_URL}?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=100000&rrdid=${rrdid}`;
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      if (!res.ok) break;

      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;

      const batch: { shk_id: number; price: number; pickup_point: string }[] = [];
      for (const row of rows) {
        if (row.shk_id && shkLookup.has(row.shk_id)) {
          const price = row.retail_amount || row.retail_price_withdisc_rub || 0;
          const pickup = row.ppvz_office_name || "";
          if (price > 0 && pickup) {
            batch.push({ shk_id: row.shk_id, price, pickup_point: pickup });
            shkLookup.delete(row.shk_id);
          }
        }
        if (row.rrd_id > rrdid) rrdid = row.rrd_id;
      }

      if (batch.length > 0) {
        enrichReviewsByShkId(batch);
        totalEnriched += batch.length;
      }

      setSyncStatusDb({
        message: `Обогащение: стр. ${page + 1}, сохранено ${fmtN(totalEnriched)} (цена + ПВЗ)`,
      });

      if (rows.length < 100000 || shkLookup.size === 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return totalEnriched;
}

/**
 * Fetch feedbacks from WB Seller API and upsert into DB.
 * Writes to DB in batches (every 5000) to avoid memory issues and timeouts.
 * fullSync=true — load ALL reviews (first run or explicit full sync).
 * fullSync=false — incremental: only unanswered + last 500 answered.
 */
async function syncFromWB(apiKey: string, accountId: number, fullSync: boolean): Promise<number> {
  setSyncStatusDb({ status: "syncing", loaded: 0, total: 0, message: "Загрузка неотвеченных отзывов..." });

  const dbCount = getReviewsCount(accountId);
  const isIncremental = !fullSync && dbCount > 0;
  const fmtN = (n: number) => n.toLocaleString("ru-RU");

  let totalFetched = 0;
  let batch: WBFeedback[] = [];

  function flushBatch() {
    if (batch.length === 0) return;
    upsertReviewsFromWB(accountId, batch);
    batch = [];
  }

  function addToBatch(feedbacks: WBFeedback[]) {
    batch.push(...feedbacks);
    totalFetched += feedbacks.length;
    if (batch.length >= 5000) flushBatch();
  }

  // 1) Fetch ALL unanswered (both full & incremental)
  for (let skip = 0; ; skip += 100) {
    const url = `${WB_FEEDBACKS_URL}?isAnswered=false&take=100&skip=${skip}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`WB feedbacks API ${res.status}: ${text}`);
    }
    const data = await res.json();
    const feedbacks: WBFeedback[] = data.data?.feedbacks ?? [];
    addToBatch(feedbacks);
    setSyncStatusDb({
      loaded: totalFetched,
      message: isIncremental
        ? `Инкрементальный sync | Неотвеченные: ${fmtN(totalFetched)}`
        : `Загружено: ${fmtN(totalFetched)} (неотвеченные)`,
    });
    if (feedbacks.length < 100) break;
    await new Promise(r => setTimeout(r, 350));
  }

  // 2) Fetch answered
  if (isIncremental) {
    setSyncStatusDb({ message: `Инкрементальный sync | Загрузка последних 500 отвеченных...` });
    const url = `${WB_FEEDBACKS_URL}?isAnswered=true&take=500&skip=0`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      const feedbacks: WBFeedback[] = data.data?.feedbacks ?? [];
      addToBatch(feedbacks);
    }
  } else {
    for (let skip = 0; ; skip += 5000) {
      const url = `${WB_FEEDBACKS_URL}?isAnswered=true&take=5000&skip=${skip}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      const feedbacks: WBFeedback[] = data.data?.feedbacks ?? [];
      addToBatch(feedbacks);
      setSyncStatusDb({
        loaded: totalFetched,
        message: `Загружено и сохранено: ${fmtN(totalFetched)}`,
      });
      if (feedbacks.length < 5000) break;
      await new Promise(r => setTimeout(r, 350));
    }
  }

  // Flush remaining
  flushBatch();

  if (totalFetched > 0) {
    const newDbCount = getReviewsCount(accountId);
    setSyncStatusDb({
      loaded: newDbCount,
      total: newDbCount,
      status: "done",
      message: isIncremental
        ? `Добавлено ${fmtN(Math.max(newDbCount - dbCount, 0))} новых. В базе: ${fmtN(newDbCount)} ✅`
        : `Загружено ${fmtN(newDbCount)} ✅`,
    });
    return totalFetched;
  }

  setSyncStatusDb({ status: "done", loaded: dbCount, total: dbCount, message: `В базе: ${fmtN(dbCount)} ✅` });
  return 0;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const syncParam = sp.get("sync"); // "true" = incremental, "full" = full sync
    const shouldSync = syncParam === "true" || syncParam === "full";
    const fullSync = syncParam === "full";

    // Ensure account + get API key
    const apiKey = resolveApiKey();
    const account = ensureDefaultAccount(apiKey);

    if (shouldSync) {
      cleanDemoData();
      try {
        await syncFromWB(apiKey, account.id, fullSync);
      } catch (e) {
        setSyncStatusDb({ status: "error", message: (e as Error).message });
        throw e;
      }

      // Enrich in background — don't block the response, UI polls sync-status
      enrichFromStatistics(apiKey, account.id).then(() => {
        const fmtN = (n: number) => n.toLocaleString("ru-RU");
        const finalCount = getReviewsCount(account.id);
        const enrichedTotal = getEnrichedCount();
        setSyncStatusDb({
          loaded: finalCount, total: finalCount, status: "done",
          message: enrichedTotal > 0
            ? `В базе: ${fmtN(finalCount)} ✅ | Цена и ПВЗ: ${fmtN(enrichedTotal)}`
            : `В базе: ${fmtN(finalCount)} ✅`,
        });
      }).catch(() => {
        const fmtN = (n: number) => n.toLocaleString("ru-RU");
        const finalCount = getReviewsCount(account.id);
        setSyncStatusDb({ loaded: finalCount, total: finalCount, status: "done", message: `В базе: ${fmtN(finalCount)} ✅` });
      });
    }

    const filters = {
      account_id: sp.get("account_id") ? Number(sp.get("account_id")) : undefined,
      date_from: sp.get("date_from") || undefined,
      date_to: sp.get("date_to") || undefined,
      rating: sp.get("rating") || undefined,
      status: sp.get("status") || undefined,
      complaint_status: sp.get("complaint_status") || undefined,
      is_hidden:
        sp.get("is_hidden") !== null && sp.get("is_hidden") !== ""
          ? Number(sp.get("is_hidden"))
          : undefined,
      is_updated:
        sp.get("is_updated") !== null && sp.get("is_updated") !== ""
          ? Number(sp.get("is_updated"))
          : undefined,
      is_excluded_rating:
        sp.get("is_excluded_rating") !== null && sp.get("is_excluded_rating") !== ""
          ? Number(sp.get("is_excluded_rating"))
          : undefined,
      purchase_type: sp.get("purchase_type") || undefined,
      search_product: sp.get("search_product") || undefined,
      search_article: sp.get("search_article") || undefined,
      search_text: sp.get("search_text") || undefined,
      search_buyer: sp.get("search_buyer") || undefined,
      search_comment: sp.get("search_comment") || undefined,
      wb_review_id: sp.get("wb_review_id") || undefined,
      buyer_chat_id: sp.get("buyer_chat_id") || undefined,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      per_page: sp.get("per_page") ? Number(sp.get("per_page")) : 25,
      sort_by: sp.get("sort_by") || "date",
      sort_dir: (sp.get("sort_dir") as "asc" | "desc") || "desc",
    };

    const result = getReviews(filters);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
