#!/usr/bin/env node
/**
 * Создаёт weekly_reports.db и загружает Excel из ЛК WB.
 * Использование:
 *   node scripts/create-weekly-db.js                    — скачивает последний отчёт
 *   node scripts/create-weekly-db.js /path/to/file.xlsx — загружает из файла
 */
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "weekly_reports.db");

// Колонки Excel → snake_case для БД
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

function createDB() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Таблица метаданных отчётов
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

  // Таблица строк отчёта
  const colDefs = COLUMN_MAP.map((c) => `${c.db} ${c.type}`).join(",\n    ");
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

  // Индексы
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_wr_period ON weekly_rows(period_from, period_to);
    CREATE INDEX IF NOT EXISTS idx_wr_report ON weekly_rows(report_id);
    CREATE INDEX IF NOT EXISTS idx_wr_barcode ON weekly_rows(barcode);
    CREATE INDEX IF NOT EXISTS idx_wr_nm ON weekly_rows(nm_id);
    CREATE INDEX IF NOT EXISTS idx_wr_oper ON weekly_rows(supplier_oper_name);
    CREATE INDEX IF NOT EXISTS idx_wr_sale_dt ON weekly_rows(sale_dt);
  `);

  console.log("✅ weekly_reports.db создана: " + DB_PATH);
  console.log("   Колонок в weekly_rows: " + (COLUMN_MAP.length + 5));
  return db;
}

function loadExcel(db, xlsxPath, reportId, reportType, periodFrom, periodTo) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  if (rows.length === 0) {
    console.log("⚠️ Файл пустой: " + xlsxPath);
    return 0;
  }

  // Удалить старые данные за этот отчёт
  db.prepare("DELETE FROM weekly_rows WHERE report_id = ?").run(reportId);
  db.prepare("DELETE FROM reports WHERE report_id = ?").run(reportId);

  // Вставка
  const dbCols = COLUMN_MAP.map((c) => c.db);
  const placeholders = dbCols.map(() => "?").join(",");
  const metaCols = "report_id, report_type, period_from, period_to";
  const metaPlaceholders = "?, ?, ?, ?";

  const insert = db.prepare(
    `INSERT INTO weekly_rows (${metaCols}, ${dbCols.join(",")}) VALUES (${metaPlaceholders}, ${placeholders})`
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

  // Метаданные
  db.prepare(
    "INSERT OR REPLACE INTO reports (report_id, report_type, period_from, period_to, rows_count) VALUES (?, ?, ?, ?, ?)"
  ).run(reportId, reportType, periodFrom, periodTo, rows.length);

  console.log(
    `✅ Загружено: type=${reportType}, ${periodFrom}—${periodTo}, ${rows.length} строк`
  );
  return rows.length;
}

// Main
const db = createDB();

// Загрузка из аргументов или из уже скачанных файлов
if (fs.existsSync("/tmp/weekly-full.xlsx")) {
  loadExcel(db, "/tmp/weekly-full.xlsx", 672230168, 1, "2026-03-23", "2026-03-29");
}
if (fs.existsSync("/tmp/weekly-type2.xlsx")) {
  loadExcel(db, "/tmp/weekly-type2.xlsx", 672230169, 2, "2026-03-23", "2026-03-29");
}

// Проверка
const count = db.prepare("SELECT COUNT(*) as c FROM weekly_rows").get();
const reports = db.prepare("SELECT * FROM reports ORDER BY period_from").all();
console.log("\nИтого в базе: " + count.c + " строк");
reports.forEach((r) =>
  console.log(`  Отчёт #${r.report_id} type=${r.report_type}: ${r.period_from}—${r.period_to} (${r.rows_count} строк)`)
);

db.close();
