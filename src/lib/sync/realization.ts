/**
 * Sync Source 1: Ежедневные отчёты из ЛК WB (realization)
 * Независим от других sync-модулей.
 */
import fs from "fs";
import path from "path";
import { SourceStatus, emptySource, getSyncTokensPath } from "./types";
import { readFirstSheetRows } from "@/lib/server/excel-rows";
import { pgGet, withPgTransaction } from "@/lib/postgres";
import type { PoolClient } from "pg";
import { getOrganizationDataDir } from "@/lib/organization-paths";

async function withReportLock<T>(reportId: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [reportId]);
    return fn(client);
  });
}

export async function syncReport(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };

  try {
    const tokensPath = getSyncTokensPath();
    if (!fs.existsSync(tokensPath)) {
      s.error = "Нет токенов авторизации (authorizev3)";
      return s;
    }
    const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    if (!tokens.authorizev3 || !tokens.cookies) {
      s.error = "Неполные токены авторизации";
      return s;
    }

    const refreshRes = await fetch(
      "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorizev3: tokens.authorizev3,
          cookie: tokens.cookies,
          origin: "https://seller.wildberries.ru",
          referer: "https://seller.wildberries.ru/",
        },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
      }
    );
    if (!refreshRes.ok) { s.error = "Token refresh failed: " + refreshRes.status; return s; }
    const sellerLk = ((await refreshRes.json()) as { result?: { data?: { token?: string } } }).result?.data?.token;
    if (!sellerLk) { s.error = "Не удалось обновить wb-seller-lk"; return s; }

    const hdrs = {
      authorizev3: tokens.authorizev3,
      "wb-seller-lk": sellerLk,
      cookie: tokens.cookies,
      origin: "https://seller.wildberries.ru",
      referer: "https://seller.wildberries.ru/",
    };

    const listRes = await fetch(
      "https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports?limit=10&skip=0&type=6",
      { headers: hdrs }
    );
    if (!listRes.ok) { s.error = "Ошибка списка отчётов: " + listRes.status; return s; }

    const listData = (await listRes.json()) as { data?: { reports?: { id: number; dateFrom: string; dateTo: string; type: number }[] } };
    const reports = listData?.data?.reports || [];

    const dateReports = reports.filter(r => r.dateFrom?.slice(0, 10) === date);
    if (dateReports.length === 0) {
      s.error = `Отчёт за ${date} ещё не сформирован`;
      return s;
    }

    const metadataTable = await pgGet<{ table_name: string | null }>(
      "SELECT to_regclass('realization_report_meta') AS table_name"
    );
    if (!metadataTable?.table_name) {
      throw new Error("Database migration missing: realization_report_meta");
    }
    let totalRows = 0;

    const reportsDir = path.join(getOrganizationDataDir(), "reports");
    const extractDir = path.join(reportsDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    for (const report of dateReports as { id: number; dateFrom: string; dateTo: string; type: number; createDate?: string; detailsCount?: number }[]) {
      await withReportLock(report.id, async (client) => {
        const existingMeta = (await client.query<{ create_date: string; details_count: number }>(
          "SELECT create_date, details_count FROM realization_report_meta WHERE report_id = $1",
          [report.id]
        )).rows[0];
        const existingRows = (await client.query<{ cnt: number }>(
          "SELECT COUNT(*)::int as cnt FROM realization WHERE realizationreport_id = $1",
          [report.id]
        )).rows[0] || { cnt: 0 };
        const expectedRows = Number(report.detailsCount || existingMeta?.details_count || 0);
        const existingRowsMatch = existingRows.cnt > 0 && (expectedRows <= 0 || existingRows.cnt === expectedRows);

        if (existingMeta
          && existingMeta.create_date === (report.createDate || "")
          && existingRowsMatch) {
          totalRows += existingRows.cnt;
          return;
        }

        if (!existingMeta && existingRowsMatch) {
          await client.query(`
            INSERT INTO realization_report_meta (report_id, create_date, details_count, imported_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT(report_id) DO UPDATE SET
              create_date = EXCLUDED.create_date,
              details_count = EXCLUDED.details_count,
              imported_at = EXCLUDED.imported_at
          `, [report.id, report.createDate || "", report.detailsCount || existingRows.cnt, new Date().toISOString()]);
          totalRows += existingRows.cnt;
          return;
        }

        const shouldReplaceExistingRows = existingRows.cnt > 0;
        if (shouldReplaceExistingRows) {
          console.log(`[sync/realization] Report ${report.id} row count mismatch/regenerated, re-importing (${existingRows.cnt}/${expectedRows || "unknown"})`);
        }

        const dlRes = await fetch(
          `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports/${report.id}/details/archived-excel?format=binary`,
          { headers: hdrs }
        );
        if (!dlRes.ok) return;

        const buf = Buffer.from(await dlRes.arrayBuffer());
        const zipPath = path.join(reportsDir, `report-${report.id}.zip`);
        fs.writeFileSync(zipPath, buf);

        try {
          const AdmZip = (await import("adm-zip")).default;
          const zip = new AdmZip(zipPath);
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (entry.entryName.endsWith(".xlsx")) {
              fs.writeFileSync(path.join(extractDir, `report_${report.id}.xlsx`), entry.getData());
              break;
            }
          }
        } catch {
          try {
            const { execSync } = await import("child_process");
            execSync(`cd "${extractDir}" && unzip -o "${zipPath}" 2>/dev/null || true`, { timeout: 30000 });
            const files = fs.readdirSync(extractDir).filter(f => f.endsWith(".xlsx") && !f.startsWith("report_"));
            if (files.length > 0) fs.renameSync(path.join(extractDir, files[0]), path.join(extractDir, `report_${report.id}.xlsx`));
          } catch { return; }
        }

        const xlsxPath = path.join(extractDir, `report_${report.id}.xlsx`);
        if (!fs.existsSync(xlsxPath)) return;

        const xlsxBuffer = fs.readFileSync(xlsxPath);
        const rows = await readFirstSheetRows(xlsxBuffer);
        if (rows.length === 0) return;

        const COL_MAP: Record<string, string> = {
          "Предмет": "subject_name", "Код номенклатуры": "nm_id", "Бренд": "brand_name",
          "Артикул поставщика": "sa_name", "Размер": "ts_name", "Баркод": "barcode",
          "Обоснование для оплаты": "supplier_oper_name", "Дата заказа покупателем": "order_dt",
          "Дата продажи": "sale_dt", "Кол-во": "quantity", "Цена розничная": "retail_price",
          "Цена розничная с учетом согласованной скидки": "retail_price_withdisc_rub",
          "Вайлдберриз реализовал Товар (Пр)": "retail_amount",
          "К перечислению Продавцу за реализованный Товар": "ppvz_for_pay",
          "Вознаграждение с продаж до вычета услуг поверенного, без НДС": "ppvz_sales_commission",
          "Эквайринг/Комиссии за организацию платежей": "acquiring_fee",
          "Услуги по доставке товара покупателю": "delivery_rub",
          "Количество доставок": "delivery_amount", "Количество возврата": "return_amount",
          "Хранение": "storage_fee", "Общая сумма штрафов": "penalty",
          "Операции на приемке": "acceptance",
          "Возмещение издержек по перевозке/по складским операциям с товаром": "rebill_logistic_cost",
          "Разовое изменение срока перечисления денежных средств": "additional_payment",
          "Итоговый кВВ без НДС, %": "ppvz_kvw_prc", "Размер кВВ без НДС, % Базовый": "ppvz_kvw_prc_base",
          "Скидка постоянного Покупателя (СПП), %": "ppvz_spp_prc", "Размер кВВ, %": "commission_percent",
          "Страна": "site_country", "Наименование офиса доставки": "office_name",
          "Удержания": "deduction", "Виды логистики, штрафов и корректировок ВВ": "bonus_type_name",
        };

        const xlsxHeaders = Object.keys(rows[0]);
        const mappedCols = Object.entries(COL_MAP).filter(([xlsx]) => xlsxHeaders.includes(xlsx));
        const insertCols = ["realizationreport_id", "date_from", "date_to", "rr_dt", ...mappedCols.map(([, db]) => db)];

        const saleDates = rows.map(r => r["Дата продажи"]).filter(Boolean).sort() as string[];
        const dateFrom = saleDates[0] || date;
        const dateTo = saleDates[saleDates.length - 1] || date;

        const placeholders = insertCols.map((_, index) => `$${index + 1}`).join(", ");
        await client.query("BEGIN");
        try {
          if (shouldReplaceExistingRows) {
            await client.query("DELETE FROM realization WHERE realizationreport_id = $1", [report.id]);
          }

          for (const row of rows) {
            const values: unknown[] = [report.id, dateFrom, dateTo, dateTo];
            for (const [xlsx] of mappedCols) {
              values.push(row[xlsx] ?? (typeof row[xlsx] === "number" ? 0 : ""));
            }
            await client.query(`INSERT INTO realization (${insertCols.join(", ")}) VALUES (${placeholders})`, values);
          }

          await client.query(`
            INSERT INTO realization_report_meta (report_id, create_date, details_count, imported_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT(report_id) DO UPDATE SET
              create_date = EXCLUDED.create_date,
              details_count = EXCLUDED.details_count,
              imported_at = EXCLUDED.imported_at
          `, [report.id, report.createDate || "", report.detailsCount || rows.length, new Date().toISOString()]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }

        totalRows += rows.length;
        try { fs.unlinkSync(zipPath); } catch { /* */ }
        try { fs.unlinkSync(xlsxPath); } catch { /* */ }
      });
    }

    s.ok = totalRows > 0;
    s.value = totalRows;
    s.stable = true;
    if (totalRows === 0) s.error = "Отчёты найдены, но 0 строк импортировано";
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
