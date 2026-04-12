/**
 * Sync Source 1: Ежедневные отчёты из ЛК WB (realization)
 * Независим от других sync-модулей.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { SourceStatus, emptySource, DB_PATH, TOKENS_PATH } from "./types";

export async function syncReport(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };

  try {
    if (!fs.existsSync(TOKENS_PATH)) {
      s.error = "Нет токенов авторизации (authorizev3)";
      return s;
    }
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
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

    const db = new Database(DB_PATH);
    db.pragma("busy_timeout = 5000");
    let totalRows = 0;
    const XLSX = await import("xlsx");

    const reportsDir = path.join(process.cwd(), "data", "reports");
    const extractDir = path.join(reportsDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    for (const report of dateReports) {
      const existing = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE realizationreport_id = ?").get(report.id) as { cnt: number };
      if (existing.cnt > 0) { totalRows += existing.cnt; continue; }

      const dlRes = await fetch(
        `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports/${report.id}/details/archived-excel?format=binary`,
        { headers: hdrs }
      );
      if (!dlRes.ok) continue;

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
        } catch { continue; }
      }

      const xlsxPath = path.join(extractDir, `report_${report.id}.xlsx`);
      if (!fs.existsSync(xlsxPath)) continue;

      const xlsxBuffer = fs.readFileSync(xlsxPath);
      const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
      if (rows.length === 0) continue;

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
      const placeholders = insertCols.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO realization (${insertCols.join(", ")}) VALUES (${placeholders})`);

      const saleDates = rows.map(r => r["Дата продажи"]).filter(Boolean).sort() as string[];
      const dateFrom = saleDates[0] || date;
      const dateTo = saleDates[saleDates.length - 1] || date;

      db.transaction(() => {
        for (const row of rows) {
          const values: unknown[] = [report.id, dateFrom, dateTo, dateTo];
          for (const [xlsx] of mappedCols) {
            values.push(row[xlsx] ?? (typeof row[xlsx] === "number" ? 0 : ""));
          }
          stmt.run(...values);
        }
      })();

      totalRows += rows.length;
      try { fs.unlinkSync(zipPath); } catch { /* */ }
      try { fs.unlinkSync(xlsxPath); } catch { /* */ }
    }

    db.close();
    s.ok = totalRows > 0;
    s.value = totalRows;
    s.stable = true;
    if (totalRows === 0) s.error = "Отчёты найдены, но 0 строк импортировано";
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
