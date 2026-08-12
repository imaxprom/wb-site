import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { initShipmentTablesPg } from "@/lib/shipment-db";
import { pgGet, pgRows } from "@/lib/postgres";

interface ProductRow {
  article_wb: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  sizes_json: string | null;
}

interface SizeRow {
  barcode?: unknown;
  size?: unknown;
}

interface VolumeRow {
  barcode: string;
  nm_id: number;
  volume: number;
}

interface StockRow {
  barcode: string;
  quantity: number;
}

interface RemainsVolumeRow {
  barcode: string;
  article_wb: string;
  volume: number;
}

interface MeasurementRow {
  article_wb: string;
  dim_id: number;
  volume: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  measured_at: string;
}

interface LocalizationOrderRow {
  article_wb: string;
  warehouse: string;
  federal_district: string;
  region: string;
}

interface LocalizationMetrics {
  orderQty: number;
  localOrderQty: number;
  localizationSharePercent: number;
  localizationIndex: number;
  salesDistributionIndexPercent: number;
  unmappedWarehouseQty: number;
  tariffOrderQty: number;
  tariffLocalOrderQty: number;
  tariffLocalizationSharePercent: number;
}

const LOCALIZATION_WINDOW_WEEKS = 13;
const LOCALIZATION_WINDOW_DAYS = LOCALIZATION_WINDOW_WEEKS * 7;

const WAREHOUSE_DISTRICT: Record<string, string> = {
  "Коледино": "Центральный федеральный округ",
  "Подольск": "Центральный федеральный округ",
  "Подольск МП": "Центральный федеральный округ",
  "Электросталь": "Центральный федеральный округ",
  "Котовск": "Центральный федеральный округ",
  "Тула": "Центральный федеральный округ",
  "Тула Щегловская": "Центральный федеральный округ",
  "Владимир": "Центральный федеральный округ",
  "Воронеж": "Центральный федеральный округ",
  "Белая дача": "Центральный федеральный округ",
  "Истра": "Центральный федеральный округ",
  "Ногинск": "Центральный федеральный округ",
  "Чашниково": "Центральный федеральный округ",
  "Вёшки": "Центральный федеральный округ",
  "Рязань (Тюшевское)": "Центральный федеральный округ",
  "Домодедово Промышленная": "Центральный федеральный округ",
  "Новоколедино": "Центральный федеральный округ",
  "Щеглово(Холмогоры)": "Центральный федеральный округ",
  "Пушкино": "Центральный федеральный округ",
  "Видное": "Центральный федеральный округ",
  "Виртуальный Москва Сынково": "Центральный федеральный округ",
  "СЦ Внуково": "Центральный федеральный округ",
  "СЦ Софьино": "Центральный федеральный округ",
  "СЦ Ярославль Громова": "Центральный федеральный округ",
  "СЦ Курск": "Центральный федеральный округ",
  "Санкт-Петербург Уткина Заводь": "Центральный федеральный округ",
  "Тверь": "Центральный федеральный округ",

  "СПБ Шушары": "Северо-Западный федеральный округ",
  "СЦ Шушары": "Северо-Западный федеральный округ",
  "СПБ Московское шоссе 177": "Северо-Западный федеральный округ",
  "Калининград": "Северо-Западный федеральный округ",

  "Краснодар": "Южный федеральный округ",
  "Волгоград": "Южный федеральный округ",
  "Волгоград DNS": "Южный федеральный округ",
  "СЦ Адыгея": "Южный федеральный округ",

  "Невинномысск": "Северо-Кавказский федеральный округ",
  "Ногир": "Северо-Кавказский федеральный округ",

  "Казань": "Приволжский федеральный округ",
  "Самара (Новосемейкино)": "Приволжский федеральный округ",
  "Самара": "Приволжский федеральный округ",
  "Сарапул": "Приволжский федеральный округ",
  "Пенза": "Приволжский федеральный округ",
  "Нижнекамск": "Приволжский федеральный округ",
  "Уфа Зубово": "Приволжский федеральный округ",
  "СЦ Кузнецк": "Приволжский федеральный округ",
  "СЦ Ижевск": "Приволжский федеральный округ",
  "Ульяновск Инженерный": "Приволжский федеральный округ",
  "Пермь 3": "Приволжский федеральный округ",
  "СЦ Оренбург Центральная": "Приволжский федеральный округ",

  "Екатеринбург - Испытателей 14г": "Уральский федеральный округ",
  "Екатеринбург - Перспективный 12": "Уральский федеральный округ",
  "Екатеринбург - Перспективная 14": "Уральский федеральный округ",
  "Екатеринбург Черняховского": "Уральский федеральный округ",
  "Сургут": "Уральский федеральный округ",
  "СЦ Тюмень": "Уральский федеральный округ",
  "СЦ Челябинск 2": "Уральский федеральный округ",

  "Новосибирск": "Сибирский федеральный округ",
  "СЦ Барнаул": "Сибирский федеральный округ",
  "Красноярск Старцево": "Сибирский федеральный округ",
  "СЦ Кемерово": "Сибирский федеральный округ",
  "СЦ Омск": "Сибирский федеральный округ",
  "Бийск": "Сибирский федеральный округ",
  "СЦ Томск": "Сибирский федеральный округ",
  "СЦ Новокузнецк": "Сибирский федеральный округ",
  "СЦ Абакан 2": "Сибирский федеральный округ",
  "Улан-Удэ, Ботаническая": "Сибирский федеральный округ",

  "Владивосток": "Дальневосточный федеральный округ",
  "СЦ Хабаровск": "Дальневосточный федеральный округ",
  "СЦ Иркутск": "Дальневосточный федеральный округ",

  "Астана Карагандинское шоссе": "Уральский федеральный округ",
  "Актобе": "Уральский федеральный округ",
  "Атакент": "Сибирский федеральный округ",
  "Ташкент 2": "Сибирский федеральный округ",
  "Минск Привольный": "Центральный федеральный округ",
  "Минск": "Центральный федеральный округ",
  "СЦ Брест": "Центральный федеральный округ",
  "Орша": "Центральный федеральный округ",
  "СЦ Ереван": "Южный федеральный округ",
  "СЦ Гродно": "Центральный федеральный округ",
};

