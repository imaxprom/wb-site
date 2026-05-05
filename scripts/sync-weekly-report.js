#!/usr/bin/env node
/**
 * Скачивает еженедельный отчёт из ЛК WB → weekly_reports.db
 * 
 * Логика:
 * - Запрашивает список еженедельных отчётов из ЛК
 * - Проверяет какие уже есть в weekly_reports.db
 * - Если есть новый — скачивает Excel (type1 + type2), парсит, загружает в БД
 * - Если нового нет — выходит с кодом 0 и сообщением "нет новых отчётов"
 * 
 * Запуск по крону: пн-ср каждый час с 10:00 до 23:00
 * Как только отчёт скачан — крон останавливается до следующего понедельника
 */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const { readFirstSheetRows } = require("./lib/excel-rows");

const DB_PATH = path.join(__dirname, "..", "data", "weekly_reports.db");
const TOKENS_PATH = path.join(__dirname, "..", "data", "wb-tokens.json");

// Маппинг колонок — тот же что в create-weekly-db.js
const COLUMN_MAP = [
  { excel: "№", db: "row_num", type: "TEXT" },
  { excel: "Номер поставки", db: "supply_id", type: "TEXT" },
  { excel: "Предмет", db: "subject", type: "TEXT" },
  { excel: "Код номенклатуры", db: "nm_id", type: "TEXT" },
  { excel: "Бренд", db: "brand", type: "TEXT" },
  { excel: "Артикул поставщика", db: "sa_name", type: "TEXT" },
  { excel: "Название", db: "product_name", type: "TEXT" },
  { excel: "Размер", db: "size", type: "TEXT" },
  { excel: "Баркод", db: "barcode", type: "TEXT" },
  { excel: "Тип документа", db: "doc_type", type: "TEXT" },
  { excel: "Обоснование для оплаты", db: "supplier_oper_name", type: "TEXT" },
  { excel: "Дата заказа покупателем", db: "order_dt", type: "TEXT" },
  { excel: "Дата продажи", db: "sale_dt", type: "TEXT" },
  { excel: "Кол-во", db: "quantity", type: "REAL" },
  { excel: "Цена розничная", db: "retail_price", type: "REAL" },
  { excel: "Вайлдберриз реализовал Товар (Пр)", db: "retail_amount", type: "REAL" },
  { excel: "Согласованный продуктовый дисконт, %", db: "product_discount_pct", type: "REAL" },
  { excel: "Промокод, %", db: "promo_code_pct", type: "REAL" },
  { excel: "Итоговая согласованная скидка, %", db: "total_discount_pct", type: "REAL" },
  { excel: "Цена розничная с учетом согласованной скидки", db: "retail_price_withdisc_rub", type: "REAL" },
  { excel: "Размер снижения кВВ из-за рейтинга, %", db: "kvv_rating_reduction_pct", type: "REAL" },
  { excel: "Размер изменения кВВ из-за акции, %", db: "kvv_promo_change_pct", type: "REAL" },
  { excel: "Скидка постоянного Покупателя (СПП), %", db: "spp_pct", type: "REAL" },
  { excel: "Размер кВВ, %", db: "kvv_pct", type: "REAL" },
  { excel: "Размер  кВВ без НДС, % Базовый", db: "kvv_base_no_vat_pct", type: "REAL" },
  { excel: "Итоговый кВВ без НДС, %", db: "kvv_final_no_vat_pct", type: "REAL" },
  { excel: "Вознаграждение с продаж до вычета услуг поверенного, без НДС", db: "ppvz_sales_commission", type: "REAL" },
  { excel: "Возмещение за выдачу и возврат товаров на ПВЗ", db: "ppvz_pvz_reward", type: "REAL" },
  { excel: "Эквайринг/Комиссии за организацию платежей", db: "acquiring_fee", type: "REAL" },
  { excel: "Размер комиссии за эквайринг/Комиссии за организацию платежей, %", db: "acquiring_pct", type: "REAL" },
  { excel: "Тип платежа за Эквайринг/Комиссии за организацию платежей", db: "acquiring_type", type: "TEXT" },
  { excel: "Вознаграждение Вайлдберриз (ВВ), без НДС", db: "vv_no_vat", type: "REAL" },
  { excel: "НДС с Вознаграждения Вайлдберриз", db: "vv_vat", type: "REAL" },
  { excel: "К перечислению Продавцу за реализованный Товар", db: "ppvz_for_pay", type: "REAL" },
  { excel: "Количество доставок", db: "delivery_amount", type: "REAL" },
  { excel: "Количество возврата", db: "return_amount", type: "REAL" },
  { excel: "Услуги по доставке товара покупателю", db: "delivery_rub", type: "REAL" },
  { excel: "Дата начала действия фиксации", db: "fix_date_from", type: "TEXT" },
  { excel: "Дата конца действия фиксации", db: "fix_date_to", type: "TEXT" },
  { excel: "Признак услуги платной доставки", db: "paid_delivery_flag", type: "TEXT" },
  { excel: "Общая сумма штрафов", db: "penalty", type: "REAL" },
  { excel: "Корректировка Вознаграждения Вайлдберриз (ВВ)", db: "vv_correction", type: "REAL" },
  { excel: "Виды логистики, штрафов и корректировок ВВ", db: "operation_type", type: "TEXT" },
  { excel: "Стикер МП", db: "sticker_mp", type: "TEXT" },
  { excel: "Наименование банка-эквайера", db: "acquiring_bank", type: "TEXT" },
  { excel: "Номер офиса", db: "office_id", type: "TEXT" },
  { excel: "Наименование офиса доставки", db: "office_name", type: "TEXT" },
  { excel: "ИНН партнера", db: "partner_inn", type: "TEXT" },
  { excel: "Партнер", db: "partner", type: "TEXT" },
  { excel: "Склад", db: "warehouse", type: "TEXT" },
  { excel: "Страна", db: "country", type: "TEXT" },
  { excel: "Тип коробов", db: "box_type", type: "TEXT" },
  { excel: "Номер таможенной декларации", db: "customs_declaration", type: "TEXT" },
  { excel: "Номер сборочного задания", db: "assembly_id", type: "TEXT" },
  { excel: "Код маркировки", db: "marking_code", type: "TEXT" },
  { excel: "ШК", db: "shk", type: "TEXT" },
  { excel: "Srid", db: "srid", type: "TEXT" },
  { excel: "Возмещение издержек по перевозке/по складским операциям с товаром", db: "rebill_logistic_cost", type: "REAL" },
  { excel: "Организатор перевозки", db: "carrier", type: "TEXT" },
  { excel: "Хранение", db: "storage_fee", type: "REAL" },
  { excel: "Удержания", db: "deduction", type: "REAL" },
  { excel: "Операции на приемке", db: "acceptance", type: "REAL" },
  { excel: "chrtId", db: "chrt_id", type: "INTEGER" },
  { excel: "Фиксированный коэффициент склада по поставке", db: "warehouse_coeff", type: "REAL" },
  { excel: "Признак продажи юридическому лицу", db: "b2b_flag", type: "TEXT" },
  { excel: "ТМЦ", db: "tmc_flag", type: "TEXT" },
  { excel: "Номер короба для обработки товара", db: "box_num", type: "TEXT" },
  { excel: "Скидка по программе софинансирования", db: "cofinancing_discount", type: "REAL" },
  { excel: "Скидка Wibes, %", db: "wibes_discount_pct", type: "REAL" },
  { excel: "Компенсация скидки по программе лояльности", db: "loyalty_compensation", type: "REAL" },
  { excel: "Стоимость участия в программе лояльности", db: "loyalty_participation_cost", type: "REAL" },
  { excel: "Сумма удержанная за начисленные баллы программы лояльности", db: "loyalty_points_deduction", type: "REAL" },
  { excel: "Id корзины заказа", db: "cart_id", type: "TEXT" },
  { excel: "Разовое изменение срока перечисления денежных средств", db: "additional_payment", type: "TEXT" },
  { excel: "Способы продажи и тип товара", db: "sale_method", type: "TEXT" },
  { excel: "Id собственной акции продавца с дополнительной скидкой", db: "seller_promo_id", type: "REAL" },
  { excel: "Размер дополнительной скидки по собственной акции продавца, %", db: "seller_promo_pct", type: "REAL" },
  { excel: "Уникальный идентификатор скидки лояльности от продавца", db: "seller_loyalty_id", type: "REAL" },
  { excel: "Размер скидки лояльности от продавца,%", db: "seller_loyalty_pct", type: "REAL" },
  { excel: "Id промокода", db: "promo_id", type: "TEXT" },
  { excel: "Скидка за промокод, %", db: "promo_discount_pct", type: "REAL" },
];

