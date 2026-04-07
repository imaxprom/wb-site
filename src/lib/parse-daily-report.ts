import * as XLSX from "xlsx";
import fs from "fs";

/**
 * Row structure matching the `realization` table in SQLite.
 * Only fields we can extract from the daily report.
 */
export interface RealizationRow {
  rrd_id: number;
  realizationreport_id: number;
  date_from: string;
  date_to: string;
  rr_dt: string;
  sale_dt: string;
  order_dt: string;
  supplier_oper_name: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
  barcode: string;
  brand_name: string;
  subject_name: string;
  quantity: number;
  retail_price: number;
  retail_price_withdisc_rub: number;
  retail_amount: number;
  ppvz_for_pay: number;
  ppvz_sales_commission: number;
  acquiring_fee: number;
  delivery_rub: number;
  delivery_amount: number;
  return_amount: number;
  storage_fee: number;
  penalty: number;
  acceptance: number;
  rebill_logistic_cost: number;
  additional_payment: number;
  commission_percent: number;
  ppvz_spp_prc: number;
  ppvz_kvw_prc_base: number;
  ppvz_kvw_prc: number;
  ppvz_supplier_name: string;
  site_country: string;
  office_name: string;
  deduction: number;
  bonus_type_name: string;
}

/**
 * Column name mapping: WB XLS header (Russian) → realization table column.
 * WB daily report uses the same structure as weekly reports.
 */
const COLUMN_MAP: Record<string, keyof RealizationRow> = {
  "Номер строки": "rrd_id",
  "№ отчёта": "realizationreport_id",
  "Номер отчета": "realizationreport_id",
  "Дата начала отчётного периода": "date_from",
  "Дата начала отчетного периода": "date_from",
  "Дата конца отчётного периода": "date_to",
  "Дата конца отчетного периода": "date_to",
  "Дата создания": "rr_dt",
  "Дата операции": "rr_dt",
  "Дата продажи": "sale_dt",
  "Дата заказа": "order_dt",
  "Обоснование для оплаты": "supplier_oper_name",
  "Тип операции": "supplier_oper_name",
  "Артикул продавца": "sa_name",
  "Артикул WB": "nm_id",
  "Номенклатура": "nm_id",
  "Код номенклатуры": "nm_id",
  "Размер": "ts_name",
  "Баркод": "barcode",
  "Бренд": "brand_name",
  "Предмет": "subject_name",
  "Количество": "quantity",
  "Кол-во": "quantity",
  "Цена розничная": "retail_price",
  "Цена розничная с учетом согласованной скидки": "retail_price_withdisc_rub",
  "Вайлдберриз реализовал Товар (Пр)": "retail_price_withdisc_rub",
  "Сумма продажи": "retail_amount",
  "К перечислению за товар": "ppvz_for_pay",
  "К перечислению Продавцу за реализованный Товар": "ppvz_for_pay",
  "Комиссия WB": "ppvz_sales_commission",
  "Вознаграждение Вайлдберриз": "ppvz_sales_commission",
  "Возмещение за выдачу и возврат товаров на ПВЗ": "acquiring_fee",
  "Услуги по доставке товара покупателю": "delivery_rub",
  "Логистика": "delivery_rub",
  "Кол-во доставок": "delivery_amount",
  "Кол-во возвратов": "return_amount",
  "Хранение": "storage_fee",
  "Штрафы": "penalty",
  "Приёмка": "acceptance",
  "Обратная логистика": "rebill_logistic_cost",
  "Доп. оплата": "additional_payment",
  "Процент комиссии": "commission_percent",
  "Размер скидки постоянного покупателя (СПП)": "ppvz_spp_prc",
  "Процент базовой комиссии": "ppvz_kvw_prc_base",
  "Итоговый процент комиссии": "ppvz_kvw_prc",
  "Поставщик": "ppvz_supplier_name",
  "Страна": "site_country",
  "Склад": "office_name",
  "Удержания": "deduction",
  "Обоснование удержаний": "bonus_type_name",
};