const CIS_REGION_COUNTRY: Record<string, string> = {
  "Минск": "by",
  "Минская область": "by",
  "Брестская область": "by",
  "Витебская область": "by",
  "Гомельская область": "by",
  "Гродненская область": "by",
  "Могилёвская область": "by",

  "Алматы": "kz",
  "Алматинская область": "kz",
  "Астана": "kz",
  "город республиканского значения Астана": "kz",
  "Акмолинская область": "kz",
  "Актюбинская область": "kz",
  "Атырауская область": "kz",
  "Абайская область": "kz",
  "область Абай": "kz",
  "Восточно-Казахстанская область": "kz",
  "Жамбылская область": "kz",
  "Жетысуская область": "kz",
  "область Жетысу": "kz",
  "Западно-Казахстанская область": "kz",
  "Карагандинская область": "kz",
  "Костанайская область": "kz",
  "Кызылординская область": "kz",
  "Мангистауская область": "kz",
  "Павлодарская область": "kz",
  "Северо-Казахстанская область": "kz",
  "Туркестанская область": "kz",
  "Улутауская область": "kz",
  "область Улытау": "kz",
  "Шымкент": "kz",
  "город республиканского значения Байконур": "kz",

  "Ереван": "am",
  "Арагацотнская область": "am",
  "Араратская область": "am",
  "Армавирская область": "am",
  "Вайоцдзорская область": "am",
  "Гехаркуникская область": "am",
  "Котайкская область": "am",
  "Лорийская область": "am",
  "Сюникская область": "am",
  "Тавушская область": "am",
  "Ширакская область": "am",

  "Ташкент": "uz",
  "Ташкентская область": "uz",
  "Бухарская область": "uz",
  "Кашкадарьинская область": "uz",
  "Наманганская область": "uz",
  "Навоийская область": "uz",
  "Республика Каракалпакстан": "uz",
  "Самаркандская область": "uz",

  "город Бишкек": "kg",
  "город республиканского подчинения Бишкек": "kg",
  "город Ош": "kg",
  "город республиканского подчинения Ош": "kg",
  "Баткенская область": "kg",
  "Джалал-Абадская область": "kg",
  "Ошская область": "kg",
  "Чуйская область": "kg",

  "Тбилиси": "ge",
  "Аджарская Автономная Республика": "ge",
  "Самцхе-Джавахети": "ge",
  "Шида Картли": "ge",

  "Душанбе": "tj",
  "Горно-Бадахшанская автономная область": "tj",
  "Согдийская область": "tj",
  "Хатлонская область": "tj",
};

