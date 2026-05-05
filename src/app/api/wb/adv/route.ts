import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

function getDb() {
  return new Database(DB_PATH);
}

interface WbAdvCampaign {
  advertId: number;
  campName?: string;
  name?: string;
  type?: number;
  status?: number;
  dailyBudget?: number;
  createTime?: string;
  changeTime?: string;
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
}

interface WbAdvExpense {
  date: string;
  updNum?: number;
  updSum?: number;
  appType?: number;
  nm?: number[];
  sum?: number;
  [key: string]: unknown;
}

/**
 * POST /api/wb/adv — Fetch advertising expenses from WB API and save to DB
 *   Body: { dateFrom?: "YYYY-MM-DD", dateTo?: "YYYY-MM-DD" }
 *   Default: last 7 days
 *
 * GET /api/wb/adv — Get advertising data from local DB
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const dateTo = body.dateTo || now.toISOString().slice(0, 10);
    const dateFrom = body.dateFrom || new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

    // Step 1: Get list of active campaigns
    const campaignsRes = await fetch("https://advert-api.wildberries.ru/adv/v1/promotion/count", {
      headers: { Authorization: apiKey },
    });

    let campaignIds: number[] = [];

    if (campaignsRes.ok) {
      const countData = await campaignsRes.json() as { adverts?: { advert_list?: { advertId: number }[] }[] };
      if (countData.adverts) {
        for (const group of countData.adverts) {
          if (group.advert_list) {
            campaignIds.push(...group.advert_list.map(a => a.advertId));
          }
        }
      }
    }

    // Fallback: get campaigns from /adv/v1/promotion/adverts
    if (campaignIds.length === 0) {
      const listRes = await fetch("https://advert-api.wildberries.ru/adv/v1/promotion/adverts", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify([{ status: 7 }, { status: 9 }, { status: 11 }]),
      });
      if (listRes.ok) {
        const adverts = await listRes.json() as WbAdvCampaign[];
        campaignIds = adverts.map(a => a.advertId).filter(Boolean);
      }
    }

    console.log("[adv] Found campaigns:", campaignIds.length);

    // Step 2: Get expenses for each campaign using full-stat endpoint
    // WB API: POST /adv/v2/fullstats with body = array of campaign IDs (max 100)
    const allExpenses: { date: string; campaignId: number; campaignName: string; amount: number }[] = [];

    // Process in batches of 100
    for (let i = 0; i < campaignIds.length; i += 100) {
      const batch = campaignIds.slice(i, i + 100);

      const statsRes = await fetch("https://advert-api.wildberries.ru/adv/v2/fullstats", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(batch.map(id => ({ id, dates: [dateFrom, dateTo] }))),
      });

      if (statsRes.ok) {
        const stats = await statsRes.json() as { advertId: number; campName?: string; days?: { date: string; sum?: number; expenses?: number }[] }[];
        for (const camp of stats) {
          if (camp.days) {
            for (const day of camp.days) {
              const amount = day.sum ?? day.expenses ?? 0;
              if (amount > 0) {
                allExpenses.push({
                  date: day.date.slice(0, 10),
                  campaignId: camp.advertId,
                  campaignName: camp.campName || `Campaign ${camp.advertId}`,
                  amount,
                });
              }
            }
          }
        }
      } else {
        // Fallback: try individual campaign expense endpoint
        for (const campId of batch) {
          try {
            const expRes = await fetch(
              `https://advert-api.wildberries.ru/adv/v1/upd?id=${campId}&from=${dateFrom}&to=${dateTo}`,
              { headers: { Authorization: apiKey } }
            );
            if (expRes.ok) {
              const expenses = await expRes.json() as WbAdvExpense[];
              for (const exp of expenses) {
                const amount = exp.updSum ?? exp.sum ?? 0;
                if (amount > 0) {
                  allExpenses.push({
                    date: exp.date.slice(0, 10),
                    campaignId: campId,
                    campaignName: `Campaign ${campId}`,
                    amount,
                  });
                }
              }
            }
          } catch { /* skip */ }
        }
      }

      // Rate limit: WB allows ~5 req/sec
      if (i + 100 < campaignIds.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log("[adv] Total expense entries:", allExpenses.length);

    // Step 3: Save to DB (upsert by date + campaign_id)
    const db = getDb();

    const deleteStmt = db.prepare(
      "DELETE FROM advertising WHERE date >= ? AND date <= ?"
    );
    const insertStmt = db.prepare(
      "INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type) VALUES (?, ?, ?, ?, 'Баланс')"
    );

    const upsert = db.transaction(() => {
      deleteStmt.run(dateFrom, dateTo);
      for (const exp of allExpenses) {
        insertStmt.run(exp.date, exp.campaignName, exp.campaignId, exp.amount);
      }
    });
    upsert();
    db.close();

    // Summarize by date
    const byDate: Record<string, number> = {};
    allExpenses.forEach(e => {
      byDate[e.date] = (byDate[e.date] || 0) + e.amount;
    });

    return NextResponse.json({
      ok: true,
      dateFrom,
      dateTo,
      campaigns: campaignIds.length,
      entries: allExpenses.length,
      byDate,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const dateFrom = req.nextUrl.searchParams.get("from") || "2026-03-01";
  const dateTo = req.nextUrl.searchParams.get("to") || "2026-12-31";

  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT date, SUM(amount) as total, COUNT(*) as campaigns FROM advertising WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date"
    ).all(dateFrom, dateTo) as { date: string; total: number; campaigns: number }[];
    db.close();

    return NextResponse.json({ ok: true, data: rows });
  } catch (err) {
    return apiError(err);
  }
}