const DEFAULT_ROW: RealizationRow = {
  rrd_id: 0,
  realizationreport_id: 0,
  date_from: "",
  date_to: "",
  rr_dt: "",
  sale_dt: "",
  order_dt: "",
  supplier_oper_name: "",
  nm_id: 0,
  sa_name: "",
  ts_name: "",
  barcode: "",
  brand_name: "",
  subject_name: "",
  quantity: 0,
  retail_price: 0,
  retail_price_withdisc_rub: 0,
  retail_amount: 0,
  ppvz_for_pay: 0,
  ppvz_sales_commission: 0,
  acquiring_fee: 0,
  delivery_rub: 0,
  delivery_amount: 0,
  return_amount: 0,
  storage_fee: 0,
  penalty: 0,
  acceptance: 0,
  rebill_logistic_cost: 0,
  additional_payment: 0,
  commission_percent: 0,
  ppvz_spp_prc: 0,
  ppvz_kvw_prc_base: 0,
  ppvz_kvw_prc: 0,
  ppvz_supplier_name: "",
  site_country: "",
  office_name: "",
  deduction: 0,
  bonus_type_name: "",
};

/**
 * Parse a WB daily/weekly financial report XLS file.
 * Returns array of rows compatible with `realization` table.
 */
export function parseDailyReport(filePath: string): RealizationRow[] {
  const buf = fs.readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer", cellDates: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("XLS файл не содержит листов");

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rawRows.length === 0) throw new Error("Отчёт пустой");

  // Build column mapping from actual headers
  const firstRow = rawRows[0];
  const headerKeys = Object.keys(firstRow);
  const colMapping: Record<string, keyof RealizationRow> = {};

  for (const header of headerKeys) {
    const trimmed = header.trim();
    // Direct match
    if (COLUMN_MAP[trimmed]) {
      colMapping[header] = COLUMN_MAP[trimmed];
      continue;
    }
    // Fuzzy match — check if header contains a known key
    for (const [known, field] of Object.entries(COLUMN_MAP)) {
      if (trimmed.toLowerCase().includes(known.toLowerCase()) ||
          known.toLowerCase().includes(trimmed.toLowerCase())) {
        colMapping[header] = field;
        break;
      }
    }
  }

  const rows: RealizationRow[] = [];

  for (const raw of rawRows) {
    const row: RealizationRow = { ...DEFAULT_ROW };

    for (const [header, field] of Object.entries(colMapping)) {
      const val = raw[header];
      if (val === undefined || val === null || val === "") continue;

      // Type coercion based on field type
      if (typeof DEFAULT_ROW[field] === "number") {
        const num = typeof val === "number" ? val : parseFloat(String(val).replace(/\s/g, "").replace(",", "."));
        if (!isNaN(num)) (row as unknown as Record<string, unknown>)[field] = num;
      } else if (typeof DEFAULT_ROW[field] === "string") {
        if (val instanceof Date) {
          (row as unknown as Record<string, unknown>)[field] = val.toISOString().slice(0, 10);
        } else {
          (row as unknown as Record<string, unknown>)[field] = String(val).trim();
        }
      }
    }

    // Skip empty rows
    if (!row.supplier_oper_name && !row.nm_id && !row.barcode) continue;

    // Ensure dates are populated
    if (!row.sale_dt && row.rr_dt) row.sale_dt = row.rr_dt;
    if (!row.rr_dt && row.sale_dt) row.rr_dt = row.sale_dt;

    rows.push(row);
  }

  return rows;
}

/**
 * Detect the date range covered by parsed rows.
 */
export function getReportDateRange(rows: RealizationRow[]): { from: string; to: string } {
  let minDate = "9999-99-99";
  let maxDate = "0000-00-00";

  for (const row of rows) {
    const dt = row.sale_dt || row.rr_dt;
    if (dt && dt < minDate) minDate = dt;
    if (dt && dt > maxDate) maxDate = dt;
  }

  return { from: minDate, to: maxDate };
}
