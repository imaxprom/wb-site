import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";
import { getExcludeDailyFilter, getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";
import { isPostgresEnabled, pgGet, pgRows } from "@/lib/postgres";

/** Предзагрузка себестоимости в Map на один запрос. */
interface CogsHistoryRow {
  barcode: string;
  cost: number;
  valid_from: string;
  valid_to: string | null;
}

function tableExists(db: ReturnType<typeof getDb>, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function getCogsHistoryMap(): Map<string, CogsHistoryRow[]> {
  const d = getDb();
  const rows = tableExists(d, "cogs_history")
    ? d.prepare(`
        SELECT barcode, cost, valid_from, valid_to
        FROM cogs_history
        ORDER BY barcode, valid_from
      `).all() as CogsHistoryRow[]
    : d.prepare(`
        SELECT barcode, cost, '0000-01-01' AS valid_from, NULL AS valid_to
        FROM cogs
      `).all() as CogsHistoryRow[];

  const cogsHistoryMap = new Map<string, CogsHistoryRow[]>();
  for (const row of rows) {
    const history = cogsHistoryMap.get(row.barcode) || [];
    history.push(row);
    cogsHistoryMap.set(row.barcode, history);
  }
  return cogsHistoryMap;
}

async function getCogsHistoryMapPg(): Promise<Map<string, CogsHistoryRow[]>> {
  const rows = await pgRows<CogsHistoryRow>(`
    SELECT barcode, cost, valid_from, valid_to
    FROM cogs_history
    ORDER BY barcode, valid_from
  `);

  const cogsHistoryMap = new Map<string, CogsHistoryRow[]>();
  for (const row of rows) {
    const history = cogsHistoryMap.get(row.barcode) || [];
    history.push(row);
    cogsHistoryMap.set(row.barcode, history);
  }
  return cogsHistoryMap;
}

function getCostForDate(cogsHistory: Map<string, CogsHistoryRow[]>, barcode: string, date: string): number {
  const history = cogsHistory.get(barcode);
  if (!history || !date) return 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    if (row.valid_from <= date && (!row.valid_to || row.valid_to >= date)) {
      return row.cost;
    }
  }
  return 0;
}

/**
 * GET /api/finance/forecast?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Прогноз прибыли: заказы × выкуп × юнит-экономика − реклама − хранение − штрафы − overhead.
 *
 * Юнит-экономика берётся за запрошенный период. Для артикулов без
 * 100 фактических чистых продаж используется оценка по заказам,
 * среднему выкупу магазина и логистике аналогов по объёму.
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
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "";
  const dateTo = searchParams.get("to") || "";
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  try {
    const pgMode = isPostgresEnabled();
    const d = pgMode ? null : getDb();
    const all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      return pgMode ? await pgRows(sql, params) as T[] : d!.prepare(sql).all(...params) as T[];
    };
    const get = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
      return pgMode ? await pgGet(sql, params) as T | undefined : d!.prepare(sql).get(...params) as T | undefined;
    };

    // Юнит-экономика за тот же период, что и прогноз.
    // Фактическая экономика включается только после 100 чистых продаж,
    // до этого артикул остаётся в оценочном расчёте.
    const econFrom = dateFrom;
    const econTo = dateTo;
    const econDays = Math.max(1, Math.round((new Date(econTo).getTime() - new Date(econFrom).getTime()) / 86400000) + 1);

    // Дедуп-фильтры: для дней, покрытых weekly_final-отчётом, исключаем weekly/daily
    // дубликаты. Без этого SUM(storage_fee/penalty/quantity/rpwd) удваивается/
    // учетверяется по мере подтягивания финальных WB-отчётов.
    const dedupSale = pgMode ? await getPgExcludeDailyFilter("sale_dt", "r") : getExcludeDailyFilter(d!, "sale_dt", "r");
    const dedupRr = pgMode ? await getPgExcludeDailyFilter("rr_dt", "r") : getExcludeDailyFilter(d!, "rr_dt", "r");

    // ── 1. Юнит-экономика: продажи/возвраты (по sale_dt) + логистика (по rr_dt) ──
    const salesRaw = await all<{ nm_id: number; sa_name: string; sales_rpwd: number; sales_ppvz: number; sales_retail: number; sales_qty: number; ret_qty: number }>(`
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
      GROUP BY r.nm_id, r.sa_name
    `, [econFrom, econTo, ...dedupSale.params]);

    const logisticsRaw = await all<{ nm_id: number; logistics: number; deliveries: number }>(`
      SELECT r.nm_id,
        SUM(r.delivery_rub) as logistics,
        SUM(r.delivery_amount) as deliveries
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Коррекция логистики')
        AND r.rr_dt >= ? AND r.rr_dt <= ? AND r.nm_id > 0
        ${dedupRr.sql}
      GROUP BY r.nm_id
    `, [econFrom, econTo, ...dedupRr.params]);
    const logisticsMap = new Map(logisticsRaw.map(r => [r.nm_id, r.logistics]));
    const logisticsUnitMap = new Map(
      logisticsRaw
        .filter(r => r.deliveries > 0)
        .map(r => [r.nm_id, r.logistics / r.deliveries])
    );
    const deliveriesMap = new Map(logisticsRaw.map(r => [r.nm_id, r.deliveries]));

    const articlesRaw = salesRaw.map(s => ({
      ...s,
      logistics: logisticsMap.get(s.nm_id) || 0,
    }));

    // COGS через историю по датам продажи.
    const cogsHistory = pgMode ? await getCogsHistoryMapPg() : getCogsHistoryMap();
    const cogsRows = await all<{ nm_id: number; barcode: string; sale_dt: string; qty: number }>(`
      SELECT r.nm_id, r.barcode, r.sale_dt, SUM(r.quantity) as qty
      FROM realization r
      WHERE r.supplier_oper_name = 'Продажа' AND r.sale_dt >= ? AND r.sale_dt <= ? AND r.nm_id > 0
        ${dedupSale.sql}
      GROUP BY r.nm_id, r.barcode, r.sale_dt
    `, [econFrom, econTo, ...dedupSale.params]);
    const cogsMap = new Map<number, number>();
    const cogsQtyMap = new Map<number, number>();
    for (const r of cogsRows) {
      const cost = getCostForDate(cogsHistory, r.barcode, r.sale_dt);
      cogsMap.set(r.nm_id, (cogsMap.get(r.nm_id) || 0) + r.qty * cost);
      cogsQtyMap.set(r.nm_id, (cogsQtyMap.get(r.nm_id) || 0) + r.qty);
    }

    // Build unit economics: все составляющие прибыли на штуку
    const FACTUAL_MIN_SALES = 100;
    interface UnitEcon {
      avgPrice: number; cogsUnit: number; logUnit: number;
      commissionUnit: number; taxUnit: number; profitPerUnit: number;
      article: string; customName: string; estimated?: boolean;
    }
    const unitEcon = new Map<number, UnitEcon>();
    let baselinePrice = 0;
    let baselineCommission = 0;
    let baselineLogistics = 0;
    let baselineNetQty = 0;

    for (const a of articlesRaw) {
      const netQty = a.sales_qty - a.ret_qty;
      if (netQty <= 0) continue;
      const avgPrice = a.sales_rpwd / a.sales_qty;
      const avgPpvz = a.sales_ppvz / a.sales_qty;
      const totalCogs = cogsMap.get(a.nm_id) || 0;
      const totalQty = cogsQtyMap.get(a.nm_id) || 0;
      const cogsUnit = totalQty > 0 ? totalCogs / totalQty : 0;
      const logUnit = a.logistics / netQty;
      const commissionUnit = avgPrice - avgPpvz;
      // Налоги от retail_amount (Вайлдберриз реализовал Товар Пр) —
      // так же как в PnL (finance/page.tsx). База = retail после СПП.
      const avgRetail = a.sales_retail / a.sales_qty;
      const ndsUnit = avgRetail * 5 / 105;
      const usnUnit = (avgRetail - ndsUnit) * 0.01;
      const taxUnit = ndsUnit + usnUnit;
      const profitPerUnit = avgPrice - cogsUnit - logUnit - commissionUnit - taxUnit;

      baselinePrice += avgPrice * a.sales_qty;
      baselineCommission += commissionUnit * a.sales_qty;
      baselineLogistics += a.logistics;
      baselineNetQty += netQty;

      if (netQty < FACTUAL_MIN_SALES) continue;

      unitEcon.set(a.nm_id, {
        avgPrice,
        cogsUnit,
        logUnit,
        commissionUnit,
        taxUnit,
        profitPerUnit,
        article: String(a.sa_name || ""),
        customName: "",
      });
    }

    // ── 2. % выкупа по артикулам: трёхступенчатый fallback ──
    // Формула унифицирована с /api/data/buyout-rates (раздел Отгрузка):
    //   orders = SUM(delivery_amount) по 'Логистика' из realization
    //   sales  = SUM(quantity) по 'Продажа' из realization
    //   buyout = sales / orders
    // Почему delivery_amount, а не COUNT(shipment_orders): таблица shipment_orders
    // неполная (WB Statistics API отдаёт orders в ограниченном окне
    // lastChangeDate), старые заказы выпадают. realization.delivery_amount —
    // authoritative число фактических доставок от WB.
    //
    // Ступени:
    // 1) За период прогноза — если период >=7 дней и >=30 доставок по nm.
    // 2) За последние 90 дней до dateTo — для свежих/будущих дней и коротких
    //    периодов (где лаг sale_dt vs rr_dt шумит).
    // 3) средний выкуп магазина за последние 30 дней — для совсем новых
    //    артикулов (<30 доставок за 90д).
    const HIST_BUYOUT_DAYS = 90;
    const histFrom = shiftDays(dateTo, -HIST_BUYOUT_DAYS);
    const STORE_FALLBACK_DAYS = 30;
    const storeFallbackFrom = shiftDays(dateTo, -(STORE_FALLBACK_DAYS - 1));

    type BuyoutRow = { nm_id: number; orders: number; sales: number };
    type StoreFallbackRow = { orders: number; sales: number; logistics: number };
    const storeFallback = await get<StoreFallbackRow>(`
      SELECT
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as sales,
        SUM(CASE WHEN r.supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN r.delivery_rub ELSE 0 END) as logistics
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Коррекция логистики', 'Продажа')
        AND r.nm_id > 0 AND r.rr_dt >= ? AND r.rr_dt <= ?
        ${dedupRr.sql}
    `, [storeFallbackFrom, dateTo, ...dedupRr.params]) || { orders: 0, sales: 0, logistics: 0 };
    const storeFallbackBuyout = storeFallback.orders > 0 && storeFallback.sales > 0
      ? Math.min(1, storeFallback.sales / storeFallback.orders)
      : 0.80;
    const storeFallbackLogisticsPerSale = storeFallback.sales > 0
      ? storeFallback.logistics / storeFallback.sales
      : 0;

    const buyoutPeriod = await all<BuyoutRow>(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as sales
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Продажа')
        AND r.nm_id > 0 AND r.rr_dt >= ? AND r.rr_dt <= ?
        ${dedupRr.sql}
      GROUP BY r.nm_id
    `, [econFrom, econTo, ...dedupRr.params]);
    const buyoutPeriodMap = new Map(buyoutPeriod.map(r => [r.nm_id, r]));

    const buyoutHist = await all<BuyoutRow>(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as sales
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Продажа')
        AND r.nm_id > 0 AND r.rr_dt >= ? AND r.rr_dt <= ?
        ${dedupRr.sql}
      GROUP BY r.nm_id
    `, [histFrom, dateTo, ...dedupRr.params]);
    const buyoutHistMap = new Map(buyoutHist.map(r => [r.nm_id, r]));

    const allNmIds = new Set<number>([...buyoutPeriodMap.keys(), ...buyoutHistMap.keys()]);
    const buyoutMap = new Map<number, number>();
    // На коротком периоде (<7 дней) ступень 1 шумит из-за лага sale_dt vs rr_dt.
    const MIN_PERIOD_DAYS = 7;
    const usePeriodBuyout = econDays >= MIN_PERIOD_DAYS;

    for (const nm of allNmIds) {
      // Ступень 1: период прогноза
      if (usePeriodBuyout) {
        const p = buyoutPeriodMap.get(nm);
        if (p && p.orders >= 30 && p.sales > 0) {
          buyoutMap.set(nm, Math.min(1, p.sales / p.orders));
          continue;
        }
      }
      // Ступень 2: исторические 90 дней
      const h = buyoutHistMap.get(nm);
      if (h && h.orders >= 30 && h.sales > 0) {
        buyoutMap.set(nm, Math.min(1, h.sales / h.orders));
        continue;
      }
      // Ступень 3: дефолт
      buyoutMap.set(nm, storeFallbackBuyout);
    }

    // ── 3. Заказы за прогнозируемый период ──
    const ordersDaily = await all<{ day: string; nm_id: number; orders: number; orders_rub: number }>(`
      SELECT SUBSTR(date, 1, 10) as day, article_wb as nm_id,
        COUNT(*) as orders,
        SUM(price_with_disc) as orders_rub
      FROM shipment_orders
      WHERE date >= ? AND date <= ? || 'T23:59:59'
      GROUP BY day, nm_id
    `, [dateFrom, dateTo]);

    // ── 3b. Заказы из orders_funnel (точные, как в ЛК WB) ──
    const funnelDaily = await all<{ date: string; order_count: number; order_sum: number }>(`
      SELECT date, order_count, order_sum FROM orders_funnel
      WHERE date >= ? AND date <= ?
    `, [dateFrom, dateTo]);
    const funnelMap = new Map(funnelDaily.map(r => [r.date, r]));

    // ── 3c. Оценочная юнит-экономика для новых артикулов ──
    // Новые товары уже имеют заказы в shipment_orders, но ещё могут не иметь продаж
    // в realization. Без fallback они пропадают из разворота прогноза, а их заказы
    // размазываются scale-коэффициентом по старым артикулам.
    const fallbackCommissionRate = baselinePrice > 0 ? baselineCommission / baselinePrice : 0.25;
    const fallbackLogUnit = storeFallbackLogisticsPerSale || (baselineNetQty > 0 ? baselineLogistics / baselineNetQty : 0);
    const articleVolumes = await all<{ nm_id: number; volume: number }>(`
      SELECT CAST(article_wb AS INTEGER) as nm_id,
        length_cm * width_cm * height_cm / 1000.0 as volume
      FROM shipment_products
      WHERE length_cm > 0 AND width_cm > 0 AND height_cm > 0
    `);
    const volumeByNm = new Map(articleVolumes.map(r => [r.nm_id, r.volume]));
    const analogLogistics = await all<{ nm_id: number; logistics: number; deliveries: number; sales: number }>(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN r.delivery_rub ELSE 0 END) as logistics,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as deliveries,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as sales
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Коррекция логистики', 'Продажа')
        AND r.nm_id > 0 AND r.rr_dt >= ? AND r.rr_dt <= ?
        ${dedupRr.sql}
      GROUP BY r.nm_id
      HAVING SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) >= 100
    `, [storeFallbackFrom, dateTo, ...dedupRr.params]);
    const MIN_ANALOG_DELIVERIES = 1000;
    const VOLUME_WINDOWS = [0.001, 0.15, 0.5];
    const analogLogisticsPerSale = (nmId: number): number | null => {
      const volume = volumeByNm.get(nmId);
      if (!volume || volume <= 0) return null;

      for (const window of VOLUME_WINDOWS) {
        let logistics = 0;
        let deliveries = 0;
        let sales = 0;
        for (const row of analogLogistics) {
          const rowVolume = volumeByNm.get(row.nm_id);
          if (!rowVolume || Math.abs(rowVolume - volume) > window) continue;
          logistics += row.logistics;
          deliveries += row.deliveries;
          sales += row.sales;
        }
        if (deliveries >= MIN_ANALOG_DELIVERIES && sales > 0) {
          return logistics / sales;
        }
      }
      return null;
    };
    const fallbackOrdersRaw = await all<{
      nm_id: number;
      article: string | null;
      orders: number;
      orders_rub: number;
      tax_base_rub: number;
      cogs_total: number;
      cogs_orders: number;
    }>(`
      SELECT so.article_wb as nm_id,
        MAX(NULLIF(so.article_seller, '')) as article,
        COUNT(*) as orders,
        SUM(so.price_with_disc) as orders_rub,
        SUM(so.finished_price) as tax_base_rub,
        SUM(COALESCE(c.cost, 0)) as cogs_total,
        SUM(CASE WHEN c.cost IS NOT NULL AND c.cost > 0 THEN 1 ELSE 0 END) as cogs_orders
      FROM shipment_orders so
      LEFT JOIN cogs c ON c.barcode = so.barcode
      WHERE so.date >= ? AND so.date <= ? || 'T23:59:59' AND so.article_wb > 0
      GROUP BY so.article_wb
    `, [dateFrom, dateTo]);

    let estimatedFallbackArticlesCount = 0;
    for (const row of fallbackOrdersRaw) {
      if (unitEcon.has(row.nm_id) || row.orders <= 0) continue;

      const avgPrice = row.orders_rub / row.orders;
      const cogsUnit = row.cogs_orders > 0 ? row.cogs_total / row.cogs_orders : 0;
      const directLogUnit = logisticsUnitMap.get(row.nm_id);
      const ownDeliveries = deliveriesMap.get(row.nm_id) || 0;
      const buyout = buyoutMap.get(row.nm_id) || storeFallbackBuyout;
      const ownSales = buyoutPeriodMap.get(row.nm_id)?.sales || 0;
      const directLogisticsPerSale = directLogUnit && directLogUnit > 0 && buyout > 0
        ? directLogUnit / buyout
        : 0;
      const analogLogUnit = analogLogisticsPerSale(row.nm_id);
      const logUnit = ownSales >= 100 && ownDeliveries > 0 && directLogisticsPerSale > 0
        ? directLogisticsPerSale
        : (analogLogUnit ?? fallbackLogUnit);
      const commissionUnit = avgPrice * fallbackCommissionRate;
      const taxBaseUnit = row.tax_base_rub > 0 ? row.tax_base_rub / row.orders : avgPrice;
      const ndsUnit = taxBaseUnit * 5 / 105;
      const usnUnit = (taxBaseUnit - ndsUnit) * 0.01;
      const taxUnit = ndsUnit + usnUnit;
      const profitPerUnit = avgPrice - cogsUnit - logUnit - commissionUnit - taxUnit;

      unitEcon.set(row.nm_id, {
        avgPrice,
        cogsUnit,
        logUnit,
        commissionUnit,
        taxUnit,
        profitPerUnit,
        article: String(row.article || ""),
        customName: "",
        estimated: true,
      });
      estimatedFallbackArticlesCount += 1;
    }

    // Custom names (из product_overrides)
    const customNames = await all<{ article_wb: string; custom_name: string }>(`
      SELECT DISTINCT article_wb, custom_name FROM product_overrides
      WHERE custom_name IS NOT NULL AND custom_name != ''
    `);
    for (const cn of customNames) {
      const e = unitEcon.get(Number(cn.article_wb));
      if (e) e.customName = cn.custom_name;
    }

    // ── 4. Реклама за прогнозируемый период (точная, по nm_id) ──
    const adsDaily = await all<{ date: string; nm_id: number; ad_spend: number }>(`
      SELECT date, nm_id, SUM(amount) as ad_spend
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id > 0
      GROUP BY date, nm_id
    `, [dateFrom, dateTo]);
    const adsMap = new Map<string, number>();
    for (const a of adsDaily) {
      adsMap.set(`${a.date}:${a.nm_id}`, a.ad_spend);
    }

    // Нераспределённая реклама (nm_id=0) — добавим к итогу дня
    const adsUnmapped = await all<{ date: string; ad_spend: number }>(`
      SELECT date, SUM(amount) as ad_spend
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id = 0
      GROUP BY date
    `, [dateFrom, dateTo]);
    const adsUnmappedMap = new Map<string, number>();
    for (const a of adsUnmapped) {
      adsUnmappedMap.set(a.date, a.ad_spend);
    }

    // ── 5. Хранение per-day per-nm: приоритет paid_storage, fallback на realization ──
    // paid_storage: ежедневная детализация (основной источник)
    const storagePsRaw = await all<{ date: string; nm_id: number; total: number }>(`
      SELECT date, nm_id, SUM(warehouse_price) as total
      FROM paid_storage WHERE date >= ? AND date <= ?
      GROUP BY date, nm_id
    `, [dateFrom, dateTo]);
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
    const storageRealRaw = await all<{ date: string; total: number }>(`
      SELECT r.rr_dt as date, SUM(r.storage_fee) as total
      FROM realization r
      WHERE r.rr_dt >= ? AND r.rr_dt <= ? AND r.storage_fee != 0
        ${dedupRr.sql}
      GROUP BY r.rr_dt
    `, [dateFrom, dateTo, ...dedupRr.params]);
    const storageFallbackByDay = new Map<string, number>();
    for (const r of storageRealRaw) {
      if (!psDaysWithData.has(r.date)) storageFallbackByDay.set(r.date, r.total);
    }

    // Пропорции для fallback: последний день с paid_storage (может быть до dateFrom).
    // share[nm_id] = fraction этого nm_id в общем хранении того дня, Σ = 1.
    const storageShareMap = new Map<number, number>();
    if (storageFallbackByDay.size > 0) {
      const lastPs = await get<{ date: string }>(`
        SELECT date FROM paid_storage WHERE date <= ?
        GROUP BY date ORDER BY date DESC LIMIT 1
      `, [dateTo]);
      if (lastPs) {
        const shareRows = await all<{ nm_id: number; total: number }>(`
          SELECT nm_id, SUM(warehouse_price) as total
          FROM paid_storage WHERE date = ?
          GROUP BY nm_id
        `, [lastPs.date]);
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
    const penaltyRaw = await all<{ date: string; nm_id: number; total: number }>(`
      SELECT r.rr_dt as date, r.nm_id, SUM(r.penalty) as total
      FROM realization r
      WHERE r.penalty != 0 AND r.rr_dt >= ? AND r.rr_dt <= ? AND r.nm_id > 0
        ${dedupRr.sql}
      GROUP BY r.rr_dt, r.nm_id
    `, [dateFrom, dateTo, ...dedupRr.params]);
    const penaltyByDayNm = new Map<string, number>();
    for (const r of penaltyRaw) {
      penaltyByDayNm.set(`${r.date}:${r.nm_id}`, r.total);
    }

    // ── 7. Общие расходы: приёмка + джем. Окно — не меньше 14 дней,
    // т.к. acceptance и jam приходят нерегулярно (раз в неделю/месяц).
    // Иначе для короткого прогноза overhead=0, хотя по факту ≠ 0.
    const overheadFrom = shiftDays(econFrom, -Math.max(0, 14 - econDays));
    const overheadDays = Math.max(14, econDays);
    const overheadRow = await get<Record<string, number>>(`
      SELECT COALESCE(SUM(r.acceptance), 0) as acceptance
      FROM realization r WHERE r.rr_dt >= ? AND r.rr_dt <= ? ${dedupRr.sql}
    `, [overheadFrom, econTo, ...dedupRr.params]) || { acceptance: 0 };
    const jamOverheadRow = await get<Record<string, number>>(`
      WITH jam_rows AS (
        SELECT DISTINCT
          bonus_type_name,
          rr_dt,
          deduction,
          source,
          CASE source
            WHEN 'weekly_final' THEN 3
            WHEN 'weekly' THEN 2
            WHEN 'daily' THEN 1
            ELSE 0
          END AS source_rank
        FROM realization
        WHERE bonus_type_name LIKE '%Джем%'
          AND rr_dt >= ?
          AND rr_dt <= ?
      ),
      ranked AS (
        SELECT *,
          MAX(source_rank) OVER (
            PARTITION BY bonus_type_name, rr_dt, deduction
          ) AS max_source_rank
        FROM jam_rows
      )
      SELECT COALESCE(SUM(deduction), 0) AS jam
      FROM ranked
      WHERE source_rank = max_source_rank
    `, [overheadFrom, econTo]) || { jam: 0 };
    const overheadDaily = ((overheadRow.acceptance || 0) + (jamOverheadRow.jam || 0)) / overheadDays;

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
      estimated_revenue: number; estimated_profit: number; estimated?: boolean;
    }

    const dayMap = new Map<string, DayForecast>();

    // Pre-compute: сумма shipment_orders по дням по артикулам с обычной или
    // оценочной юнит-экономикой.
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

      const buyout = buyoutMap.get(o.nm_id) ?? storeFallbackBuyout;
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
        estimated: econ.estimated,
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
    const estimatedArticlesCount = Array.from(unitEcon.values()).filter(e => e.estimated).length;
    const meta = { econFrom, econTo, econDays, articlesCount: unitEcon.size, estimatedArticlesCount, estimatedFallbackArticlesCount };

    return NextResponse.json({ days: withRunning, meta });
  } catch (error) {
    return apiError(error);
  }
}