async function getAuthHeaders() {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
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
  const sellerLk = (await refreshRes.json()).result?.data?.token;
  if (!sellerLk) throw new Error("Не удалось получить токен ЛК WB");

  return {
    authorizev3: tokens.authorizev3,
    "wb-seller-lk": sellerLk,
    cookie: tokens.cookies,
    origin: "https://seller.wildberries.ru",
    referer: "https://seller.wildberries.ru/",
  };
}

async function getWeeklyReports(headers) {
  const res = await fetch(
    "https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports-weekly?type=6&skip=0&limit=15",
    { headers }
  );
  if (!res.ok) throw new Error("Ошибка списка отчётов: " + res.status);
  const data = await res.json();
  return data?.data?.reports || [];
}

async function downloadExcel(headers, reportId) {
  const url = `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports-weekly/${reportId}/details/archived-excel?format=binary`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Ошибка скачивания #${reportId}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length < 1000) {
    console.log(`  ⚠️ Отчёт #${reportId}: файл слишком маленький (${buf.length} байт), пропускаю`);
    return null;
  }

  // Распаковка ZIP → XLSX
  const zip = new AdmZip(buf);
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith(".xlsx")) {
      return entry.getData();
    }
  }
  throw new Error(`В ZIP нет .xlsx файла для #${reportId}`);
}