function districtToLocalizationZone(district: string): string | null {
  if (district === "Южный федеральный округ" || district === "Северо-Кавказский федеральный округ") return "yufo-skfo";
  if (district === "Сибирский федеральный округ" || district === "Дальневосточный федеральный округ") return "sfo-dfo";
  if (district === "Центральный федеральный округ") return "cfo";
  if (district === "Северо-Западный федеральный округ") return "szfo";
  if (district === "Приволжский федеральный округ") return "pfo";
  if (district === "Уральский федеральный округ") return "ufo";
  return null;
}

function getBuyerLocalizationZone(federalDistrict: string, region: string): string | null {
  const rfZone = districtToLocalizationZone(federalDistrict);
  if (rfZone) return rfZone;

  const cisCountry = CIS_REGION_COUNTRY[region];
  return cisCountry ? `cis-${cisCountry}` : null;
}

function getWarehouseLocalizationZone(warehouse: string): string | null {
  const lower = warehouse.toLowerCase();

  if (lower.includes("минск") || lower.includes("брест") || lower.includes("гродно") || lower.includes("орша") || lower.includes("гомель")) {
    return "cis-by";
  }
  if (lower.includes("астана") || lower.includes("актобе") || lower.includes("атакент")) {
    return "cis-kz";
  }
  if (lower.includes("ереван")) {
    return "cis-am";
  }
  if (lower.includes("ташкент")) {
    return "cis-uz";
  }

  const warehouseDistrict = getWarehouseDistrict(warehouse);
  return warehouseDistrict ? districtToLocalizationZone(warehouseDistrict) : null;
}

function getWarehouseDistrict(warehouse: string): string | null {
  if (WAREHOUSE_DISTRICT[warehouse]) return WAREHOUSE_DISTRICT[warehouse];
  const lower = warehouse.toLowerCase();
  if (lower.includes("москв") || lower.includes("подольск") || lower.includes("коледино") || lower.includes("рязань") || lower.includes("тула")) return "Центральный федеральный округ";
  if (lower.includes("петербург") || lower.includes("спб") || lower.includes("шушар") || lower.includes("калининград")) return "Северо-Западный федеральный округ";
  if (lower.includes("краснодар") || lower.includes("волгоград") || lower.includes("ростов") || lower.includes("адыге")) return "Южный федеральный округ";
  if (lower.includes("невинномысск") || lower.includes("пятигорск") || lower.includes("ногир")) return "Северо-Кавказский федеральный округ";
  if (lower.includes("казань") || lower.includes("самар") || lower.includes("уфа") || lower.includes("пенз") || lower.includes("пермь") || lower.includes("сарапул")) return "Приволжский федеральный округ";
  if (lower.includes("екатеринбург") || lower.includes("челябинск") || lower.includes("тюмень") || lower.includes("сургут")) return "Уральский федеральный округ";
  if (lower.includes("новосибирск") || lower.includes("красноярск") || lower.includes("омск") || lower.includes("барнаул") || lower.includes("кемеров") || lower.includes("улан")) return "Сибирский федеральный округ";
  if (lower.includes("владивосток") || lower.includes("хабаровск") || lower.includes("иркутск")) return "Дальневосточный федеральный округ";
  return null;
}

