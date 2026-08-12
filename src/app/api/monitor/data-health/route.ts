import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { activateMonitorOrganizationContext, requireMonitorAdmin } from "@/lib/monitor-auth";
import { pgGet } from "@/lib/postgres";
import { getOrganizationDataPath } from "@/lib/organization-paths";

/**
 * GET /api/monitor/data-health
 *
 * Быстрые проверки здоровья данных (1-2 сек).
 * SQL + файлы, без внешних HTTP запросов.
 */

const statusPath = () => getOrganizationDataPath("daily-sync-status.json");
const apiKeyPath = () => getOrganizationDataPath("wb-api-key.txt");
const tokensPath = () => getOrganizationDataPath("wb-tokens.json");
const cronHealthPath = () => getOrganizationDataPath("data-health-cron.json");
const shipmentSyncLogPath = () => getOrganizationDataPath("shipment-sync.log");

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

function formatDbTimestamp(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseTimestamp(value: unknown): Date | null {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += "T00:00:00Z";
  if (/^\d{4}-\d{2}-\d{2} \d/.test(text)) text = text.replace(" ", "T");
  text = text.replace(/(\.\d{3})\d+/, "$1");
  text = text.replace(/([+-]\d{2})$/, "$1:00");
  const dt = new Date(text);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ageMinutes(value: unknown): number {
  const dt = parseTimestamp(value);
  if (!dt) return 999999;
  return Math.round((Date.now() - dt.getTime()) / 60000);
}

function formatAge(minutes: number): string {
  if (minutes >= 999999) return "нет даты";
  if (minutes < 0) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

function latestShipmentStockLogState(): { skipped: boolean | null; line: string | null } {
  try {
    const lines = fs.readFileSync(shipmentSyncLogPath(), "utf-8").trim().split(/\r?\n/).slice(-120).reverse();
    const line = lines.find((entry) => entry.includes("Sync OK:") || entry.includes("ERROR: sync failed"));
    if (!line) return { skipped: null, line: null };
    if (/"stockSkipped"\s*:\s*true/.test(line)) return { skipped: true, line };
    if (/"stockSkipped"\s*:\s*false/.test(line)) return { skipped: false, line };
    return { skipped: null, line };
  } catch {
    return { skipped: null, line: null };
  }
}

async function tableExistsPg(tableName: string): Promise<boolean> {
  const row = await pgGet<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    ) AS exists
  `, [tableName]);
  return Boolean(row?.exists);
}

export async function GET(req: NextRequest) {
  const authError = await requireMonitorAdmin(req);
  if (authError) return authError;
  activateMonitorOrganizationContext(req);

  const checks: Check[] = [];
  const yd = yesterday();
  try {
    // 1. Основная БД доступна
    try {
      await pgGet("SELECT 1 AS ok");
      checks.push({
        id: "postgres_db",
        name: "PostgreSQL",
        status: "ok",
        value: "Доступна",
      });
    } catch (e) {
      checks.push({
        id: "postgres_db",
        name: "PostgreSQL",
        status: "error",
        value: "Недоступна",
        detail: String(e),
      });
    }

    // 2. weekly reports source доступен
    try {
      const row = await pgGet<{ cnt: number; last_to: string | null }>(
        "SELECT COUNT(*) as cnt, MAX(period_to) as last_to FROM reports"
      );
      checks.push({
        id: "weekly_db",
        name: "weekly reports",
        status: row && row.cnt > 0 ? "ok" : "error",
        value: row && row.cnt > 0 ? `${row.cnt} отчётов` : "Нет отчётов",
        detail: row?.last_to ? `Последний отчёт: ${row.last_to}` : undefined,
      });
    } catch (e) {
      checks.push({ id: "weekly_db", name: "weekly reports", status: "error", value: "Недоступны", detail: String(e) });
    }

    // 3. WB API ключ существует
    {
      const exists = fs.existsSync(apiKeyPath());
      const size = exists ? fs.readFileSync(apiKeyPath(), "utf-8").trim().length : 0;
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
        if (fs.existsSync(tokensPath())) {
          const tokens = JSON.parse(fs.readFileSync(tokensPath(), "utf-8"));
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

    {
      // 5. Realization за вчера
      {
        const row = await pgGet<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM realization WHERE LEFT(COALESCE(NULLIF(sale_dt,''), NULLIF(rr_dt,''), ''), 10) = ?",
          [yd]
        ) || { cnt: 0 };
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
        const total = await pgGet<{ cnt: number; sum: number }>("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as sum FROM advertising WHERE date = ?", [yd]) || { cnt: 0, sum: 0 };
        const mapped = await pgGet<{ cnt: number }>("SELECT COUNT(*) as cnt FROM advertising WHERE date = ? AND nm_id > 0", [yd]) || { cnt: 0 };
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
        const row = await pgGet<{ order_count: number }>("SELECT order_count FROM orders_funnel WHERE date = ?", [yd]);
        checks.push({
          id: "orders_funnel",
          name: `Заказы (${yd})`,
          status: row && row.order_count > 0 ? "ok" : "error",
          value: row ? `${row.order_count} заказов` : "Нет данных",
        });
      }

      // 8. Paid storage за вчера
      {
        const row = await pgGet<{ cnt: number; sum: number }>("SELECT COUNT(*) as cnt, COALESCE(SUM(warehouse_price),0) as sum FROM paid_storage WHERE date = ?", [yd]) || { cnt: 0, sum: 0 };
        checks.push({
          id: "storage",
          name: `Хранение (${yd})`,
          status: row.cnt > 0 ? "ok" : "warn",
          value: row.cnt > 0 ? `${Math.round(row.sum).toLocaleString("ru-RU")}₽` : "Нет данных",
        });
      }

      // 9. Weekly report актуален
      {
        const row = await pgGet<{ last_to: string | null }>("SELECT MAX(period_to) as last_to FROM reports");
        const daysOld = row?.last_to ? Math.round((Date.now() - new Date(row.last_to).getTime()) / 86400000) : 999;
        checks.push({
          id: "weekly_report",
          name: "Еженедельный отчёт",
          status: daysOld <= 14 ? "ok" : daysOld <= 21 ? "warn" : "error",
          value: row?.last_to ? `до ${row.last_to} (${daysOld} дн. назад)` : "Нет отчётов",
        });
      }

      // 9b. Последний импорт weekly reports: валидация заголовков и audit
      {
        if (!await tableExistsPg("weekly_import_status")) {
          checks.push({
            id: "weekly_import_status",
            name: "Импорт weekly reports",
            status: "warn",
            value: "Нет статуса",
            detail: "Скрипт ещё не записывал weekly_import_status",
          });
        } else {
          const row = await pgGet<{ status: string; loaded: number; total: number; message: string; updated_at: string | null; details_json: unknown }>(
            "SELECT status, loaded, total, message, updated_at, details_json FROM weekly_import_status WHERE id = ?",
            ["weekly-reports"]
          );
          const status = row?.status === "error" ? "error" : row?.status === "warn" ? "warn" : row ? "ok" : "warn";
          const details = row?.details_json && typeof row.details_json === "object" ? row.details_json as Record<string, unknown> : {};
          const warnings = Array.isArray(details.warnings) ? details.warnings.length : 0;
          const errors = Array.isArray(details.errors) ? details.errors.length : 0;
          const suffix = warnings || errors ? `; warn ${warnings}, err ${errors}` : "";
          checks.push({
            id: "weekly_import_status",
            name: "Импорт weekly reports",
            status,
            value: row ? `${row.message || row.status}${suffix}` : "Нет статуса",
            detail: row?.updated_at ? `Последний запуск: ${formatDbTimestamp(row.updated_at)}; отчётов в БД: ${row.total}` : undefined,
          });
        }
      }

      // 10. Shipment orders свежие
      {
        const row = await pgGet<{ last_date: string | null; cnt: number }>("SELECT MAX(SUBSTR(date,1,10)) as last_date, COUNT(*) as cnt FROM shipment_orders") || { last_date: null, cnt: 0 };
        const daysOld = row.last_date ? Math.round((Date.now() - new Date(row.last_date).getTime()) / 86400000) : 999;
        checks.push({
          id: "shipment_orders",
          name: "Заказы (отгрузка)",
          status: daysOld <= 2 ? "ok" : daysOld <= 5 ? "warn" : "error",
          value: row.last_date ? `до ${row.last_date}, ${row.cnt} шт` : "Нет данных",
        });
      }

      // 11. Shipment stock
      {
        const row = await pgGet<{ cnt: number; updated_at: string | null }>(
          "SELECT COUNT(*) as cnt, MAX(updated_at) as updated_at FROM shipment_stock"
        ) || { cnt: 0, updated_at: null };
        const stockAge = ageMinutes(row.updated_at);
        const logState = latestShipmentStockLogState();
        let status: Check["status"] = row.cnt > 0 && stockAge <= 150 ? "ok" : row.cnt > 0 && stockAge <= 240 ? "warn" : "error";
        if (logState.skipped === true) status = "error";
        checks.push({
          id: "shipment_stock",
          name: "Остатки на складах",
          status,
          value: row.cnt > 0 ? `${row.cnt} позиций` : "Нет данных",
          detail: logState.skipped === true
            ? `Последний sync пропустил остатки: ${logState.line}`
            : row.updated_at
              ? `Последний синк остатков: ${formatDbTimestamp(row.updated_at)} (${formatAge(stockAge)})`
              : "Нет синка остатков",
        });
      }

      // 12. Buyout rate в норме
      {
        const row = await pgGet<{ avg_rate: number | null; cnt: number }>("SELECT AVG(buyout_rate) as avg_rate, COUNT(*) as cnt FROM buyout_rates") || { avg_rate: null, cnt: 0 };
        const avg = row.avg_rate || 0;
        checks.push({
          id: "buyout_rate",
          name: "Процент выкупа",
          status: avg >= 0.70 && avg <= 0.90 ? "ok" : avg > 0 ? "warn" : "error",
          value: row.cnt ? `${(avg * 100).toFixed(1)}% (${row.cnt} артикулов)` : "Нет данных",
          detail: avg > 0.95 ? "Подозрительно высокий — возможно данные неточные" : avg < 0.60 ? "Подозрительно низкий" : undefined,
        });
      }

      // 13. Себестоимость заполнена
      {
        const row = await pgGet<{ cnt: number }>("SELECT COUNT(*) as cnt FROM cogs WHERE cost > 0") || { cnt: 0 };
        checks.push({
          id: "cogs",
          name: "Себестоимость",
          status: row.cnt > 0 ? "ok" : "warn",
          value: row.cnt > 0 ? `${row.cnt} баркодов` : "Не заполнена (дефолт 300₽)",
        });
      }

      // 14. Объём из отчёта остатков WB
      {
        if (!await tableExistsPg("warehouse_remains_volume")) {
          checks.push({ id: "warehouse_remains_volume", name: "Объём из отчёта остатков", status: "error", value: "Таблица отсутствует" });
        } else {
          const row = await pgGet<{ cnt: number; synced_at: string | null }>("SELECT COUNT(*) as cnt, MAX(synced_at) as synced_at FROM warehouse_remains_volume") || { cnt: 0, synced_at: null };
          const daysOld = row.synced_at ? Math.round((Date.now() - new Date(row.synced_at).getTime()) / 86400000) : 999;
          checks.push({
            id: "warehouse_remains_volume",
            name: "Объём из отчёта остатков",
            status: row.cnt > 0 && daysOld <= 2 ? "ok" : row.cnt > 0 && daysOld <= 7 ? "warn" : "error",
            value: row.cnt > 0 ? `${row.cnt} строк` : "Нет данных",
            detail: row.synced_at ? `Последний синк: ${row.synced_at}` : undefined,
          });
        }
      }

      // 15. Замеры склада WB
      {
        if (!await tableExistsPg("warehouse_measurements")) {
          checks.push({ id: "warehouse_measurements", name: "Замеры склада WB", status: "error", value: "Таблица отсутствует" });
        } else {
          const row = await pgGet<{ cnt: number; synced_at: string | null; measured_at: string | null }>("SELECT COUNT(*) as cnt, MAX(synced_at) as synced_at, MAX(measured_at) as measured_at FROM warehouse_measurements") || { cnt: 0, synced_at: null, measured_at: null };
          const daysOld = row.synced_at ? Math.round((Date.now() - new Date(row.synced_at).getTime()) / 86400000) : 999;
          checks.push({
            id: "warehouse_measurements",
            name: "Замеры склада WB",
            status: row.cnt > 0 && daysOld <= 2 ? "ok" : row.cnt > 0 && daysOld <= 7 ? "warn" : "error",
            value: row.cnt > 0 ? `${row.cnt} строк` : "Нет данных",
            detail: row.synced_at ? `Последний синк: ${row.synced_at}; последний замер: ${row.measured_at || "нет"}` : undefined,
          });
        }
      }

      // 16. Daily sync status
      {
        let syncOk = false;
        let syncDetail = "Файл не найден";
        try {
          if (fs.existsSync(statusPath())) {
            const status = JSON.parse(fs.readFileSync(statusPath(), "utf-8"));
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
              if (status.ordersRefresh) {
                parts.push(status.ordersRefresh.ok
                  ? `orders7d✓ checked ${status.ordersRefresh.checked}, upd ${status.ordersRefresh.updated}`
                  : `orders7d✗ ${status.ordersRefresh.error || "error"}`);
              }
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

    // 17+: Крон-проверки (из файла, обновляется отдельным скриптом)
    try {
      if (fs.existsSync(cronHealthPath())) {
        const cronData = JSON.parse(fs.readFileSync(cronHealthPath(), "utf-8")) as { checks: Check[]; timestamp: string };
        const existingIds = new Set(checks.map((check) => check.id));
        for (const c of cronData.checks) {
          if (!existingIds.has(c.id)) {
            checks.push(c);
            existingIds.add(c.id);
          }
        }
      }
    } catch { /* */ }

  } finally {
    // no-op: PostgreSQL pool lifecycle is managed by src/lib/postgres.ts
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