async function loadExcelToDB(db, xlsxBuffer, reportId, reportType, periodFrom, periodTo) {
  const rows = await readFirstSheetRows(xlsxBuffer);
  if (rows.length === 0) {
    console.log(`  ⚠️ Отчёт #${reportId}: Excel пустой`);
    return 0;
  }

  // Удалить старые данные
  db.prepare("DELETE FROM weekly_rows WHERE report_id = ?").run(reportId);
  db.prepare("DELETE FROM reports WHERE report_id = ?").run(reportId);

  // Вставка
  const dbCols = COLUMN_MAP.map((c) => c.db);
  const placeholders = dbCols.map(() => "?").join(",");
  const insert = db.prepare(
    `INSERT INTO weekly_rows (report_id, report_type, period_from, period_to, ${dbCols.join(",")}) VALUES (?, ?, ?, ?, ${placeholders})`
  );

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      const values = COLUMN_MAP.map((c) => {
        const v = r[c.excel];
        if (v === undefined || v === null || v === "") return null;
        return v;
      });
      insert.run(reportId, reportType, periodFrom, periodTo, ...values);
    }
  });

  insertMany(rows);

  db.prepare(
    "INSERT OR REPLACE INTO reports (report_id, report_type, period_from, period_to, rows_count) VALUES (?, ?, ?, ?, ?)"
  ).run(reportId, reportType, periodFrom, periodTo, rows.length);

  return rows.length;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Синхронизация еженедельных отчётов WB`);

  // Инициализация БД
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Убедимся что таблицы есть
  const colDefs = COLUMN_MAP.map((c) => `${c.db} ${c.type}`).join(",\n    ");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      report_id INTEGER NOT NULL,
      report_type INTEGER NOT NULL,
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      rows_count INTEGER NOT NULL,
      loaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      report_type INTEGER NOT NULL,
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      ${colDefs}
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wr_period ON weekly_rows(period_from, period_to);
    CREATE INDEX IF NOT EXISTS idx_wr_report ON weekly_rows(report_id);
    CREATE INDEX IF NOT EXISTS idx_wr_barcode ON weekly_rows(barcode);
    CREATE INDEX IF NOT EXISTS idx_wr_nm ON weekly_rows(nm_id);
    CREATE INDEX IF NOT EXISTS idx_wr_oper ON weekly_rows(supplier_oper_name);
    CREATE INDEX IF NOT EXISTS idx_wr_sale_dt ON weekly_rows(sale_dt);
  `);

  // Авторизация
  let headers;
  try {
    headers = await getAuthHeaders();
  } catch (e) {
    console.log("❌ Ошибка авторизации: " + e.message);
    db.close();
    process.exit(1);
  }

  // Список отчётов из ЛК
  const wbReports = await getWeeklyReports(headers);
  console.log(`Отчётов в ЛК: ${wbReports.length}`);

  // Какие уже загружены
  const loaded = new Set(
    db.prepare("SELECT report_id FROM reports").all().map((r) => r.report_id)
  );
  console.log(`Уже загружено: ${loaded.size} отчётов`);

  // Группируем по периоду (type1 + type2)
  const periods = {};
  for (const r of wbReports) {
    const key = r.dateFrom?.slice(0, 10);
    if (!key) continue;
    if (!periods[key]) periods[key] = [];
    periods[key].push(r);
  }

  let newCount = 0;
  for (const [periodFrom, reports] of Object.entries(periods).sort()) {
    const allLoaded = reports.every((r) => loaded.has(r.id));
    if (allLoaded) continue;

    // Новый период — скачиваем
    const periodTo = reports[0].dateTo?.slice(0, 10);
    console.log(`\n📥 Новый период: ${periodFrom} — ${periodTo}`);

    for (const report of reports) {
      if (loaded.has(report.id)) {
        console.log(`  type=${report.type}: уже загружен (#${report.id})`);
        continue;
      }

      console.log(`  type=${report.type}: скачиваю (#${report.id}, ${report.detailsCount} строк)...`);
      try {
        const xlsxBuf = await downloadExcel(headers, report.id);
        if (!xlsxBuf) continue;

        const rowsLoaded = await loadExcelToDB(db, xlsxBuf, report.id, report.type, periodFrom, periodTo);
        console.log(`  ✅ type=${report.type}: загружено ${rowsLoaded} строк`);
        newCount++;
      } catch (e) {
        console.log(`  ❌ type=${report.type}: ${e.message}`);
      }
    }
  }

  // Пересчёт buyout_rates в finance.db
  if (newCount > 0) {
    try {
      const financeDbPath = path.join(__dirname, "..", "data", "finance.db");
      const fdb = new Database(financeDbPath);
      fdb.exec(`CREATE TABLE IF NOT EXISTS buyout_rates (
        article_wb TEXT PRIMARY KEY,
        orders INTEGER,
        buyouts INTEGER,
        buyout_rate REAL,
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      fdb.exec(`CREATE TABLE IF NOT EXISTS weekly_buyout_stats (
        period_from TEXT,
        period_to TEXT,
        orders INTEGER,
        buyouts INTEGER,
        returns INTEGER,
        return_rate REAL,
        PRIMARY KEY(period_from, period_to)
      )`);
      fdb.exec("DELETE FROM buyout_rates");
      fdb.exec("DELETE FROM weekly_buyout_stats");
      const rows = db.prepare(`
        SELECT nm_id,
          COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) as orders,
          COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END) as buyouts
        FROM weekly_rows
        WHERE supplier_oper_name IN ('Логистика', 'Продажа') AND nm_id != ''
        GROUP BY nm_id
        HAVING orders >= 30
      `).all();
      const ins = fdb.prepare("INSERT INTO buyout_rates (article_wb, orders, buyouts, buyout_rate) VALUES (?, ?, ?, ?)");
      fdb.transaction(() => {
        for (const r of rows) {
          ins.run(r.nm_id, r.orders, r.buyouts, r.orders > 0 ? r.buyouts / r.orders : 0);
        }
      })();
      fdb.close();
      // Weekly buyout stats
      const weeklyRows = db.prepare(`
        SELECT period_from, period_to,
          COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) as orders,
          COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END) as buyouts
        FROM weekly_rows
        WHERE supplier_oper_name IN ('Логистика', 'Продажа')
        GROUP BY period_from, period_to
      `).all();
      const insW = fdb.prepare("INSERT INTO weekly_buyout_stats VALUES (?, ?, ?, ?, ?, ?)");
      fdb.transaction(() => {
        for (const w of weeklyRows) {
          const returns = w.orders - w.buyouts;
          insW.run(w.period_from, w.period_to, w.orders, w.buyouts, returns, w.orders > 0 ? returns / w.orders : 0);
        }
      })();
      console.log(`✅ buyout_rates обновлены: ${rows.length} артикулов, ${weeklyRows.length} недель`);
    } catch (e) {
      console.log(`⚠️ buyout_rates: ${e.message}`);
    }
  }

  // WAL checkpoint — сбрасываем WAL чтобы не блокировать readonly соединения
  if (newCount > 0) {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
  }

  // Итог
  const total = db.prepare("SELECT COUNT(*) as c FROM weekly_rows").get();
  const reportsList = db.prepare("SELECT * FROM reports ORDER BY period_from DESC").all();

  console.log(`\n════════════════════════════`);
  if (newCount > 0) {
    console.log(`✅ Загружено новых: ${newCount}`);
  } else {
    console.log(`ℹ️ Новых отчётов нет`);
  }
  console.log(`Всего в базе: ${total.c} строк, ${reportsList.length} отчётов`);
  reportsList.slice(0, 6).forEach((r) =>
    console.log(`  #${r.report_id} type=${r.report_type}: ${r.period_from}—${r.period_to} (${r.rows_count} строк)`)
  );

  db.close();
  
  // Код выхода: 0 = есть новые или нет новых, 1 = ошибка
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Критическая ошибка:", e.message);
  process.exit(1);
});
