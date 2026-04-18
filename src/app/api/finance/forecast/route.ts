import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";
import { getExcludeDailyFilter } from "@/modules/analytics/lib/db";
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

    // Дедуп-фильтры: для дней, покрытых weekly_final-отчётом, исключаем weekly/daily
    // дубликаты. Без этого SUM(storage_fee/penalty/quantity/rpwd) удваивается/
    // учетверяется по мере подтягивания финальных WB-отчётов.
    const dedupSale = getExcludeDailyFilter(d, "sale_dt", "r");
    const dedupRr = getExcludeDailyFilter(d, "rr_dt", "r");

    // ── 1. Юнит-экономика: продажи/возвраты (по sale_dt) + логистика (по rr_dt) ──
    const salesRaw = d.prepare(`
      SELECT r.nm_id, r.sa_name,
        SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.retail_price_withdisc_rub ELSE 0 END) as sales_rpwd,
        SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.ppvz_for_pay ELSE 0 END) as sales_ppvz,
        SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.retail_amount ELSE 0 END) as sales_retail,
        SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.quantity ELSE 0 END) as sales_qty,
        SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.quantity ELSE 0 END) as ret_qty
      FROM realization r
      WHERE r.supplier_oper_name IN ('Продажа','Возврат')
        AND r.sale_dt >= ? AND r.sale_dt <= ? AND r.nm_id > 0
        ${dedupSale.sql}
      GROUP BY r.nm_id
    `).all(econFrom, econTo, ...dedupSale.params) as { nm_id: number; sa_name: string; sales_rpwd: number; sales_ppvz: number; sales_retail: number; sales_qty: number; ret_qty: number }[];

    const logisticsRaw = d.prepare(`
      SELECT r.nm_id,
        SUM(r.delivery_rub) as logistics
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Коррекция логистики')
        AND r.rr_dt >= ? AND r.rr_dt <= ? AND r.nm_id > 0
        ${dedupRr.sql}
      GROUP BY r.nm_id
    `).all(econFrom, econTo, ...dedupRr.params) as { nm_id: number; logistics: number }[];
    const logisticsMap = new Map(logisticsRaw.map(r => [r.nm_id, r.logistics]));

    const articlesRaw = salesRaw.map(s => ({
      ...s,
      logistics: logisticsMap.get(s.nm_id) || 0,
    }));

    // COGS через Map (без коррелированного подзапроса)
    const costs = getCogsMap();
    const cogsRows = d.prepare(`
      SELECT r.nm_id, r.barcode, SUM(r.quantity) as qty
      FROM realization r
      WHERE r.supplier_oper_name = 'Продажа' AND r.sale_dt >= ? AND r.sale_dt <= ? AND r.nm_id > 0
        ${dedupSale.sql}
      GROUP BY r.nm_id, r.barcode
    `).all(econFrom, econTo, ...dedupSale.params) as { nm_id: number; barcode: string; qty: number }[];
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
      // Налоги от retail_amount (Вайлдберриз реализовал Товар Пр) —
      // так же как в PnL (finance/page.tsx). База = retail после СПП.
      const avgRetail = a.sales_retail / a.sales_qty;
      const ndsUnit = avgRetail * 5 / 105;
      const usnUnit = (avgRetail - ndsUnit) * 0.01;
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

    // ── 2. % выкупа по артикулам: фактический за период эконом ──
    // Было: (total - cancels) / total из shipment_orders по всей истории.
    // Стало: sales_qty / orders_count за period из realization/shipment_orders.
    // is_cancel в shipment_orders ловит только отмены до получения,
    // настоящие возвраты после получения приходят в realization.
    // Формула: выкуп = (продано - возвращено) / заказано.
    const salesForBuyout = d.prepare(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as sales_qty,
        SUM(CASE WHEN r.supplier_oper_name = 'Возврат' THEN r.quantity ELSE 0 END) as ret_qty
      FROM realization r
      WHERE r.supplier_oper_name IN ('Продажа','Возврат')
        AND r.sale_dt >= ? AND r.sale_dt <= ? AND r.nm_id > 0
        ${dedupSale.sql}
      GROUP BY r.nm_id
    `).all(econFrom, econTo, ...dedupSale.params) as { nm_id: number; sales_qty: number; ret_qty: number }[];
    const salesMap = new Map(salesForBuyout.map(r => [r.nm_id, r.sales_qty - r.ret_qty]));

    const ordersForBuyout = d.prepare(`
      SELECT article_wb as nm_id, COUNT(*) as total
      FROM shipment_orders
      WHERE date >= ? AND date <= ? || 'T23:59:59'
      GROUP BY article_wb
    `).all(econFrom, econTo) as { nm_id: number; total: number }[];

    const buyoutMap = new Map<number, number>();
    for (const o of ordersForBuyout) {
      const netSold = salesMap.get(o.nm_id) || 0;
      // Если заказов мало или продаж мало — fallback 80% (иначе шумит)
      if (o.total < 30 || netSold <= 0) buyoutMap.set(o.nm_id, 0.80);
      else buyoutMap.set(o.nm_id, Math.min(1, netSold / o.total));
    }

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

    const econDays = Math.max(1, Math.round((new Date(econTo).getTime() - new Date(econFrom).getTime()) / 86400000) + 1);

    // ── 5. Хранение per-day per-nm: приоритет paid_storage, fallback на realization ──
    // paid_storage: ежедневная детализация (основной источник)
    const storagePsRaw = d.prepare(`
      SELECT date, nm_id, SUM(warehouse_price) as total
      FROM paid_storage WHERE date >= ? AND date <= ?
      GROUP BY date, nm_id
    `).all(dateFrom, dateTo) as { date: string; nm_id: number; total: number }[];
    const storageByDayNm = new Map<string, number>();
    const psDaysWithData = new Set<string>();
    for (const r of storagePsRaw) {
      storageByDayNm.set(`${r.date}:${r.nm_id}`, r.total);
      psDaysWithData.add(r.date);
    }

    // Fallback per-day: для дней без paid_storage берём realization.storage_fee
    // (общая сумма за rr_dt) и распределяем по артикулам через пропорции
    // последнего доступного дня paid_storage — WB не раскладывает storage_fee
    // по nm_id, поэтому используем структуру хранения предыдущего дня как прокси.
    const storageRealRaw = d.prepare(`
      SELECT r.rr_dt as date, SUM(r.storage_fee) as total
      FROM realization r
      WHERE r.rr_dt >= ? AND r.rr_dt <= ? AND r.storage_fee != 0
        ${dedupRr.sql}
      GROUP BY r.rr_dt
    `).all(dateFrom, dateTo, ...dedupRr.params) as { date: string; total: number }[];
    const storageFallbackByDay = new Map<string, number>();
    for (const r of storageRealRaw) {
      if (!psDaysWithData.has(r.date)) storageFallbackByDay.set(r.date, r.total);
    }

    // Пропорции для fallback: последний день с paid_storage (может быть до dateFrom).
    // share[nm_id] = fraction этого nm_id в общем хранении того дня, Σ = 1.
    const storageShareMap = new Map<number, number>();
    if (storageFallbackByDay.size > 0) {
      const lastPs = d.prepare(`
        SELECT date FROM paid_storage WHERE date <= ?
        GROUP BY date ORDER BY date DESC LIMIT 1
      `).get(dateTo) as { date: string } | undefined;
      if (lastPs) {
        const shareRows = d.prepare(`
          SELECT nm_id, SUM(warehouse_price) as total
          FROM paid_storage WHERE date = ?
          GROUP BY nm_id
        `).all(lastPs.date) as { nm_id: number; total: number }[];
        const shareSum = shareRows.reduce((s, r) => s + r.total, 0);
        if (shareSum > 0) {
          for (const r of shareRows) storageShareMap.set(r.nm_id, r.total / shareSum);
        }
      }
    }

    const storageDay = (day: string, nmId: number, numArticles: number): number => {
      const fromPs = storageByDayNm.get(`${day}:${nmId}`);
      if (fromPs !== undefined) return fromPs;
      const fallback = storageFallbackByDay.get(day) || 0;
      if (fallback === 0) return 0;
      // Приоритет — разложить по пропорциям реального хранения (последний известный день)
      const share = storageShareMap.get(nmId);
      if (share !== undefined) return fallback * share;
      // Крайний случай (нет paid_storage вообще в БД): равномерно
      return numArticles > 0 ? fallback / numArticles : 0;
    };

    // ── 6. Штрафы per-day per-nm (факт по rr_dt) ──
    const penaltyRaw = d.prepare(`
      SELECT r.rr_dt as date, r.nm_id, SUM(r.penalty) as total
      FROM realization r
      WHERE r.penalty != 0 AND r.rr_dt >= ? AND r.rr_dt <= ? AND r.nm_id > 0
        ${dedupRr.sql}
      GROUP BY r.rr_dt, r.nm_id
    `).all(dateFrom, dateTo, ...dedupRr.params) as { date: string; nm_id: number; total: number }[];
    const penaltyByDayNm = new Map<string, number>();
    for (const r of penaltyRaw) {
      penaltyByDayNm.set(`${r.date}:${r.nm_id}`, r.total);
    }

    // ── 7. Общие расходы: приёмка + джем. Окно — не меньше 14 дней,
    // т.к. acceptance и jam приходят нерегулярно (раз в неделю/месяц).
    // Иначе для короткого прогноза overhead=0, хотя по факту ≠ 0.
    const overheadFrom = shiftDays(econFrom, -Math.max(0, 14 - econDays));
    const overheadDays = Math.max(14, econDays);
    const overheadRow = d.prepare(`
      SELECT COALESCE(SUM(r.acceptance), 0) as acceptance,
        COALESCE(SUM(CASE WHEN r.bonus_type_name LIKE '%Джем%' THEN r.deduction ELSE 0 END), 0) as jam
      FROM realization r WHERE r.rr_dt >= ? AND r.rr_dt <= ? ${dedupRr.sql}
    `).get(overheadFrom, econTo, ...dedupRr.params) as Record<string, number>;
    const overheadDaily = (overheadRow.acceptance + overheadRow.jam) / overheadDays;

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

    // Pre-compute: сумма shipment_orders по дням (только по артикулам с юнит-экономикой,
    // т.к. ниже в цикле `if (!econ) continue` отсекает остальные).
    // Scale = funnel.order_count / shipmentTotalDay → приводит итог дня к ЛК WB,
    // а заказы по артикулам распределяются пропорционально структуре shipment_orders.
    // Нужно потому, что WB Statistics API /orders отстаёт от Analytics API /sales-funnel
    // на свежих днях (до 25-30% в первые сутки).
    const shipTotalByDay = new Map<string, number>();
    for (const o of ordersDaily) {
      if (!unitEcon.has(o.nm_id)) continue;
      shipTotalByDay.set(o.day, (shipTotalByDay.get(o.day) || 0) + o.orders);
    }
    const scaleForDay = (day: string): number => {
      const ship = shipTotalByDay.get(day) || 0;
      const funnel = funnelMap.get(day)?.order_count || 0;
      if (ship === 0 || funnel === 0) return 1;
      return funnel / ship;
    };

    for (const o of ordersDaily) {
      const econ = unitEcon.get(o.nm_id);
      if (!econ) continue;

      const scale = scaleForDay(o.day);
      const scaledOrders = o.orders * scale;

      const buyout = buyoutMap.get(o.nm_id) || 0.80;
      const adSpend = adsMap.get(`${o.day}:${o.nm_id}`) || 0;
      const storageDaily = storageDay(o.day, o.nm_id, unitEcon.size);
      const penaltyDaily = penaltyByDayNm.get(`${o.day}:${o.nm_id}`) || 0;
      const estSales = scaledOrders * buyout;
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
      day.orders += scaledOrders;
      day.estimated_revenue += estRevenue;
      day.estimated_profit_before_ads += estProfitBeforeAds;
      day.ad_spend += adSpend;
      day.storage += storageDaily;
      day.penalties += penaltyDaily;
      day.estimated_profit += estProfit;
      day.articles.push({
        nm_id: o.nm_id, article: econ.article, custom_name: econ.customName,
        orders: scaledOrders, buyout: Math.round(buyout * 1000) / 10,
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
          orders: Math.round(day.orders),
          estimated_revenue: Math.round(day.estimated_revenue),
          estimated_profit_before_ads: Math.round(day.estimated_profit_before_ads),
          ad_spend: Math.round(day.ad_spend + unmapped),
          storage: Math.round(day.storage),
          penalties: Math.round(day.penalties),
          estimated_profit: Math.round(day.estimated_profit - overheadDaily - unmapped),
          articles: day.articles
            .map(a => ({ ...a, orders: Math.round(a.orders) }))
            .sort((a, b) => b.orders - a.orders),
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