function ktrByLocalizationShare(share: number): number {
  if (share >= 95) return 0.5;
  if (share >= 90) return 0.6;
  if (share >= 85) return 0.7;
  if (share >= 80) return 0.8;
  if (share >= 75) return 0.9;
  if (share >= 60) return 1.0;
  if (share >= 55) return 1.05;
  if (share >= 50) return 1.1;
  if (share >= 45) return 1.2;
  if (share >= 40) return 1.3;
  if (share >= 35) return 1.4;
  if (share >= 30) return 1.5;
  if (share >= 25) return 1.55;
  if (share >= 20) return 1.6;
  if (share >= 15) return 1.7;
  if (share >= 10) return 1.75;
  if (share >= 5) return 1.8;
  return 2.0;
}

function krpByLocalizationShare(share: number): number {
  if (share >= 60) return 0;
  if (share >= 55) return 2.0;
  if (share >= 45) return 2.05;
  if (share >= 35) return 2.1;
  if (share >= 30) return 2.15;
  if (share >= 25) return 2.2;
  if (share >= 20) return 2.25;
  if (share >= 15) return 2.3;
  if (share >= 10) return 2.35;
  if (share >= 5) return 2.45;
  return 2.5;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function floor(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.floor(value * factor) / factor;
}

function getFullWeekWindow(anchorDate: string) {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const day = anchor.getUTCDay() || 7;
  const currentMonday = new Date(anchor);
  currentMonday.setUTCDate(anchor.getUTCDate() - day + 1);

  const end = new Date(currentMonday);
  end.setUTCDate(currentMonday.getUTCDate() - 1);

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - LOCALIZATION_WINDOW_DAYS + 1);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dimensionsVolumeLiters(row: ProductRow): number | null {
  const length = Number(row.length_cm) || 0;
  const width = Number(row.width_cm) || 0;
  const height = Number(row.height_cm) || 0;
  if (length <= 0 || width <= 0 || height <= 0) return null;
  return Math.round((length * width * height / 1000) * 1000) / 1000;
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

async function calculateLocalizationMetricsPg() {
  if (!await tableExistsPg("shipment_orders")) {
    return {
      byArticle: new Map<string, LocalizationMetrics>(),
      meta: null,
    };
  }

  const maxDateRow = await pgGet<{ max_date: string | null }>("SELECT MAX(SUBSTR(date, 1, 10)) AS max_date FROM shipment_orders");
  const maxDate = maxDateRow?.max_date || null;
  if (!maxDate) {
    return {
      byArticle: new Map<string, LocalizationMetrics>(),
      meta: null,
    };
  }

  const window = getFullWeekWindow(maxDate);
  const rows = await pgRows<LocalizationOrderRow>(`
    SELECT
      CAST(article_wb AS TEXT) AS article_wb,
      TRIM(COALESCE(warehouse, '')) AS warehouse,
      TRIM(COALESCE(federal_district, '')) AS federal_district,
      TRIM(COALESCE(region, '')) AS region
    FROM shipment_orders
    WHERE SUBSTR(date, 1, 10) >= ?
      AND SUBSTR(date, 1, 10) <= ?
      AND TRIM(COALESCE(CAST(article_wb AS TEXT), '')) != ''
  `, [window.startDate, window.endDate]);

  const reportDraft = new Map<string, { orderQty: number; localOrderQty: number; unmappedWarehouseQty: number }>();
  const tariffDraft = new Map<string, { orderQty: number; localOrderQty: number; unmappedWarehouseQty: number }>();
  let reportTotalOrders = 0;
  let reportTotalLocalOrders = 0;
  let reportUnmappedWarehouseOrders = 0;
  let tariffTotalOrders = 0;
  let tariffTotalLocalOrders = 0;
  let tariffUnmappedWarehouseOrders = 0;
  let unmappedBuyerOrders = 0;

  for (const row of rows) {
    const article = clean(row.article_wb);
    const buyerZone = getBuyerLocalizationZone(clean(row.federal_district), clean(row.region));
    if (!article) continue;
    if (!buyerZone) {
      unmappedBuyerOrders++;
      continue;
    }

    const warehouseZone = getWarehouseLocalizationZone(clean(row.warehouse));
    const isLocal = Boolean(warehouseZone && warehouseZone === buyerZone);
    const reportItem = reportDraft.get(article) || { orderQty: 0, localOrderQty: 0, unmappedWarehouseQty: 0 };
    reportItem.orderQty++;
    if (isLocal) reportItem.localOrderQty++;
    if (!warehouseZone) {
      reportItem.unmappedWarehouseQty++;
      reportUnmappedWarehouseOrders++;
    }
    reportDraft.set(article, reportItem);

    reportTotalOrders++;
    if (isLocal) reportTotalLocalOrders++;

    if (buyerZone.startsWith("cis-")) continue;

    const tariffItem = tariffDraft.get(article) || { orderQty: 0, localOrderQty: 0, unmappedWarehouseQty: 0 };
    tariffItem.orderQty++;
    if (isLocal) tariffItem.localOrderQty++;
    if (!warehouseZone) {
      tariffItem.unmappedWarehouseQty++;
      tariffUnmappedWarehouseOrders++;
    }
    tariffDraft.set(article, tariffItem);

    tariffTotalOrders++;
    if (isLocal) tariffTotalLocalOrders++;
  }

  const byArticle = new Map<string, LocalizationMetrics>();
  let weightedKtr = 0;
  let weightedKrp = 0;
  for (const [article, item] of reportDraft) {
    const tariffItem = tariffDraft.get(article) || { orderQty: 0, localOrderQty: 0, unmappedWarehouseQty: 0 };
    const reportShare = item.orderQty > 0 ? item.localOrderQty / item.orderQty * 100 : 0;
    const tariffShare = tariffItem.orderQty > 0 ? tariffItem.localOrderQty / tariffItem.orderQty * 100 : 0;
    const localizationIndex = tariffItem.orderQty > 0 ? ktrByLocalizationShare(tariffShare) : 0;
    const salesDistributionIndexPercent = tariffItem.orderQty > 0 ? krpByLocalizationShare(tariffShare) : 0;
    weightedKtr += tariffItem.orderQty * localizationIndex;
    weightedKrp += tariffItem.orderQty * salesDistributionIndexPercent;
    byArticle.set(article, {
      orderQty: item.orderQty,
      localOrderQty: item.localOrderQty,
      localizationSharePercent: round(reportShare, 2),
      localizationIndex,
      salesDistributionIndexPercent,
      unmappedWarehouseQty: item.unmappedWarehouseQty,
      tariffOrderQty: tariffItem.orderQty,
      tariffLocalOrderQty: tariffItem.localOrderQty,
      tariffLocalizationSharePercent: round(tariffShare, 2),
    });
  }

  const localizationIndexRaw = tariffTotalOrders > 0 ? weightedKtr / tariffTotalOrders : 0;
  const salesDistributionIndexRaw = tariffTotalOrders > 0 ? weightedKrp / tariffTotalOrders : 0;

  return {
    byArticle,
    meta: {
      orderWindowDays: LOCALIZATION_WINDOW_DAYS,
      orderWindowWeeks: LOCALIZATION_WINDOW_WEEKS,
      orderWindowEndDate: window.endDate,
      orderWindowStartDate: window.startDate,
      eligibleOrderQty: reportTotalOrders,
      localOrderQty: reportTotalLocalOrders,
      localizationSharePercent: reportTotalOrders > 0 ? round(reportTotalLocalOrders / reportTotalOrders * 100, 2) : 0,
      tariffEligibleOrderQty: tariffTotalOrders,
      tariffLocalOrderQty: tariffTotalLocalOrders,
      tariffLocalizationSharePercent: tariffTotalOrders > 0 ? round(tariffTotalLocalOrders / tariffTotalOrders * 100, 2) : 0,
      localizationIndex: floor(localizationIndexRaw, 2),
      localizationIndexRaw: round(localizationIndexRaw, 4),
      salesDistributionIndexPercent: floor(salesDistributionIndexRaw, 2),
      salesDistributionIndexPercentRaw: round(salesDistributionIndexRaw, 4),
      unmappedWarehouseOrderQty: reportUnmappedWarehouseOrders,
      tariffUnmappedWarehouseOrderQty: tariffUnmappedWarehouseOrders,
      excludedForeignOrderQty: unmappedBuyerOrders,
      exceptionOrderQty: 0,
      model: "report_locality_all_regions_tariff_indices_rf_only_13_full_weeks_without_current_week_or_exception_categories",
      ktrSource: "WB table copied from Tariffs -> Warehouse tariffs -> Localization index",
      krpSource: "WB sales-distribution-index instruction",
    },
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    await initShipmentTablesPg();
    const localization = await calculateLocalizationMetricsPg();

    const volumeByBarcode = new Map<string, number>();
    const volumeByNm = new Map<number, number>();
    const hasPaidStorage = await tableExistsPg("paid_storage");
    if (hasPaidStorage) {
      const volumeSql = `
        SELECT
          TRIM(COALESCE(barcode, '')) AS barcode,
          nm_id,
          MAX(volume) AS volume
        FROM paid_storage
        WHERE volume > 0
        GROUP BY TRIM(COALESCE(barcode, '')), nm_id
      `;
      const volumeRows = await pgRows<VolumeRow>(volumeSql);

      for (const row of volumeRows) {
        const volume = Number(row.volume) || 0;
        if (volume <= 0) continue;
        const barcode = clean(row.barcode);
        if (barcode) volumeByBarcode.set(barcode, Math.max(volumeByBarcode.get(barcode) || 0, volume));
        if (row.nm_id > 0) volumeByNm.set(row.nm_id, Math.max(volumeByNm.get(row.nm_id) || 0, volume));
      }
    }

    const stockByBarcode = new Map<string, number>();
    const hasShipmentStock = await tableExistsPg("shipment_stock");
    if (hasShipmentStock) {
      const stockSql = `
        SELECT TRIM(COALESCE(barcode, '')) AS barcode, SUM(quantity) AS quantity
        FROM shipment_stock
        WHERE TRIM(COALESCE(barcode, '')) != ''
        GROUP BY TRIM(COALESCE(barcode, ''))
      `;
      const stockRows = await pgRows<StockRow>(stockSql);
      for (const row of stockRows) {
        stockByBarcode.set(row.barcode, Number(row.quantity) || 0);
      }
    }

    const remainsVolumeByBarcode = new Map<string, number>();
    const remainsVolumeByNm = new Map<string, number>();
    const hasWarehouseRemainsVolume = await tableExistsPg("warehouse_remains_volume");
    if (hasWarehouseRemainsVolume) {
      const remainsSql = `
        SELECT
          TRIM(COALESCE(barcode, '')) AS barcode,
          article_wb,
          MAX(volume) AS volume
        FROM warehouse_remains_volume
        WHERE volume > 0
        GROUP BY TRIM(COALESCE(barcode, '')), article_wb
      `;
      const remainsRows = await pgRows<RemainsVolumeRow>(remainsSql);

      for (const row of remainsRows) {
        const volume = Number(row.volume) || 0;
        if (volume <= 0) continue;
        const barcode = clean(row.barcode);
        const article = clean(row.article_wb);
        if (barcode) remainsVolumeByBarcode.set(barcode, Math.max(remainsVolumeByBarcode.get(barcode) || 0, volume));
        if (article) remainsVolumeByNm.set(article, Math.max(remainsVolumeByNm.get(article) || 0, volume));
      }
    }

    const measurementsByNm = new Map<string, Array<{
      dimId: number;
      volumeLiters: number | null;
      dimensions: {
        lengthCm: number;
        widthCm: number;
        heightCm: number;
      };
      measuredAt: string;
    }>>();
    const hasWarehouseMeasurements = await tableExistsPg("warehouse_measurements");
    if (hasWarehouseMeasurements) {
      const measurementSql = `
        SELECT
          article_wb,
          dim_id,
          volume,
          length_cm,
          width_cm,
          height_cm,
          measured_at
        FROM warehouse_measurements
        WHERE TRIM(COALESCE(article_wb, '')) != ''
        ORDER BY article_wb, measured_at, dim_id
      `;
      const measurementRows = await pgRows<MeasurementRow>(measurementSql);

      for (const row of measurementRows) {
        const article = clean(row.article_wb);
        if (!article) continue;
        const measurements = measurementsByNm.get(article) || [];
        measurements.push({
          dimId: Number(row.dim_id) || 0,
          volumeLiters: row.volume === null ? null : Number(row.volume) || null,
          dimensions: {
            lengthCm: Number(row.length_cm) || 0,
            widthCm: Number(row.width_cm) || 0,
            heightCm: Number(row.height_cm) || 0,
          },
          measuredAt: clean(row.measured_at),
        });
        measurementsByNm.set(article, measurements);
      }
    }

    const productsSql = `
      SELECT article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json
      FROM shipment_products
      ORDER BY article_wb
    `;
    const rows = await pgRows<ProductRow>(productsSql);

    const products = rows.flatMap((row) => {
      const nmId = Number(row.article_wb) || 0;
      const cardVolume = dimensionsVolumeLiters(row);
      const fallbackVolume = volumeByNm.get(nmId) || null;
      const remainsVolume = remainsVolumeByNm.get(row.article_wb) || null;
      const volumeLiters = cardVolume || fallbackVolume;
      const measurementHistory = measurementsByNm.get(row.article_wb) || [];
      let sizes: SizeRow[] = [];
      try {
        const parsed = JSON.parse(row.sizes_json || "[]");
        sizes = Array.isArray(parsed) ? parsed : [];
      } catch {
        sizes = [];
      }

      if (sizes.length === 0) {
        const localizationMetrics = localization.byArticle.get(row.article_wb) || null;
        return [{
          articleWB: row.article_wb,
          articleSeller: clean(row.name),
          brand: clean(row.brand),
          category: clean(row.category),
          size: "",
          barcode: "",
          volumeLiters,
          cardVolumeLiters: cardVolume,
          storageVolumeLiters: fallbackVolume,
          remainsVolumeLiters: remainsVolume,
          measurementHistory,
          volumeSource: cardVolume ? "card_dimensions" : (fallbackVolume ? "paid_storage" : null),
          dimensions: {
            lengthCm: Number(row.length_cm) || 0,
            widthCm: Number(row.width_cm) || 0,
            heightCm: Number(row.height_cm) || 0,
          },
          stockQty: 0,
          localization: localizationMetrics,
        }];
      }

      return sizes.map((size) => {
        const barcode = clean(size.barcode);
        const storageVolume = volumeByBarcode.get(barcode) || fallbackVolume;
        const remainsVolume = remainsVolumeByBarcode.get(barcode) || remainsVolumeByNm.get(row.article_wb) || null;
        const localizationMetrics = localization.byArticle.get(row.article_wb) || null;
        return {
          articleWB: row.article_wb,
          articleSeller: clean(row.name),
          brand: clean(row.brand),
          category: clean(row.category),
          size: clean(size.size),
          barcode,
          volumeLiters: cardVolume || storageVolume,
          cardVolumeLiters: cardVolume,
          storageVolumeLiters: storageVolume || null,
          remainsVolumeLiters: remainsVolume,
          measurementHistory,
          volumeSource: cardVolume ? "card_dimensions" : (storageVolume ? "paid_storage" : null),
          dimensions: {
            lengthCm: Number(row.length_cm) || 0,
            widthCm: Number(row.width_cm) || 0,
            heightCm: Number(row.height_cm) || 0,
          },
          stockQty: stockByBarcode.get(barcode) || 0,
          localization: localizationMetrics,
        };
      });
    });

    return NextResponse.json({
      products,
      meta: {
        total: products.length,
        withVolume: products.filter((row) => row.volumeLiters && row.volumeLiters > 0).length,
        withCardDimensions: products.filter((row) => row.volumeSource === "card_dimensions").length,
        withStorageVolume: products.filter((row) => row.storageVolumeLiters && row.storageVolumeLiters > 0).length,
        withRemainsVolume: products.filter((row) => row.remainsVolumeLiters && row.remainsVolumeLiters > 0).length,
        withMeasurements: products.filter((row) => row.measurementHistory.length > 0).length,
        volumeSource: "card_dimensions",
        fallbackVolumeSource: "paid_storage.volume",
        remainsVolumeSource: "warehouse_remains.volume",
        measurementsSource: "warehouse_measurements",
        localization: localization.meta,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
