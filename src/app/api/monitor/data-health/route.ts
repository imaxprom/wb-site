import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * GET /api/monitor/data-health
 *
 * Быстрые проверки здоровья данных (1-2 сек).
 * SQL + файлы, без внешних HTTP запросов.
 */

const DB_PATH = path.join(process.cwd(), "data", "finance.db");
const WEEKLY_DB_PATH = path.join(process.cwd(), "data", "weekly_reports.db");
const STATUS_PATH = path.join(process.cwd(), "data", "daily-sync-status.json");
const API_KEY_PATH = path.join(process.cwd(), "data", "wb-api-key.txt");
const TOKENS_PATH = path.join(process.cwd(), "data", "wb-tokens.json");
const CRON_HEALTH_PATH = path.join(process.cwd(), "public", "data", "monitor", "data-health-cron.json");

interface Check {
  id: string;
  name: string;
  status: "ok" | "warn" | "error";
  value: string;
  detail?: string;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fileSizeMB(p: string): number {
  try { return fs.statSync(p).size / 1024 / 1024; } catch { return 0; }
}

export async function GET() {
  const checks: Check[] = [];
  const yd = yesterday();

  let db: Database.Database | null = null;
  let wdb: Database.Database | null = null;

  try {
    // 1. finance.db доступна
    try {
      db = new Database(DB_PATH, { readonly: true });
      db.pragma("busy_timeout = 5000");
      const walSize = fileSizeMB(DB_PATH + "-wal");
      checks.push({
        id: "finance_db",
        name: "finance.db",
        status: walSize > 100 ? "warn" : "ok",
        value: `WAL ${walSize.toFixed(0)} MB`,
        detail: walSize > 100 ? "WAL слишком большой, нужен checkpoint" : undefined,
      });
    } catch (e) {
      checks.push({ id: "finance_db", name: "finance.db", status: "error", value: "Недоступна", detail: String(e) });
    }

    // 2. weekly_reports.db доступна
    try {
      if (fs.existsSync(WEEKLY_DB_PATH)) {
        wdb = new Database(WEEKLY_DB_PATH, { readonly: true });
        wdb.pragma("busy_timeout = 5000");
        const walSize = fileSizeMB(WEEKLY_DB_PATH + "-wal");
        checks.push({
          id: "weekly_db",
          name: "weekly_reports.db",
          status: walSize > 100 ? "warn" : "ok",
          value: `WAL ${walSize.toFixed(0)} MB`,
        });
      } else {
        checks.push({ id: "weekly_db", name: "weekly_reports.db", status: "error", value: "Файл не найден" });
      }
    } catch (e) {
      checks.push({ id: "weekly_db", name: "weekly_reports.db", status: "error", value: "Недоступна", detail: String(e) });
    }

    // 3. WB API ключ существует
    {
      const exists = fs.existsSync(API_KEY_PATH);
      const size = exists ? fs.readFileSync(API_KEY_PATH, "utf-8").trim().length : 0;
      checks.push({
        id: "api_key",
        name: "WB API ключ",
        status: size > 50 ? "ok" : "error",
        value: size > 50 ? `${size} символов` : "Отсутствует",
      });
    }

    // 4. WB токены (authorizev3)
    {
      let hasTokens = false;
      try {
        if (fs.existsSync(TOKENS_PATH)) {
          const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
          hasTokens = !!tokens.authorizev3 && !!tokens.cookies;
        }
      } catch { /* */ }
      checks.push({
        id: "wb_tokens",
        name: "WB токены (authorizev3)",
        status: hasTokens ? "ok" : "error",
        value: hasTokens ? "Настроены" : "Отсутствуют",
        detail: hasTokens ? undefined : "Нужна авторизация через CDP",
      });
    }

    if (db) {
      // 5. Realization за вчера
      {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE rr_dt = ?").get(yd) as { cnt: number };
        checks.push({
          id: "realization",
          name: `Realization (${yd})`,
          status: row.cnt > 100 ? "ok" : row.cnt > 0 ? "warn" : "error",
          value: `${row.cnt} строк`,
          detail: row.cnt === 0 ? "Нет данных за вчера" : undefined,
        });
      }

      // 6. Реклама за вчера + nm_id
      {
        const total = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as sum FROM advertising WHERE date = ?").get(yd) as { cnt: number; sum: number };
        const mapped = db.prepare("SELECT COUNT(*) as cnt FROM advertising WHERE date = ? AND nm_id > 0").get(yd) as { cnt: number };
        const pct = total.cnt > 0 ? Math.round(mapped.cnt / total.cnt * 100) : 0;
        checks.push({
          id: "advertising",
          name: `Реклама (${yd})`,
          status: total.cnt > 0 && pct > 50 ? "ok" : total.cnt > 0 ? "warn" : "error",
          value: total.cnt > 0 ? `${Math.round(total.sum).toLocaleString("ru-RU")}₽, nm_id: ${pct}%` : "Нет данных",
          detail: pct === 0 && total.cnt > 0 ? "Все записи без nm_id — маппинг не сработал" : undefined,
        });
      }

      // 7. Orders_funnel за вчера
      {
        const row = db.prepare("SELECT order_count FROM orders_funnel WHERE date = ?").get(yd) as { order_count: number } | undefined;
        checks.push({
          id: "orders_funnel",
          name: `Заказы (${yd})`,
          status: row && row.order_count > 0 ? "ok" : "error",
          value: row ? `${row.order_count} заказов` : "Нет данных",
        });
      }

      // 8. Paid storage за вчера
      {
        const row = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(warehouse_price),0) as sum FROM paid_storage WHERE date = ?").get(yd) as { cnt: number; sum: number };
        checks.push({
          id: "storage",
          name: `Хранение (${yd})`,
          status: row.cnt > 0 ? "ok" : "warn",
          value: row.cnt > 0 ? `${Math.round(row.sum).toLocaleString("ru-RU")}₽` : "Нет данных",
        });
      }

      // 9. Weekly report актуален
      if (wdb) {
        const row = wdb.prepare("SELECT MAX(period_to) as last_to FROM reports").get() as { last_to: string | null };
        const daysOld = row?.last_to ? Math.round((Date.now() - new Date(row.last_to).getTime()) / 86400000) : 999;
        checks.push({
          id: "weekly_report",
          name: "Еженедельный отчёт",
          status: daysOld <= 14 ? "ok" : daysOld <= 21 ? "warn" : "error",
          value: row?.last_to ? `до ${row.last_to} (${daysOld} дн. назад)` : "Нет отчётов",
        });
      }

      // 10. Shipment orders свежие
      {
        const row = db.prepare("SELECT MAX(SUBSTR(date,1,10)) as last_date, COUNT(*) as cnt FROM shipment_orders").get() as { last_date: string | null; cnt: number };
        const daysOld = row?.last_date ? Math.round((Date.now() - new Date(row.last_date).getTime()) / 86400000) : 999;
        checks.push({
          id: "shipment_orders",
          name: "Заказы (отгрузка)",
          status: daysOld <= 2 ? "ok" : daysOld <= 5 ? "warn" : "error",
          value: row?.last_date ? `до ${row.last_date}, ${row.cnt} шт` : "Нет данных",
        });
      }

      // 11. Shipment stock
      {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM shipment_stock").get() as { cnt: number };
        checks.push({
          id: "shipment_stock",
          name: "Остатки на складах",
          status: row.cnt > 0 ? "ok" : "error",
          value: row.cnt > 0 ? `${row.cnt} позиций` : "Нет данных",
        });
      }

      // 12. Buyout rate в норме
      {
        const row = db.prepare("SELECT AVG(buyout_rate) as avg_rate, COUNT(*) as cnt FROM buyout_rates").get() as { avg_rate: number | null; cnt: number };
        const avg = row?.avg_rate || 0;
        checks.push({
          id: "buyout_rate",
          name: "Процент выкупа",
          status: avg >= 0.70 && avg <= 0.90 ? "ok" : avg > 0 ? "warn" : "error",
          value: row?.cnt ? `${(avg * 100).toFixed(1)}% (${row.cnt} артикулов)` : "Нет данных",
          detail: avg > 0.95 ? "Подозрительно высокий — возможно данные неточные" : avg < 0.60 ? "Подозрительно низкий" : undefined,
        });
      }

      // 13. Себестоимость заполнена
      {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM cogs WHERE cost > 0").get() as { cnt: number };
        checks.push({
          id: "cogs",
          name: "Себестоимость",
          status: row.cnt > 0 ? "ok" : "warn",
          value: row.cnt > 0 ? `${row.cnt} баркодов` : "Не заполнена (дефолт 300₽)",
        });
      }

      // 14. Daily sync status
      {
        let syncOk = false;
        let syncDetail = "Файл не найден";
        try {
          if (fs.existsSync(STATUS_PATH)) {
            const status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
            if (status.today?.date === yd) {
              syncOk = status.today.complete === true;
              const parts = [];
              if (status.today.report?.ok) parts.push("report✓");
              else parts.push("report✗");
              if (status.today.advertising?.ok) parts.push("ads✓");
              else parts.push("ads✗");
              if (status.today.orders?.ok) parts.push("orders✓");
              else parts.push("orders✗");
              if (status.today.storage?.ok) parts.push("storage✓");
              else parts.push("storage✗");
              syncDetail = parts.join(", ");
            } else {
              syncDetail = `Последний синк: ${status.today?.date || "нет"}`;
            }
          }
        } catch { /* */ }
        checks.push({
          id: "daily_sync",
          name: "Daily Sync",
          status: syncOk ? "ok" : "warn",
          value: syncOk ? "Complete" : "Неполный",
          detail: syncDetail,
        });
      }
    }

    // 15-16: Крон-проверки (из файла, обновляется отдельным скриптом)
    try {
      if (fs.existsSync(CRON_HEALTH_PATH)) {
        const cronData = JSON.parse(fs.readFileSync(CRON_HEALTH_PATH, "utf-8")) as { checks: Check[]; timestamp: string };
        for (const c of cronData.checks) {
          checks.push(c);
        }
      }
    } catch { /* */ }

  } finally {
    try { db?.close(); } catch { /* */ }
    try { wdb?.close(); } catch { /* */ }
  }

  // Итоговый статус
  const errors = checks.filter(c => c.status === "error").length;
  const warns = checks.filter(c => c.status === "warn").length;
  const overall = errors > 0 ? "error" : warns > 0 ? "warn" : "ok";

  return NextResponse.json({
    overall,
    message: overall === "ok" ? "Данным можно доверять" : overall === "warn" ? "Есть предупреждения" : "Есть критические проблемы",
    checks,
    timestamp: new Date().toISOString(),
  });
}
