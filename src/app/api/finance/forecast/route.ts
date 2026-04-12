import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";
import { DEFAULT_COGS_PER_UNIT } from "@/lib/constants";

/** Предзагрузка себестоимости в Map (кэш, как в db.ts) */
let forecastCogsMap: Map<string, number> | null = null;
function getCogsMap(): Map<string, number> {
  if (forecastCogsMap) return forecastCogsMap;
  const d = getDb();
  const rows = d.prepare("SELECT barcode, cost FROM cogs").all() as { barcode: string; cost: number }[];
  forecastCogsMap = new Map(rows.map(r => [r.barcode, r.cost]));
  return forecastCogsMap;
}

/**
 * GET /api/finance/forecast?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Прогноз прибыли: заказы × выкуп × юнит-экономика − реклама − хранение − штрафы − overhead.
 *
 * Юнит-экономика берётся за ПРЕДЫДУЩИЙ период (14 дней до dateFrom),
 * чтобы прогноз был честным — не использовал данные из будущего.
 *
 * Заказы, реклама, хранение, штрафы — за запрошенный период (dateFrom–dateTo).
 */

/** Дата минус N дней (без UTC-сдвига) */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "";
  const dateTo = searchParams.get("to") || "";
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  try {
    const d = getDb();

    // Юнит-экономика за тот же период, что и прогноз
    // Для понедельного прогноза (вперёд) берутся предыдущие 14 дней автоматически
    const econFrom = dateFrom;
    const econTo = dateTo;

    // ── 1. Юнит-экономика: один запрос (articles + logistics + names) ──
    const articlesRaw = d.prepare(`
      SELECT nm_id, sa_name,
        SUM(CASE WHEN supplier_oper_name='Продажа' THEN retail_price_withdisc_rub ELSE 0 END) as sales_rpwd,
        SUM(CASE WHEN supplier_oper_name='Продажа' THEN ppvz_for_pay ELSE 0 END) as sales_ppvz,
        SUM(CASE WHEN supplier_oper_name='Продажа' THEN quantity ELSE 0 END) as sales_qty,
        SUM(CASE WHEN supplier_oper_name='Возврат' THEN quantity ELSE 0 END) as ret_qty,
        SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END) as logistics
      FROM realization
      WHERE supplier_oper_name IN ('Продажа','Возврат','Логистика','Коррекция логистики')
        AND ((supplier_oper_name IN ('Продажа','Возврат') AND sale_dt >= ? AND sale_dt <= ?)
          OR (supplier_oper_name IN ('Логистика', 'Коррекция логистики') AND rr_dt >= ? AND rr_dt <= ?))
        AND nm_id > 0
      GROUP BY nm_id
    `).all(econFrom, econTo, econFrom, econTo) as Record<string, number & string>[];

    // COGS через Map (без коррелированного подзапроса)
    const costs = getCogsMap();
    const cogsRows = d.prepare(`
      SELECT nm_id, barcode, SUM(quantity) as qty
      FROM realization
      WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ? AND nm_id > 0
      GROUP BY nm_id, barcode
    `).all(econFrom, econTo) as { nm_id: number; barcode: string; qty: number }[];
    const cogsMap = new Map<number, number>();
    const cogsQtyMap = new Map<number, number>();
    for (const r of cogsRows) {
      const cost = costs.get(r.barcode) || DEFAULT_COGS_PER_UNIT;
      cogsMap.set(r.nm_id, (cogsMap.get(r.nm_id) || 0) + r.qty * cost);
      cogsQtyMap.set(r.nm_id, (cogsQtyMap.get(r.nm_id) || 0) + r.qty);
    }

    // Build unit economics: все составляющие прибыли на штуку
    interface UnitEcon {
      avgPrice: number; cogsUnit: number; logUnit: number;
      commissionUnit: number; taxUnit: number; profitPerUnit: number;
      article: string; customName: string;
    }
    const unitEcon = new Map<number, UnitEcon>();
    for (const a of articlesRaw) {
      const netQty = a.sales_qty - a.ret_qty;
      if (netQty <= 0) continue;
      const avgPrice = a.sales_rpwd / a.sales_qty;
      const avgPpvz = a.sales_ppvz / a.sales_qty;
      const totalCogs = cogsMap.get(a.nm_id) || 0;
      const totalQty = cogsQtyMap.get(a.nm_id) || 0;
      const cogsUnit = totalQty > 0 ? totalCogs / totalQty : DEFAULT_COGS_PER_UNIT;
      const logUnit = a.logistics / netQty;
      const commissionUnit = avgPrice - avgPpvz;
      const ndsUnit = avgPpvz * 5 / 105;
      const usnUnit = (avgPpvz - ndsUnit) * 0.01;
      const taxUnit = ndsUnit + usnUnit;
      const profitPerUnit = avgPrice - cogsUnit - logUnit - commissionUnit - taxUnit;
      unitEcon.set(a.nm_id, { avgPrice, cogsUnit, logUnit, commissionUnit, taxUnit, profitPerUnit, article: String(a.sa_name || ""), customName: "" });
    }

    // Custom names (из product_overrides)
    const customNames = d.prepare(`
      SELECT DISTINCT article_wb, custom_name FROM product_overrides
      WHERE custom_name IS NOT NULL AND custom_name != ''
    `).all() as { article_wb: string; custom_name: string }[];
    for (const cn of customNames) {
      const e = unitEcon.get(Number(cn.article_wb));
      if (e) e.customName = cn.custom_name;
    }

    // ── 2. Исторический % выкупа по артикулам (вся история) ──
    const buyoutRaw = d.prepare(`
      SELECT article_wb as nm_id,
        COUNT(*) as total,
        SUM(CASE WHEN is_cancel = 1 THEN 1 ELSE 0 END) as cancels
      FROM shipment_orders
      GROUP BY article_wb
    `).all() as { nm_id: number; total: number; cancels: number }[];
    const buyoutMap = new Map(buyoutRaw.map(r => [r.nm_id, r.total > 30 ? (r.total - r.cancels) / r.total : 0.80]));

    // ── 3. Заказы за прогнозируемый период ──
    const ordersDaily = d.prepare(`
      SELECT SUBSTR(date, 1, 10) as day, article_wb as nm_id,
        COUNT(*) as orders,
        SUM(price_with_disc) as orders_rub
      FROM shipment_orders
      WHERE date >= ? AND date <= ? || 'T23:59:59'
      GROUP BY day, nm_id
    `).all(dateFrom, dateTo) as { day: string; nm_id: number; orders: number; orders_rub: number }[];

    // ── 3b. Заказы из orders_funnel (точные, как в ЛК WB) ──
    const funnelDaily = d.prepare(`
      SELECT date, order_count, order_sum FROM orders_funnel
      WHERE date >= ? AND date <= ?
    `).all(dateFrom, dateTo) as { date: string; order_count: number; order_sum: number }[];
    const funnelMap = new Map(funnelDaily.map(r => [r.date, r]));

    // ── 4. Реклама за прогнозируемый период (точная, по nm_id) ──
    const adsDaily = d.prepare(`
      SELECT date, nm_id, SUM(amount) as ad_spend
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id > 0
      GROUP BY date, nm_id
    `).all(dateFrom, dateTo) as { date: string; nm_id: number; ad_spend: number }[];
    const adsMap = new Map<string, number>();
    for (const a of adsDaily) {
      adsMap.set(`${a.date}:${a.nm_id}`, a.ad_spend);
    }

    // Нераспределённая реклама (nm_id=0) — добавим к итогу дня
    const adsUnmapped = d.prepare(`
      SELECT date, SUM(amount) as ad_spend
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id = 0
      GROUP BY date
    `).all(dateFrom, dateTo) as { date: string; ad_spend: number }[];
    const adsUnmappedMap = new Map<string, number>();
    for (const a of adsUnmapped) {
      adsUnmappedMap.set(a.date, a.ad_spend);
    }

    // ── 5. Хранение по артикулам (среднедневное из paid_storage) ──
    const storageRaw = d.prepare(`
      SELECT nm_id, SUM(warehouse_price) as total, COUNT(DISTINCT date) as days
      FROM paid_storage
      WHERE date >= ? AND date <= ?
      GROUP BY nm_id
    `).all(dateFrom, dateTo) as { nm_id: number; total: number; days: number }[];
    const storageDailyMap = new Map<number, number>();
    for (const r of storageRaw) {
      storageDailyMap.set(r.nm_id, r.days > 0 ? r.total / r.days : 0);
    }
    // Fallback: если paid_storage пуст, берём из realization (общее хранение / дни / кол-во артикулов)
    if (storageRaw.length === 0) {
      const storageFallback = d.prepare(`
        SELECT SUM(storage_fee) as total FROM realization WHERE rr_dt >= ? AND rr_dt <= ?
      `).get(econFrom, econTo) as Record<string, number>;
      const numArticles = unitEcon.size || 1;
      const fallbackDays = 14;
      const perArticleDaily = (storageFallback.total || 0) / fallbackDays / numArticles;
      for (const nm of unitEcon.keys()) {
        storageDailyMap.set(nm, perArticleDaily);
      }
    }

    // ── 6. Штрафы по артикулам (среднедневные из предыдущего периода) ──
    const penaltyRaw = d.prepare(`
      SELECT nm_id, SUM(penalty) as total
      FROM realization
      WHERE penalty != 0 AND rr_dt >= ? AND rr_dt <= ? AND nm_id > 0
      GROUP BY nm_id
    `).all(econFrom, econTo) as { nm_id: number; total: number }[];
    const econDays = Math.max(1, Math.round((new Date(econTo).getTime() - new Date(econFrom).getTime()) / 86400000) + 1);
    const penaltyDailyMap = new Map<number, number>();
    for (const r of penaltyRaw) {
      penaltyDailyMap.set(r.nm_id, r.total / econDays);
    }

    // ── 7. Общие расходы: приёмка + джем (один запрос) ──
    const overheadRow = d.prepare(`
      SELECT COALESCE(SUM(acceptance), 0) as acceptance,
        COALESCE(SUM(CASE WHEN bonus_type_name LIKE '%Джем%' THEN deduction ELSE 0 END), 0) as jam
      FROM realization WHERE rr_dt >= ? AND rr_dt <= ?
    `).get(econFrom, econTo) as Record<string, number>;
    const overheadDaily = (overheadRow.acceptance + overheadRow.jam) / econDays;

    // ── 8. Сборка: прогноз по дням ──
    interface DayForecast {
      date: string;
      orders: number;
      orders_rub: number;
      estimated_revenue: number;
      estimated_profit_before_ads: number;
      ad_spend: number;
      storage: number;
      penalties: number;
      overhead: number;
      estimated_profit: number;
      articles: ForecastArticle[];
    }
    interface ForecastArticle {
      nm_id: number; article: string; custom_name: string; orders: number; buyout: number;
      avg_price: number; cogs_unit: number; logistics_unit: number;
      commission_unit: number; tax_unit: number; profit_per_unit: number;
      ad_spend: number; storage: number; penalties: number;
      estimated_revenue: number; estimated_profit: number;
    }

    const dayMap = new Map<string, DayForecast>();

    for (const o of ordersDaily) {
      const econ = unitEcon.get(o.nm_id);
      if (!econ) continue;

      const buyout = buyoutMap.get(o.nm_id) || 0.80;
      const adSpend = adsMap.get(`${o.day}:${o.nm_id}`) || 0;
      const storageDaily = storageDailyMap.get(o.nm_id) || 0;
      const penaltyDaily = penaltyDailyMap.get(o.nm_id) || 0;
      const estSales = o.orders * buyout;
      const estRevenue = estSales * econ.avgPrice;
      const estProfitBeforeAds = estSales * econ.profitPerUnit - storageDaily - penaltyDaily;
      const estProfit = estProfitBeforeAds - adSpend;

      if (!dayMap.has(o.day)) {
        // orders_rub берём из orders_funnel (совпадает с ЛК WB)
        const funnel = funnelMap.get(o.day);
        dayMap.set(o.day, {
          date: o.day, orders: 0, orders_rub: funnel?.order_sum || 0,
          estimated_revenue: 0, estimated_profit_before_ads: 0,
          ad_spend: 0, storage: 0, penalties: 0, overhead: Math.round(overheadDaily),
          estimated_profit: 0, articles: [],
        });
      }
      const day = dayMap.get(o.day)!;
      day.orders += o.orders;
      day.estimated_revenue += estRevenue;
      day.estimated_profit_before_ads += estProfitBeforeAds;
      day.ad_spend += adSpend;
      day.storage += storageDaily;
      day.penalties += penaltyDaily;
      day.estimated_profit += estProfit;
      day.articles.push({
        nm_id: o.nm_id, article: econ.article, custom_name: econ.customName,
        orders: o.orders, buyout: Math.round(buyout * 1000) / 10,
        avg_price: Math.round(econ.avgPrice),
        cogs_unit: Math.round(econ.cogsUnit),
        logistics_unit: Math.round(econ.logUnit),
        commission_unit: Math.round(econ.commissionUnit),
        tax_unit: Math.round(econ.taxUnit),
        profit_per_unit: Math.round(econ.profitPerUnit),
        ad_spend: Math.round(adSpend),
        storage: Math.round(storageDaily),
        penalties: Math.round(penaltyDaily),
        estimated_revenue: Math.round(estRevenue),
        estimated_profit: Math.round(estProfit),
      });
    }

    // Sort, subtract overhead, round; добавить нераспределённую рекламу
    const result = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => {
        const unmapped = adsUnmappedMap.get(day.date) || 0;
        return {
          ...day,
          estimated_revenue: Math.round(day.estimated_revenue),
          estimated_profit_before_ads: Math.round(day.estimated_profit_before_ads),
          ad_spend: Math.round(day.ad_spend + unmapped),
          storage: Math.round(day.storage),
          penalties: Math.round(day.penalties),
          estimated_profit: Math.round(day.estimated_profit - overheadDaily - unmapped),
          articles: day.articles.sort((a, b) => b.estimated_profit - a.estimated_profit),
        };
      });

    // Running totals
    let runningProfit = 0;
    let runningRevenue = 0;
    const withRunning = result.map(day => {
      runningProfit += day.estimated_profit;
      runningRevenue += day.estimated_revenue;
      return { ...day, running_profit: runningProfit, running_revenue: runningRevenue };
    });

    // Meta: какой период использован для юнит-экономики
    const meta = { econFrom, econTo, econDays, articlesCount: unitEcon.size };

    return NextResponse.json({ days: withRunning, meta });
  } catch (error) {
    return apiError(error);
  }
}
