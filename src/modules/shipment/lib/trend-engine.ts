/**
 * trend-engine.ts — Расчёт динамики заказов и прогнозирование
 * 
 * Разбивает 30 дней заказов на 4 недели, строит линейный тренд,
 * прогнозирует следующий месяц с учётом динамики.
 */

import type { OrderRecord } from "@/types";
import { TREND } from "@/lib/constants";

export interface WeeklyData {
  week: number;       // 1-4
  label: string;      // "Нед. 1"
  orders: number;     // количество заказов
  dateRange: string;  // "01.03 – 07.03"
}

export interface TrendResult {
  weekly: WeeklyData[];
  slope: number;            // изменение заказов в неделю
  slopePercent: number;     // % изменения в неделю
  direction: "up" | "down" | "flat";
  forecast: number;         // прогноз на неделю 5
  forecastMonth: number;    // прогноз на месяц (4 недели вперёд)
  totalRaw: number;         // сырые заказы за 30 дней (V1)
  multiplier: number;       // forecastMonth / totalRaw
  r2: number;               // коэффициент детерминации (0-1)
  confidence: "high" | "medium" | "low";
}

/** Format local date as YYYY-MM-DD (no UTC shift) */
function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


/**
 * Разбивает заказы по баркоду на недели по 7 дней.
 * Количество недель определяется из loadedDays (передаётся параметром).
 * Период: [сегодня − loadedDays .. сегодня] включительно.
 */
export function getWeeklyOrders(
  orders: OrderRecord[],
  barcode: string,
  loadedDays: number = 28
): WeeklyData[] {
  // Фильтр: только этот баркод (все заказы, включая отменённые)
  const filtered = orders.filter(
    (o) => o.barcode === barcode
  );

  const numWeeks = Math.max(1, Math.floor(loadedDays / 7));

  // Начало периода = сегодня - loadedDays (сегодня — неполный день, не учитываем)
  const now = new Date();
  const firstDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - loadedDays);

  const fmtDate = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

  const weeks: WeeklyData[] = [];

  // Разбиваем от самой старой даты, по 7 дней
  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + w * 7);
    const weekEnd = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + (w + 1) * 7);

    // Локальное форматирование — без UTC-сдвига
    const startStr = toLocalISO(weekStart);
    const endStr = toLocalISO(weekEnd);

    const count = filtered.filter((o) => {
      const d = o.date.substring(0, 10);
      return d >= startStr && d < endStr;
    }).length;

    weeks.push({
      week: w + 1,
      label: `Нед. ${w + 1}`,
      orders: count,
      dateRange: `${fmtDate(weekStart)} – ${fmtDate(new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate() - 1))}`,
    });
  }

  return weeks;
}

/**
 * Линейная регрессия y = a + b*x
 * x = номер недели (1..4), y = заказы
 */
function linearRegression(points: { x: number; y: number }[]): {
  a: number;
  b: number;
  r2: number;
} {
  const n = points.length;
  if (n < 2) return { a: 0, b: 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { a: sumY / n, b: 0, r2: 0 };

  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;

  // R² coefficient
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - (a + b * p.x)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { a, b, r2 };
}

/**
 * Рассчитать тренд и прогноз
 */
export function calculateTrend(weekly: WeeklyData[], buyoutRate: number = 1): TrendResult {
  const numWeeks = weekly.length;
  const totalRaw = weekly.reduce((s, w) => s + w.orders, 0);

  // Фильтруем нулевые недели (out of stock / аномалия)
  const nonZero = weekly.filter((w) => w.orders > 0);

  // Если меньше 2 недель с данными — тренд не считаем
  if (nonZero.length < 2) {
    return {
      weekly,
      slope: 0,
      slopePercent: 0,
      direction: "flat",
      forecast: totalRaw / numWeeks,
      forecastMonth: totalRaw,
      totalRaw,
      multiplier: 1,
      r2: 0,
      confidence: "low",
    };
  }

  const points = nonZero.map((w) => ({ x: w.week, y: w.orders }));
  const { a, b, r2 } = linearRegression(points);

  // Прогноз на следующую неделю (N+1)
  const forecastNext = Math.max(0, a + b * (numWeeks + 1));

  // Прогноз на следующие N недель (такой же период как загруженный)
  const forecastWeeks: number[] = [];
  for (let i = 1; i <= numWeeks; i++) {
    forecastWeeks.push(Math.max(0, a + b * (numWeeks + i)));
  }
  const forecastPeriod = forecastWeeks.reduce((s, v) => s + v, 0);

  // Последние 4 недели (для сравнения и множителя)
  const last4 = weekly.slice(-4);
  const last4Total = last4.reduce((s, w) => s + w.orders, 0);
  // Прогноз на следующие 4 недели
  const lastWeekNum = numWeeks;
  const forecast4 = [1, 2, 3, 4].reduce((s, i) => s + Math.max(0, a + b * (lastWeekNum + i)), 0);

  // Среднее значение за все недели
  const avgWeekly = totalRaw / numWeeks;

  // Slope percent
  const slopePercent = avgWeekly > 0 ? (b / avgWeekly) * 100 : 0;

  // Direction
  const pct = TREND.DIRECTION_THRESHOLD * 100;
  let direction: "up" | "down" | "flat" = "flat";
  if (slopePercent > pct) direction = "up";
  else if (slopePercent < -pct) direction = "down";

  // Confidence
  let confidence: "high" | "medium" | "low" = "low";
  if (r2 > TREND.R2_HIGH) confidence = "high";
  else if (r2 > TREND.R2_MEDIUM) confidence = "medium";

  // Multiplier: сравниваем прогноз следующей 1 недели со средней неделей
  // Прогнозируем на 1 неделю вперёд, а не на 4 — данные обновляются еженедельно
  const avgWeekLast4 = last4Total / last4.length;
  const multiplier = avgWeekLast4 > 0 ? forecastNext / avgWeekLast4 : 1;

  return {
    weekly,
    slope: b,
    slopePercent,
    direction,
    forecast: forecastNext,
    forecastMonth: forecastPeriod,
    totalRaw,
    multiplier: Math.max(TREND.MULTIPLIER_MIN, Math.min(TREND.MULTIPLIER_MAX, multiplier)),
    r2,
    confidence,
  };
}

/**
 * Получить тренд для всех баркодов товара
 */
export function getProductTrend(
  orders: OrderRecord[],
  barcodes: string[],
  buyoutRate: number = 0.75,
  loadedDays: number = 28
): TrendResult {
  // Объединяем все заказы по всем баркодам товара
  // Определяем количество недель из первого баркода
  const firstBw = barcodes.length > 0 ? getWeeklyOrders(orders, barcodes[0], loadedDays) : [];
  const numWeeks = firstBw.length || 1;

  const allWeekly: WeeklyData[] = Array.from({ length: numWeeks }, (_, i) => ({
    week: i + 1,
    label: `Нед. ${i + 1}`,
    orders: 0,
    dateRange: "",
  }));

  for (const barcode of barcodes) {
    const bw = getWeeklyOrders(orders, barcode, loadedDays);
    for (let i = 0; i < Math.min(bw.length, numWeeks); i++) {
      allWeekly[i].orders += bw[i].orders;
      if (!allWeekly[i].dateRange && bw[i].dateRange) {
        allWeekly[i].dateRange = bw[i].dateRange;
      }
    }
  }

  return calculateTrend(allWeekly, buyoutRate);
}
