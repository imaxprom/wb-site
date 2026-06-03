"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, ChevronRight, Grid3X3, Layers3, ListTree, PackageCheck, Rows3, Settings2, ShoppingCart, type LucideIcon } from "lucide-react";

type CategoryKey = "rib" | "smooth" | "stringRib";
type SizeGroup = "small" | "big";
type DisplayVariant = "1" | "2" | "3" | "4" | "5";
type PurchaseCategoryValue = CategoryKey | "none";
type PageMode = "calculator" | "settings";
type PurchaseMultiplier = 1 | 1.5 | 2 | 2.5 | 3;

interface SizeRow {
  size: string;
  group: SizeGroup;
  barcode: string;
  perBox: number;
  wbStockKits: number;
  sales30Kits: number;
}

interface PurchaseArticle {
  category: CategoryKey;
  article: string;
  title: string;
  colors: Record<string, number>;
  sizes: SizeRow[];
}

interface ArticleSetting {
  article: string;
  enabled: boolean;
  category: PurchaseCategoryValue;
}

interface NeedRow {
  category: CategoryKey;
  size: string;
  group: SizeGroup;
  color: string;
  stockPieces: number;
  salesPieces: number;
  needBeforeWarehousePieces: number;
  warehousePieces: number;
  warehouseMergedPieces: number;
  needPieces: number;
  packs: number;
  articleBreakdown: Array<{
    article: string;
    title: string;
    colorQty: number;
    stockPieces: number;
    salesPieces: number;
    needBeforeWarehousePieces: number;
  }>;
}

interface PurchaseStockSizeRow {
  size: string;
  boxes: number;
  packs: number;
  pieces: number;
}

interface PurchaseStockColorRow {
  color: string;
  bags: number;
  bagPacks: number;
  loosePacks: number;
  commonBoxes: number;
  sharedPacks: number;
  sizeBoxPacks: number;
  totalPacks: number;
  sizeRows: PurchaseStockSizeRow[];
}

interface PurchaseStockSheet {
  key: CategoryKey;
  title: string;
  label: string;
  small: PurchaseStockColorRow[];
  big: PurchaseStockColorRow[];
  totals: {
    packs: number;
    sharedPacks: number;
    sizeBoxPacks: number;
    colors: number;
  };
}

interface WarehouseArticleConfig {
  article: string;
  sheetName: string;
  category: PurchaseCategoryValue;
  colors: Record<string, number>;
}

interface ProductApiItem {
  articleWB: string;
  name: string;
  brand: string;
  category: string;
  sizes: Array<{
    size: string;
    barcode: string;
    perBox: number;
  }>;
}

interface StockApiItem {
  articleWB: string;
  barcode: string;
  size: string;
  totalOnWarehouses: number;
}

interface OrdersAggregatedApi {
  perBarcode: Record<string, {
    barcode: string;
    totalOrders: number;
    cancelledOrders: number;
  }>;
}

interface PurchasesStockApiResponse {
  ok?: boolean;
  error?: unknown;
  sheets?: PurchaseStockSheet[];
  warehouseArticleConfigs?: WarehouseArticleConfig[];
  warehouseConfigError?: string;
}

const COLORS = [
  "Черный",
  "Белый",
  "Персик",
  "Серый",
  "Бирюза",
  "Бордо",
  "Фиолетовый",
  "Зеленый",
  "Розовый",
  "Синий",
];
const COLOR_ORDER = COLORS;

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  rib: "Трусы в рубчик",
  smooth: "Трусы гладкие",
  stringRib: "Трусы-стринги в рубчик",
};

const CATEGORY_OPTIONS: Array<{ key: PurchaseCategoryValue; label: string }> = [
  { key: "none", label: "Не участвует" },
  { key: "rib", label: CATEGORY_LABELS.rib },
  { key: "smooth", label: CATEGORY_LABELS.smooth },
  { key: "stringRib", label: CATEGORY_LABELS.stringRib },
];

const DISPLAY_VARIANTS: Array<{ key: DisplayVariant; label: string; title: string }> = [
  { key: "1", label: "1", title: "Матрица цвет x размер" },
  { key: "2", label: "2", title: "Цвет слева, детализация справа" },
  { key: "3", label: "3", title: "Тепловая карта дефицита" },
  { key: "4", label: "4", title: "Закупка пачками по группам" },
  { key: "5", label: "5", title: "Контроль по артикулам" },
];

const SIZE_ORDER = ["42-44", "44-46", "46-48", "48-50", "50-52", "52-54"];
const INPUT_SIZE_ORDER = ["40-42", ...SIZE_ORDER];
const PACK_DIVISOR = 12;
const BASE_SALES_DAYS = 30;
const PURCHASE_MULTIPLIERS: PurchaseMultiplier[] = [1, 1.5, 2, 2.5, 3];

const articles: PurchaseArticle[] = [
  {
    category: "rib",
    article: "165140159",
    title: "Слипы в рубчик 7 шт / 7 цветов",
    colors: { "Черный": 1, "Белый": 1, "Персик": 1, "Серый": 1, "Бирюза": 1, "Бордо": 1, "Фиолетовый": 1 },
    sizes: [
      { size: "40-42", group: "small", barcode: "2043450654919", perBox: 90, wbStockKits: 187, sales30Kits: 2492 },
      { size: "42-44", group: "small", barcode: "2043450621317", perBox: 90, wbStockKits: 405, sales30Kits: 3956 },
      { size: "44-46", group: "small", barcode: "2043450625865", perBox: 90, wbStockKits: 486, sales30Kits: 5276 },
      { size: "46-48", group: "small", barcode: "2043450627401", perBox: 80, wbStockKits: 594, sales30Kits: 5126 },
      { size: "48-50", group: "big", barcode: "2038048383333", perBox: 80, wbStockKits: 497, sales30Kits: 3582 },
      { size: "50-52", group: "big", barcode: "2038048383753", perBox: 70, wbStockKits: 766, sales30Kits: 3158 },
      { size: "52-54", group: "big", barcode: "2038048384422", perBox: 70, wbStockKits: 882, sales30Kits: 2716 },
    ],
  },
  {
    category: "rib",
    article: "178439058",
    title: "Слипы в рубчик 7 шт / 3 цвета",
    colors: { "Черный": 3, "Белый": 2, "Персик": 2 },
    sizes: [
      { size: "40-42", group: "small", barcode: "2043449150279", perBox: 90, wbStockKits: 135, sales30Kits: 356 },
      { size: "42-44", group: "small", barcode: "2038669084527", perBox: 90, wbStockKits: 163, sales30Kits: 502 },
      { size: "44-46", group: "small", barcode: "2038669084770", perBox: 90, wbStockKits: 182, sales30Kits: 384 },
      { size: "46-48", group: "small", barcode: "2038669084954", perBox: 80, wbStockKits: 0, sales30Kits: 416 },
      { size: "48-50", group: "big", barcode: "2043450197201", perBox: 80, wbStockKits: 100, sales30Kits: 322 },
      { size: "50-52", group: "big", barcode: "2043450198833", perBox: 70, wbStockKits: 68, sales30Kits: 260 },
      { size: "52-54", group: "big", barcode: "2043450201076", perBox: 70, wbStockKits: 189, sales30Kits: 224 },
    ],
  },
  {
    category: "rib",
    article: "322000486",
    title: "Слипы в рубчик 9 шт / 9 цветов",
    colors: { "Черный": 1, "Белый": 1, "Персик": 1, "Серый": 1, "Бирюза": 1, "Бордо": 1, "Зеленый": 1, "Розовый": 1, "Синий": 1 },
    sizes: [
      { size: "40-42", group: "small", barcode: "2042798684350", perBox: 90, wbStockKits: 567, sales30Kits: 3378 },
      { size: "42-44", group: "small", barcode: "2042679166388", perBox: 90, wbStockKits: 814, sales30Kits: 6268 },
      { size: "44-46", group: "small", barcode: "2042679167262", perBox: 90, wbStockKits: 1223, sales30Kits: 7926 },
      { size: "46-48", group: "small", barcode: "2042679169150", perBox: 80, wbStockKits: 1703, sales30Kits: 9000 },
      { size: "48-50", group: "big", barcode: "2042679170798", perBox: 80, wbStockKits: 1023, sales30Kits: 6078 },
      { size: "50-52", group: "big", barcode: "2042679177483", perBox: 70, wbStockKits: 1031, sales30Kits: 5014 },
      { size: "52-54", group: "big", barcode: "2042679205360", perBox: 70, wbStockKits: 1131, sales30Kits: 5166 },
    ],
  },
  {
    category: "smooth",
    article: "398657691",
    title: "Слипы гладкие 9 шт / 9 цветов",
    colors: { "Черный": 1, "Белый": 1, "Персик": 1, "Серый": 1, "Бирюза": 1, "Бордо": 1, "Зеленый": 1, "Розовый": 1, "Синий": 1 },
    sizes: [
      { size: "40-42", group: "small", barcode: "2043775779342", perBox: 90, wbStockKits: 408, sales30Kits: 1660 },
      { size: "42-44", group: "small", barcode: "2043775812704", perBox: 90, wbStockKits: 596, sales30Kits: 3060 },
      { size: "44-46", group: "small", barcode: "2043775814661", perBox: 90, wbStockKits: 802, sales30Kits: 5020 },
      { size: "46-48", group: "small", barcode: "2043775816092", perBox: 80, wbStockKits: 806, sales30Kits: 5920 },
      { size: "48-50", group: "big", barcode: "2043775811530", perBox: 80, wbStockKits: 1003, sales30Kits: 4110 },
      { size: "50-52", group: "big", barcode: "2043775801647", perBox: 70, wbStockKits: 845, sales30Kits: 4000 },
      { size: "52-54", group: "big", barcode: "2043775810595", perBox: 70, wbStockKits: 795, sales30Kits: 3770 },
    ],
  },
  {
    category: "smooth",
    article: "431925632",
    title: "Слипы гладкие 8 шт / 2 цвета",
    colors: { "Черный": 4, "Серый": 4 },
    sizes: [
      { size: "40-42", group: "small", barcode: "2044251019037", perBox: 90, wbStockKits: 120, sales30Kits: 260 },
      { size: "42-44", group: "small", barcode: "2044251019044", perBox: 90, wbStockKits: 160, sales30Kits: 420 },
      { size: "44-46", group: "small", barcode: "2044251019051", perBox: 90, wbStockKits: 180, sales30Kits: 610 },
      { size: "46-48", group: "small", barcode: "2044251019068", perBox: 80, wbStockKits: 170, sales30Kits: 690 },
      { size: "48-50", group: "big", barcode: "2044251019075", perBox: 80, wbStockKits: 130, sales30Kits: 520 },
      { size: "50-52", group: "big", barcode: "2044251019082", perBox: 70, wbStockKits: 150, sales30Kits: 480 },
      { size: "52-54", group: "big", barcode: "2044251019099", perBox: 70, wbStockKits: 130, sales30Kits: 430 },
    ],
  },
  {
    category: "stringRib",
    article: "163785912",
    title: "Стринги в рубчик 7 шт / 7 цветов",
    colors: { "Черный": 1, "Белый": 1, "Персик": 1, "Серый": 1, "Бирюза": 1, "Бордо": 1, "Фиолетовый": 1 },
    sizes: [
      { size: "42-44", group: "small", barcode: "2037936094726", perBox: 110, wbStockKits: 210, sales30Kits: 640 },
      { size: "44-46", group: "small", barcode: "2037936095211", perBox: 110, wbStockKits: 240, sales30Kits: 760 },
      { size: "46-48", group: "small", barcode: "2037936095594", perBox: 100, wbStockKits: 349, sales30Kits: 1040 },
      { size: "48-50", group: "big", barcode: "2039108224825", perBox: 100, wbStockKits: 180, sales30Kits: 720 },
      { size: "50-52", group: "big", barcode: "2039108230222", perBox: 100, wbStockKits: 140, sales30Kits: 560 },
      { size: "52-54", group: "big", barcode: "2039108231199", perBox: 90, wbStockKits: 150, sales30Kits: 520 },
    ],
  },
];

const DEFAULT_ARTICLE_CONFIG = new Map(articles.map((article) => [article.article, {
  category: article.category,
  title: article.title,
  colors: article.colors,
}]));

function normalizeSizeLabel(value: string) {
  const match = value.match(/(?:^|\D)(\d{2})\s*[-–—]\s*(\d{2})(?:\D|$)/);
  return match ? `${match[1]}-${match[2]}` : value.trim();
}

function canonicalColor(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ru-RU").replace(/[.,]/g, "");
  if (!normalized) return "";
  if (normalized.includes("черн")) return "Черный";
  if (normalized.includes("бел")) return "Белый";
  if (normalized.includes("перс")) return "Персик";
  if (normalized.includes("сер")) return "Серый";
  if (normalized.includes("бирюз")) return "Бирюза";
  if (normalized.includes("борд")) return "Бордо";
  if (normalized.includes("фиолет")) return "Фиолетовый";
  if (normalized.includes("зелен") || normalized.includes("зелён")) return "Зеленый";
  if (normalized.includes("роз")) return "Розовый";
  if (normalized.includes("син")) return "Синий";
  if (normalized.includes("беж")) return "Бежевый";
  return value.trim().replace(/^./, (char) => char.toLocaleUpperCase("ru-RU"));
}

function normalizeColors(colors: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const [color, qty] of Object.entries(colors)) {
    const canonical = canonicalColor(color);
    if (!canonical) continue;
    result[canonical] = (result[canonical] || 0) + (Number(qty) || 0);
  }
  return result;
}

function colorsFromRows(rows: NeedRow[]) {
  const colors = Array.from(new Set(rows.map((row) => row.color)));
  return colors.sort((a, b) => {
    const aIndex = COLOR_ORDER.indexOf(a);
    const bIndex = COLOR_ORDER.indexOf(b);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
    return a.localeCompare(b, "ru");
  });
}

function sizeGroup(size: string): SizeGroup {
  return ["48-50", "50-52", "52-54"].includes(size) ? "big" : "small";
}

function buildProductionArticles(products: ProductApiItem[], stock: StockApiItem[], orders: OrdersAggregatedApi, warehouseConfigs: WarehouseArticleConfig[] = []): PurchaseArticle[] {
  const stockByBarcode = new Map(stock.map((item) => [item.barcode, Number(item.totalOnWarehouses) || 0]));
  const ordersByBarcode = orders.perBarcode || {};
  const configByArticle = new Map<string, {
    category: PurchaseCategoryValue;
    title: string;
    colors: Record<string, number>;
  }>();
  for (const [article, config] of DEFAULT_ARTICLE_CONFIG) {
    configByArticle.set(article, {
      ...config,
      colors: normalizeColors(config.colors),
    });
  }
  for (const config of warehouseConfigs) {
    if (config.category === "none") continue;
    configByArticle.set(config.article, {
      category: config.category,
      title: config.sheetName,
      colors: normalizeColors(config.colors),
    });
  }

  return products
    .map((product) => {
      const config = configByArticle.get(String(product.articleWB));
      const sizes = product.sizes
        .map((size) => {
          const normalizedSize = normalizeSizeLabel(size.size);
          if (!INPUT_SIZE_ORDER.includes(normalizedSize)) return null;
          const orderRow = ordersByBarcode[size.barcode];
          const totalOrders = Number(orderRow?.totalOrders) || 0;
          const cancelledOrders = Number(orderRow?.cancelledOrders) || 0;
          return {
            size: normalizedSize,
            group: sizeGroup(normalizedSize),
            barcode: size.barcode,
            perBox: Number(size.perBox) || 0,
            wbStockKits: stockByBarcode.get(size.barcode) || 0,
            sales30Kits: Math.max(0, totalOrders - cancelledOrders),
          };
        })
        .filter((size): size is SizeRow => Boolean(size))
        .sort((a, b) => INPUT_SIZE_ORDER.indexOf(a.size) - INPUT_SIZE_ORDER.indexOf(b.size));

      return {
        category: config?.category && config.category !== "none" ? config.category : "rib",
        article: String(product.articleWB),
        title: config?.title || product.name || String(product.articleWB),
        colors: config?.colors || {},
        sizes,
      };
    })
    .sort((a, b) => Number(a.article) - Number(b.article));
}

function createDefaultArticleSettings(catalog: PurchaseArticle[] = articles): ArticleSetting[] {
  return catalog.map((article) => ({
    article: article.article,
    enabled: Object.keys(article.colors).length > 0,
    category: Object.keys(article.colors).length > 0 ? article.category : "none",
  }));
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function stockKey(color: string, size: string) {
  return `${canonicalColor(color).toLocaleUpperCase("ru-RU")}:${size.trim()}`;
}

function purchaseSize(size: string) {
  return size === "40-42" ? "42-44" : size;
}

function buildWarehouseStockMap(sheet: PurchaseStockSheet | null): Map<string, { pieces: number; mergedPieces: number }> {
  const stock = new Map<string, { pieces: number; mergedPieces: number }>();
  if (!sheet) return stock;

  for (const row of [...sheet.small, ...sheet.big]) {
    for (const sizeRow of row.sizeRows) {
      const normalizedSize = purchaseSize(sizeRow.size);
      const key = stockKey(row.color, normalizedSize);
      const current = stock.get(key) || { pieces: 0, mergedPieces: 0 };
      current.pieces += sizeRow.pieces;
      if (sizeRow.size !== normalizedSize) {
        current.mergedPieces += sizeRow.pieces;
      }
      stock.set(key, current);
    }
  }

  return stock;
}

function getArticleSetting(settings: ArticleSetting[], article: PurchaseArticle) {
  return settings.find((setting) => setting.article === article.article) || {
    article: article.article,
    enabled: true,
    category: article.category,
  };
}

function getArticlesForCategory(category: CategoryKey, settings: ArticleSetting[], catalog: PurchaseArticle[]) {
  return catalog.filter((article) => {
    const setting = getArticleSetting(settings, article);
    return setting.enabled && setting.category === category;
  });
}

function buildNeeds(
  category: CategoryKey,
  settings: ArticleSetting[],
  catalog: PurchaseArticle[],
  warehouseSheet: PurchaseStockSheet | null = null,
  multiplier: PurchaseMultiplier = 1
): NeedRow[] {
  const rows = new Map<string, NeedRow>();
  const categoryArticles = getArticlesForCategory(category, settings, catalog);
  const warehouseStock = buildWarehouseStockMap(warehouseSheet);

  for (const article of categoryArticles) {
    for (const size of article.sizes) {
      for (const [rawColor, qty] of Object.entries(article.colors)) {
        const color = canonicalColor(rawColor);
        const normalizedSize = purchaseSize(size.size);
        const key = `${normalizedSize}:${color}`;
        const existing = rows.get(key) || {
          category,
          size: normalizedSize,
          group: size.group,
          color,
          stockPieces: 0,
          salesPieces: 0,
          needBeforeWarehousePieces: 0,
          warehousePieces: 0,
          warehouseMergedPieces: 0,
          needPieces: 0,
          packs: 0,
          articleBreakdown: [],
        };
        const stockPieces = size.wbStockKits * qty;
        const salesPieces = size.sales30Kits * qty;
        const needBeforeWarehousePieces = Math.max(0, salesPieces - stockPieces);
        existing.stockPieces += stockPieces;
        existing.salesPieces += salesPieces;
        existing.articleBreakdown.push({
          article: article.article,
          title: article.title,
          colorQty: qty,
          stockPieces,
          salesPieces,
          needBeforeWarehousePieces,
        });
        rows.set(key, existing);
      }
    }
  }

  return [...rows.values()]
    .map((row) => {
      const targetSalesPieces = Math.ceil(row.salesPieces * multiplier);
      const needBeforeWarehousePieces = Math.max(0, targetSalesPieces - row.stockPieces);
      const warehouse = warehouseStock.get(stockKey(row.color, row.size)) || { pieces: 0, mergedPieces: 0 };
      const warehousePieces = warehouse.pieces;
      const needPieces = Math.max(0, needBeforeWarehousePieces - warehousePieces);

      return {
        ...row,
        salesPieces: targetSalesPieces,
        needBeforeWarehousePieces,
        warehousePieces,
        warehouseMergedPieces: warehouse.mergedPieces,
        needPieces,
        packs: Math.ceil(needPieces / PACK_DIVISOR),
      };
    })
    .sort((a, b) => {
      const sizeDiff = SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
      if (sizeDiff !== 0) return sizeDiff;
      const colorDiff = COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color);
      if (COLOR_ORDER.includes(a.color) && COLOR_ORDER.includes(b.color)) return colorDiff;
      return a.color.localeCompare(b.color, "ru");
    });
}

function groupTotals(rows: NeedRow[]) {
  return {
    stock: rows.reduce((sum, row) => sum + row.stockPieces, 0),
    sales: rows.reduce((sum, row) => sum + row.salesPieces, 0),
    needBeforeWarehouse: rows.reduce((sum, row) => sum + row.needBeforeWarehousePieces, 0),
    warehouse: rows.reduce((sum, row) => sum + Math.min(row.warehousePieces, row.needBeforeWarehousePieces), 0),
    need: rows.reduce((sum, row) => sum + row.needPieces, 0),
    packs: rows.reduce((sum, row) => sum + row.packs, 0),
  };
}

function maxNeed(rows: NeedRow[]) {
  return Math.max(1, ...rows.map((row) => row.packs));
}

function getCell(rows: NeedRow[], color: string, size: string) {
  return rows.find((row) => row.color === color && row.size === size);
}

function warehouseTooltip(row: NeedRow) {
  return row.warehouseMergedPieces > 0
    ? `Остаток склада: ${formatNumber(row.warehousePieces)} шт, включая 40-42: ${formatNumber(row.warehouseMergedPieces)} шт`
    : `Остаток склада: ${formatNumber(row.warehousePieces)} шт`;
}

function StatPill({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "need" | "packs" }) {
  const toneClass = tone === "need" ? "text-[#f97316]" : tone === "packs" ? "text-[#38bdf8]" : "text-white";
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function SummaryStatPill(props: Parameters<typeof StatPill>[0]) {
  return (
    <div className="w-[170px] shrink-0">
      <StatPill {...props} />
    </div>
  );
}

function VariantHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
      <Icon className="h-4 w-4 text-[var(--accent)]" />
      <h3 className="text-sm font-semibold text-white">{title}</h3>
    </div>
  );
}

function MatrixVariant({ rows }: { rows: NeedRow[] }) {
  const sizes = SIZE_ORDER.filter((size) => rows.some((row) => row.size === size));
  const colors = colorsFromRows(rows);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Grid3X3} title="1. Матрица цвет x размер" />
      <div className="overflow-auto p-4">
        <table className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-left">Цвет</th>
              {sizes.map((size) => (
                <th key={size} className="border border-[var(--border)] px-3 py-2 text-center">{size}</th>
              ))}
              <th className="border border-[var(--border)] px-3 py-2 text-center">Итого</th>
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => {
              const total = rows.filter((row) => row.color === color).reduce((sum, row) => sum + row.needPieces, 0);
              return (
                <tr key={color} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 font-medium text-white">{color}</td>
                  {sizes.map((size) => {
                    const row = getCell(rows, color, size);
                    return (
                      <td key={size} className="border border-[var(--border)] px-3 py-2 text-center tabular-nums">
                        {row ? (
                          <div title={`Целевая потребность: ${formatNumber(row.salesPieces)} шт\nОстатки WB: ${formatNumber(row.stockPieces)} шт\nДефицит до склада: ${formatNumber(row.needBeforeWarehousePieces)} шт\n${warehouseTooltip(row)}\nК закупке: ${formatNumber(row.needPieces)} шт\nПачки: ${formatNumber(row.packs)}`}>
                            <div className={row.needPieces > 0 ? "font-semibold text-white" : "text-[var(--text-muted)]"}>{formatNumber(row.needPieces)}</div>
                            <div className="text-[10px] text-[#38bdf8]">{formatNumber(row.packs)} пач.</div>
                          </div>
                        ) : "-"}
                      </td>
                    );
                  })}
                  <td className="border border-[var(--border)] px-3 py-2 text-center font-semibold text-[#f97316] tabular-nums">{formatNumber(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SplitVariant({ rows }: { rows: NeedRow[] }) {
  const colors = colorsFromRows(rows);
  const [selectedColor, setSelectedColor] = useState(colors[0] || "Черный");
  const selectedRows = rows.filter((row) => row.color === selectedColor);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={ListTree} title="2. Цвет слева, размерная детализация справа" />
      <div className="grid min-h-[420px] border-t border-[var(--border)] lg:grid-cols-[260px_1fr]">
        <div className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
          {colors.map((color) => {
            const total = rows.filter((row) => row.color === color).reduce((sum, row) => sum + row.needPieces, 0);
            const active = color === selectedColor;
            return (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={`flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${active ? "bg-[var(--accent)]/15" : "hover:bg-[var(--bg-card-hover)]"}`}
              >
                <span className="text-sm font-medium text-white">{color}</span>
                <span className="text-sm font-semibold tabular-nums text-[#f97316]">{formatNumber(total)}</span>
              </button>
            );
          })}
        </div>
        <div className="overflow-auto p-4">
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="border border-[var(--border)] px-3 py-2 text-left">Размер</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">Целевая потребность</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">Остатки WB</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">До склада</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">Склад</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">К закупке</th>
                <th className="border border-[var(--border)] px-3 py-2 text-center">Пачки</th>
                <th className="border border-[var(--border)] px-3 py-2 text-left">Откуда пришло</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((row) => (
                <tr key={`${row.color}-${row.size}`} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="border border-[var(--border)] px-3 py-2 font-semibold text-white">{row.size}</td>
                  <td className="border border-[var(--border)] px-3 py-2 text-center tabular-nums">{formatNumber(row.salesPieces)}</td>
                  <td className="border border-[var(--border)] px-3 py-2 text-center tabular-nums">{formatNumber(row.stockPieces)}</td>
                  <td className="border border-[var(--border)] px-3 py-2 text-center text-[var(--text-muted)] tabular-nums">{formatNumber(row.needBeforeWarehousePieces)}</td>
                  <td
                    className="border border-[var(--border)] px-3 py-2 text-center text-[#22c55e] tabular-nums"
                    title={warehouseTooltip(row)}
                  >
                    {formatNumber(row.warehousePieces)}
                  </td>
                  <td className="border border-[var(--border)] px-3 py-2 text-center font-semibold text-[#f97316] tabular-nums">{formatNumber(row.needPieces)}</td>
                  <td className="border border-[var(--border)] px-3 py-2 text-center text-[#38bdf8] tabular-nums">{formatNumber(row.packs)}</td>
                  <td className="border border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">
                    {row.articleBreakdown.map((item) => `${item.article}: x${item.colorQty}`).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function HeatmapVariant({ rows }: { rows: NeedRow[] }) {
  const smallSizes = ["42-44", "44-46", "46-48"].filter((size) => rows.some((row) => row.size === size));
  const bigSizes = ["48-50", "50-52", "52-54"].filter((size) => rows.some((row) => row.size === size));
  const columns: Array<
    | { type: "size"; size: string }
    | { type: "purchase"; key: SizeGroup; sizes: string[] }
  > = [
    ...smallSizes.map((size) => ({ type: "size" as const, size })),
    ...(smallSizes.length ? [{ type: "purchase" as const, key: "small" as const, sizes: smallSizes }] : []),
    ...bigSizes.map((size) => ({ type: "size" as const, size })),
    ...(bigSizes.length ? [{ type: "purchase" as const, key: "big" as const, sizes: bigSizes }] : []),
  ];
  const colors = colorsFromRows(rows);
  const max = maxNeed(rows);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={BarChart3} title="3. Тепловая карта дефицита" />
      <div className="grid gap-2 p-4" style={{ gridTemplateColumns: `140px repeat(${columns.length}, minmax(92px, 1fr))` }}>
        <div />
        {columns.map((column) => (
          <div
            key={column.type === "size" ? column.size : `purchase-${column.key}`}
            className={`text-center text-xs font-medium ${column.type === "purchase" ? "text-[#38bdf8]" : "text-[var(--text-muted)]"}`}
          >
            {column.type === "size" ? column.size : "Закупка"}
          </div>
        ))}
        {colors.map((color) => (
          <Fragment key={color}>
            <div key={`${color}-label`} className="flex h-16 items-center text-sm font-medium text-white">{color}</div>
            {columns.map((column) => {
              if (column.type === "purchase") {
                const purchasePacks = Math.max(0, ...column.sizes.map((size) => getCell(rows, color, size)?.packs || 0));
                const pct = purchasePacks / max;
                const bg = `rgba(56, 189, 248, ${0.08 + pct * 0.65})`;
                return (
                  <div
                    key={`${color}-purchase-${column.key}`}
                    className="grid h-16 place-items-center rounded border border-[#38bdf8]/40 text-center text-xs tabular-nums"
                    style={{ background: purchasePacks > 0 ? bg : "var(--bg)" }}
                    title={`${color}: закупка ${column.key === "small" ? "малой" : "большой"} группы ${formatNumber(purchasePacks)} пач. Берём максимум по размерам: ${column.sizes.map((size) => `${size}: ${formatNumber(getCell(rows, color, size)?.packs || 0)} пач`).join(", ")}`}
                  >
                    <span className={purchasePacks > 0 ? "font-semibold text-white" : "text-[var(--text-muted)]"}>
                      {formatNumber(purchasePacks)}
                    </span>
                  </div>
                );
              }

              const row = getCell(rows, color, column.size);
              const pct = row ? row.packs / max : 0;
              const bg = `rgba(249, 115, 22, ${0.08 + pct * 0.7})`;
              return (
                <div
                  key={`${color}-${column.size}`}
                  className="grid h-16 place-items-center rounded border border-[var(--border)] text-center text-xs tabular-nums"
                  style={{ background: row && row.packs > 0 ? bg : "var(--bg)" }}
                  title={row ? `${color} ${column.size}: до склада ${formatNumber(row.needBeforeWarehousePieces)} шт, ${warehouseTooltip(row)}, к закупке ${formatNumber(row.needPieces)} шт, ${formatNumber(row.packs)} пач.` : ""}
                >
                  {row ? (
                    <span className={row.packs > 0 ? "font-semibold text-white" : "text-[var(--text-muted)]"}>{formatNumber(row.packs)}</span>
                  ) : "-"}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function GroupVariant({ rows }: { rows: NeedRow[] }) {
  const grouped = (["small", "big"] as SizeGroup[]).map((group) => {
    const groupRows = rows.filter((row) => row.group === group);
    return { group, rows: groupRows, totals: groupTotals(groupRows) };
  });

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Layers3} title="4. Закупка пачками по группам размеров" />
      <div className="grid gap-4 p-4 xl:grid-cols-2">
        {grouped.map((block) => (
          <div key={block.group} className="rounded-md border border-[var(--border)] bg-[var(--bg)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">{block.group === "small" ? "Маленькие размеры" : "Большие размеры"}</div>
                <div className="text-xs text-[var(--text-muted)]">{block.group === "small" ? "42-44, 44-46, 46-48" : "48-50, 50-52, 52-54"}</div>
              </div>
              <div className="text-right text-sm font-semibold text-[#38bdf8] tabular-nums">{formatNumber(block.totals.packs)} пач.</div>
            </div>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {block.rows
                    .filter((row) => row.needPieces > 0)
                    .sort((a, b) => b.packs - a.packs)
                    .slice(0, 16)
                    .map((row) => (
                      <tr key={`${row.color}-${row.size}`} className="hover:bg-[var(--bg-card-hover)]">
                        <td className="border-b border-[var(--border)] px-3 py-2 font-medium text-white">{row.color}</td>
                        <td className="border-b border-[var(--border)] px-3 py-2 text-center text-[var(--text-muted)]">{row.size}</td>
                        <td className="border-b border-[var(--border)] px-3 py-2 text-right text-[#f97316] tabular-nums">{formatNumber(row.needPieces)} шт</td>
                        <td className="border-b border-[var(--border)] px-3 py-2 text-right text-[#38bdf8] tabular-nums">{formatNumber(row.packs)} пач.</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function getArticleDisplaySizes(article: PurchaseArticle) {
  const sizes = new Map<string, SizeRow>();

  for (const size of article.sizes) {
    const normalizedSize = purchaseSize(size.size);
    const existing = sizes.get(normalizedSize);
    if (!existing) {
      sizes.set(normalizedSize, {
        ...size,
        size: normalizedSize,
      });
      continue;
    }

    existing.barcode = `${existing.barcode} / ${size.barcode}`;
    existing.wbStockKits += size.wbStockKits;
    existing.sales30Kits += size.sales30Kits;
  }

  return [...sizes.values()].sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
}

function ArticleVariant({ category, settings, catalog }: { category: CategoryKey; settings: ArticleSetting[]; catalog: PurchaseArticle[] }) {
  const categoryArticles = getArticlesForCategory(category, settings, catalog);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Rows3} title="5. Контроль по артикулам и составу комплекта" />
      <div className="grid gap-3 p-4">
        <div className="rounded-md border border-[#f97316]/25 bg-[#f97316]/10 px-3 py-2 text-xs text-[#fdba74]">
          Остаток склада учитывается в общей потребности по цвету и размеру. В этой разбивке он не списывается по артикулам, потому что складской остаток не привязан к конкретному артикулу.
        </div>
        {categoryArticles.map((article) => {
          const articleNeeds = buildArticleNeeds(article, category);
          const totals = groupTotals(articleNeeds);
          return (
            <details key={article.article} className="rounded-md border border-[var(--border)] bg-[var(--bg)]" open={categoryArticles.length <= 2}>
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--bg-card-hover)]">
                <div>
                  <div className="font-mono text-sm font-semibold text-[var(--accent)]">{article.article}</div>
                  <div className="mt-1 text-sm text-white">{article.title}</div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="text-[10px] uppercase text-[var(--text-muted)]">Потребность</div>
                    <div className="font-semibold text-[#f97316] tabular-nums">{formatNumber(totals.need)} шт</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                </div>
              </summary>
              <div className="border-t border-[var(--border)] p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {Object.entries(article.colors).map(([rawColor, qty]) => {
                    const color = canonicalColor(rawColor);
                    return (
                    <span key={color} className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-muted)]">
                      {color}: {qty} шт
                    </span>
                    );
                  })}
                </div>
                <div className="overflow-auto">
                  <table className="w-full min-w-[760px] border-collapse text-xs">
                    <thead className="text-[var(--text-muted)]">
                      <tr>
                        <th className="border border-[var(--border)] px-3 py-2 text-left">Размер</th>
                        <th className="border border-[var(--border)] px-3 py-2 text-left">Баркод</th>
                        <th className="border border-[var(--border)] px-3 py-2 text-center">Остаток комплектов</th>
                        <th className="border border-[var(--border)] px-3 py-2 text-center">Продажи комплектов</th>
                        <th className="border border-[var(--border)] px-3 py-2 text-center">Потребность по цветам</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getArticleDisplaySizes(article).map((size) => {
                        const sizeRows = articleNeeds.filter((row) => row.size === size.size && row.needPieces > 0);
                        return (
                          <tr key={size.barcode} className="hover:bg-[var(--bg-card-hover)]">
                            <td className="border border-[var(--border)] px-3 py-2 font-semibold text-white">{size.size}</td>
                            <td className="border border-[var(--border)] px-3 py-2 font-mono text-[var(--text-muted)]">{size.barcode}</td>
                            <td className="border border-[var(--border)] px-3 py-2 text-center tabular-nums">{formatNumber(size.wbStockKits)}</td>
                            <td className="border border-[var(--border)] px-3 py-2 text-center tabular-nums">{formatNumber(size.sales30Kits)}</td>
                            <td className="border border-[var(--border)] px-3 py-2">
                              <div className="flex flex-wrap gap-1.5">
                                {sizeRows.length ? sizeRows.map((row) => (
                                  <span key={`${row.color}-${row.size}`} className="rounded bg-[#f97316]/10 px-2 py-1 text-[#fdba74]">
                                    {row.color}: {formatNumber(row.needPieces)}
                                  </span>
                                )) : <span className="text-[var(--text-muted)]">нет дефицита</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function PurchaseSettingsPanel({
  catalog,
  settings,
  onChange,
  onReset,
}: {
  catalog: PurchaseArticle[];
  settings: ArticleSetting[];
  onChange: (settings: ArticleSetting[]) => void;
  onReset: () => void;
}) {
  const counts = CATEGORY_OPTIONS.map((option) => ({
    ...option,
    count: settings.filter((setting) => {
      if (option.key === "none") return !setting.enabled || setting.category === "none";
      return setting.enabled && setting.category === option.key;
    }).length,
  }));

  function updateArticle(articleId: string, patch: Partial<ArticleSetting>) {
    onChange(settings.map((setting) => (
      setting.article === articleId
        ? {
          ...setting,
          ...patch,
          enabled: patch.category === "none" ? false : patch.enabled ?? setting.enabled,
        }
        : setting
    )));
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Settings2} title="Настройки артикулов" />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          {counts.map((item) => (
            <StatPill key={item.key} label={item.label} value={formatNumber(item.count)} tone={item.key === "none" ? "default" : "packs"} />
          ))}
        </div>

        <div className="overflow-auto rounded-md border border-[var(--border)]">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
              <tr>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left">Участвует</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left">Артикул</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left">Название</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left">Категория закупки</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-center">Размеры</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left">Состав</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((article) => {
                const setting = getArticleSetting(settings, article);
                const colorLabel = Object.entries(article.colors).map(([color, qty]) => `${canonicalColor(color)}: ${qty}`).join(" · ") || "Состав не задан";
                return (
                  <tr key={article.article} className="hover:bg-[var(--bg-card-hover)]">
                    <td className="border-b border-[var(--border)] px-3 py-2">
                      <input
                        type="checkbox"
                        checked={setting.enabled && setting.category !== "none"}
                        onChange={(event) => updateArticle(article.article, {
                          enabled: event.target.checked,
                          category: event.target.checked && setting.category === "none" ? article.category : setting.category,
                        })}
                        className="h-4 w-4 accent-[var(--accent)]"
                        aria-label={`Участие ${article.article}`}
                      />
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-2 font-mono font-semibold text-[var(--accent)]">{article.article}</td>
                    <td className="border-b border-[var(--border)] px-3 py-2 text-white">{article.title}</td>
                    <td className="border-b border-[var(--border)] px-3 py-2">
                      <select
                        value={setting.enabled ? setting.category : "none"}
                        onChange={(event) => {
                          const nextCategory = event.target.value as PurchaseCategoryValue;
                          updateArticle(article.article, {
                            category: nextCategory,
                            enabled: nextCategory !== "none",
                          });
                        }}
                        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-white outline-none focus:border-[var(--accent)]"
                      >
                        {CATEGORY_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-2 text-center tabular-nums text-[var(--text-muted)]">
                      {formatNumber(article.sizes.length)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-2 text-[var(--text-muted)]">{colorLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-white"
          >
            Сбросить
          </button>
        </div>
      </div>
    </section>
  );
}

function StockGroupTable({ title, rows, bagPacks }: { title: string; rows: PurchaseStockColorRow[]; bagPacks: number }) {
  const sizes = SIZE_ORDER.filter((size) => rows.some((row) => row.sizeRows.some((sizeRow) => sizeRow.size === size)));
  const packComposition = sizes.length
    ? `1 пачка = 12 шт: ${sizes.map((size) => `${size} x 4`).join(", ")}`
    : "1 пачка = 12 шт";

  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)]">
      <div className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-[var(--text-muted)]">
            1 мешок = {formatNumber(bagPacks)} пачек · 1 короб = 50 пачек · {packComposition}
          </div>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[660px] border-collapse text-xs">
          <thead className="text-[var(--text-muted)]">
            <tr>
              <th className="border border-[var(--border)] px-2 py-2 text-left">Цвет</th>
              <th className="border border-[var(--border)] px-2 py-2 text-center">Мешки</th>
              <th className="border border-[var(--border)] px-2 py-2 text-center">Пачки</th>
              <th className="border border-[var(--border)] px-2 py-2 text-center">Короба</th>
              {sizes.map((size) => (
                <th key={size} className="border border-[var(--border)] px-2 py-2 text-center">{size}</th>
              ))}
              <th className="border border-[var(--border)] px-2 py-2 text-center">Всего</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.color} className="hover:bg-[var(--bg-card-hover)]">
                <td className="border border-[var(--border)] px-2 py-2 font-medium text-white">{row.color}</td>
                <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums">{formatNumber(row.bags)}</td>
                <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums">{formatNumber(row.loosePacks)}</td>
                <td className="border border-[var(--border)] px-2 py-2 text-center tabular-nums">{formatNumber(row.commonBoxes)}</td>
                {sizes.map((size) => {
                  const sizeRow = row.sizeRows.find((item) => item.size === size) || { size, boxes: 0, packs: 0, pieces: 0 };
                  return (
                  <td
                    key={sizeRow.size}
                    className="border border-[var(--border)] px-2 py-2 text-center tabular-nums"
                    title={`Размерных коробов: ${formatNumber(sizeRow.boxes)}\nПачек по размеру: ${formatNumber(sizeRow.packs)}\nШтук размера: ${formatNumber(sizeRow.pieces)}`}
                  >
                    <div className={sizeRow.boxes > 0 ? "font-semibold text-white" : "text-[var(--text-muted)]"}>{formatNumber(sizeRow.boxes)}</div>
                    <div className="text-[10px] text-[#38bdf8]">{formatNumber(sizeRow.packs)} пач.</div>
                  </td>
                  );
                })}
                <td className="border border-[var(--border)] px-2 py-2 text-center font-semibold text-[#22c55e] tabular-nums">{formatNumber(row.totalPacks)}</td>
              </tr>
            )) : (
              <tr>
                <td className="border border-[var(--border)] px-3 py-6 text-center text-[var(--text-muted)]" colSpan={sizes.length + 5}>
                  Нет данных по группе размеров
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GoogleStockVariant({ sheet, loading, error }: { sheet: PurchaseStockSheet | null; loading: boolean; error: string }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <VariantHeader icon={Boxes} title="Остатки из Google Sheets" />
      <div className="space-y-4 p-4">
        {loading && <div className="text-sm text-[var(--text-muted)]">Загружаю остатки из таблицы...</div>}
        {error && <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
        {!loading && !error && sheet && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <StatPill label="Лист" value={sheet.title} />
              <StatPill label="Цветов" value={formatNumber(sheet.totals.colors)} />
              <StatPill label="Всего пачек" value={formatNumber(sheet.totals.packs)} tone="packs" />
              <StatPill label="Пачек в размерных коробах" value={formatNumber(sheet.totals.sizeBoxPacks)} />
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <StockGroupTable title="Маленькие размеры" rows={sheet.small} bagPacks={600} />
              <StockGroupTable title="Большие размеры: 48-50 / 50-52 / 52-54" rows={sheet.big} bagPacks={300} />
            </div>
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
              Общая пачка распределяется по 4 шт каждого размера, размерный короб считается как 12 шт конкретного размера. В расчёте закупки размер 40-42 суммируется в 42-44: продажи, остатки WB и складской остаток считаются одной строкой; в складской таблице 40-42 не выводится отдельной колонкой.
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function buildArticleNeeds(article: PurchaseArticle, category: CategoryKey = article.category): NeedRow[] {
  const rows = new Map<string, NeedRow>();

  for (const size of article.sizes) {
    const normalizedSize = purchaseSize(size.size);
    for (const [rawColor, qty] of Object.entries(article.colors)) {
      const color = canonicalColor(rawColor);
      const key = `${normalizedSize}:${color}`;
      const existing = rows.get(key) || {
        category,
        size: normalizedSize,
        group: size.group,
        color,
        stockPieces: 0,
        salesPieces: 0,
        needBeforeWarehousePieces: 0,
        warehousePieces: 0,
        warehouseMergedPieces: 0,
        needPieces: 0,
        packs: 0,
        articleBreakdown: [],
      };
      const stockPieces = size.wbStockKits * qty;
      const salesPieces = size.sales30Kits * qty;
      const needBeforeWarehousePieces = Math.max(0, salesPieces - stockPieces);
      existing.stockPieces += stockPieces;
      existing.salesPieces += salesPieces;
      existing.needBeforeWarehousePieces += needBeforeWarehousePieces;
      existing.articleBreakdown.push({
        article: article.article,
        title: article.title,
        colorQty: qty,
        stockPieces,
        salesPieces,
        needBeforeWarehousePieces,
      });
      rows.set(key, existing);
    }
  }

  return [...rows.values()].map((row) => ({
    ...row,
    needBeforeWarehousePieces: Math.max(0, row.salesPieces - row.stockPieces),
    needPieces: Math.max(0, row.salesPieces - row.stockPieces),
    packs: Math.ceil(Math.max(0, row.salesPieces - row.stockPieces) / PACK_DIVISOR),
  }));
}

function PlanSection() {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <ShoppingCart className="h-4 w-4 text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-white">План реализации логики</h3>
      </div>
      <div className="grid gap-4 p-4 text-sm text-[var(--text-muted)] lg:grid-cols-4">
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold text-white"><PackageCheck className="h-4 w-4 text-[#22c55e]" /> 1. Справочник комплектов</div>
          Цвета и количество штук берем из «Склад», столбец E. В тесте это <code className="text-white">colors: цвет → количество</code>.
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold text-white"><Boxes className="h-4 w-4 text-[#38bdf8]" /> 2. Остатки WB</div>
          Остатки комплектов умножаются на состав комплекта: `остаток комплектов x штук цвета`.
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold text-white"><BarChart3 className="h-4 w-4 text-[#f97316]" /> 3. Продажи WB</div>
          Продажи комплектов за период раскладываются тем же составом: `продажи x штук цвета`.
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold text-white"><Layers3 className="h-4 w-4 text-[#a78bfa]" /> 4. Закупка</div>
          Потребность: `max(0, продажи в штуках - остатки WB - остатки склада)`. Пачки: `ceil(потребность / 12)`.
        </div>
      </div>
    </section>
  );
}

function VariantSelector({ selected, onSelect }: { selected: DisplayVariant; onSelect: (variant: DisplayVariant) => void }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Метод отображения</h3>
          <div className="mt-1 text-xs text-[var(--text-muted)]">{DISPLAY_VARIANTS.find((item) => item.key === selected)?.title}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {DISPLAY_VARIANTS.map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => onSelect(variant.key)}
              title={variant.title}
              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors ${selected === variant.key ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-white"}`}
            >
              {variant.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PurchaseMultiplierSelector({
  selected,
  onSelect,
}: {
  selected: PurchaseMultiplier;
  onSelect: (multiplier: PurchaseMultiplier) => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Коэффициент закупки</h3>
          <div className="mt-1 text-xs text-[var(--text-muted)]">Цель: {formatNumber(BASE_SALES_DAYS * selected)} дней продаж</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PURCHASE_MULTIPLIERS.map((multiplier) => (
            <button
              key={multiplier}
              type="button"
              onClick={() => onSelect(multiplier)}
              title={`${formatNumber(BASE_SALES_DAYS)} дней x ${multiplier} = ${formatNumber(BASE_SALES_DAYS * multiplier)} дней`}
              className={`inline-flex h-9 min-w-12 items-center justify-center rounded-md border px-3 text-sm font-semibold transition-colors ${selected === multiplier ? "border-[#38bdf8] bg-[#38bdf8]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] hover:text-white"}`}
            >
              {multiplier}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function SelectedVariant({ variant, rows, category, settings, catalog }: { variant: DisplayVariant; rows: NeedRow[]; category: CategoryKey; settings: ArticleSetting[]; catalog: PurchaseArticle[] }) {
  if (variant === "1") return <MatrixVariant rows={rows} />;
  if (variant === "2") return <SplitVariant rows={rows} />;
  if (variant === "3") return <HeatmapVariant rows={rows} />;
  if (variant === "4") return <GroupVariant rows={rows} />;
  return <ArticleVariant category={category} settings={settings} catalog={catalog} />;
}

interface PurchasesCalculatorProps {
  title?: string;
  description?: string;
  showPlan?: boolean;
}

export default function PurchasesTestPage({
  title = "Закупки: тест расчёта комплектов",
  description = "Прототип по Excel «Расчет отгрузки.xlsx»: остатки WB и продажи комплектов раскладываются в штуки по цветам, затем считается потребность в штуках и пачках.",
  showPlan = true,
}: PurchasesCalculatorProps) {
  const [category, setCategory] = useState<CategoryKey>("rib");
  const [displayVariant, setDisplayVariant] = useState<DisplayVariant>("1");
  const [purchaseMultiplier, setPurchaseMultiplier] = useState<PurchaseMultiplier>(1);
  const [pageMode, setPageMode] = useState<PageMode>("calculator");
  const [purchaseArticles, setPurchaseArticles] = useState<PurchaseArticle[]>(articles);
  const [articleSettings, setArticleSettings] = useState<ArticleSetting[]>(() => createDefaultArticleSettings(articles));
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [stockSheets, setStockSheets] = useState<PurchaseStockSheet[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState("");
  const selectedStockSheet = stockSheets.find((sheet) => sheet.key === category) || null;
  const targetDays = BASE_SALES_DAYS * purchaseMultiplier;
  const rows = useMemo(
    () => buildNeeds(category, articleSettings, purchaseArticles, selectedStockSheet, purchaseMultiplier),
    [category, articleSettings, purchaseArticles, selectedStockSheet, purchaseMultiplier]
  );
  const totals = groupTotals(rows);
  const activeCategoryCounts = useMemo(() => (
    (Object.keys(CATEGORY_LABELS) as CategoryKey[]).reduce((acc, key) => {
      acc[key] = articleSettings.filter((setting) => setting.enabled && setting.category === key).length;
      return acc;
    }, {} as Record<CategoryKey, number>)
  ), [articleSettings]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError("");
    Promise.all([
      fetch("/api/data/products", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`products HTTP ${response.status}`);
        return response.json() as Promise<ProductApiItem[]>;
      }),
      fetch("/api/data/stock", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`stock HTTP ${response.status}`);
        return response.json() as Promise<StockApiItem[]>;
      }),
      fetch("/api/data/orders-aggregated?days=30", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`orders HTTP ${response.status}`);
        return response.json() as Promise<OrdersAggregatedApi>;
      }),
      fetch("/api/purchases/stock", { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as PurchasesStockApiResponse;
        if (!response.ok || !data.ok) throw new Error(data.error ? JSON.stringify(data.error) : `purchases stock HTTP ${response.status}`);
        return data;
      }),
    ])
      .then(([products, stock, orders, purchaseStock]) => {
        if (cancelled) return;
        const productionArticles = buildProductionArticles(products, stock, orders, purchaseStock.warehouseArticleConfigs || []);
        setPurchaseArticles(productionArticles.length ? productionArticles : articles);
        setArticleSettings(createDefaultArticleSettings(productionArticles.length ? productionArticles : articles));
        setStockSheets(purchaseStock.sheets || []);
        if (purchaseStock.warehouseConfigError) setCatalogError(purchaseStock.warehouseConfigError);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStockLoading(true);
    setStockError("");
    fetch("/api/purchases/stock", { cache: "no-store" })
      .then(async (response) => {
        const text = await response.text();
        let data: PurchasesStockApiResponse = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`API вернул не JSON: HTTP ${response.status}`);
        }
        if (!response.ok || !data.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`);
        return data.sheets || [];
      })
      .then((sheets) => {
        if (!cancelled) setStockSheets(sheets);
      })
      .catch((err) => {
        if (!cancelled) setStockError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="mt-2 max-w-4xl text-sm text-[var(--text-muted)]">{description}</p>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            Боевой источник: {catalogLoading ? "загружаю товары, остатки и заказы..." : `${formatNumber(purchaseArticles.length)} товаров из базы`}
            {catalogError ? <span className="ml-2 text-[var(--danger)]">ошибка: {catalogError}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${category === key ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"}`}
            >
              {CATEGORY_LABELS[key]} <span className="ml-1 text-xs tabular-nums text-[var(--text-muted)]">{activeCategoryCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: "calculator" as const, label: "Расчёт" },
          { key: "settings" as const, label: "Настройки" },
        ]).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setPageMode(item.key)}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${pageMode === item.key ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {pageMode === "settings" ? (
        <PurchaseSettingsPanel
          catalog={purchaseArticles}
          settings={articleSettings}
          onChange={setArticleSettings}
          onReset={() => setArticleSettings(createDefaultArticleSettings(purchaseArticles))}
        />
      ) : (
        <>

          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-[1080px] flex-nowrap gap-3">
              <SummaryStatPill label="Остатки WB в штуках" value={formatNumber(totals.stock)} />
              <SummaryStatPill label={`Цель ${formatNumber(targetDays)} дней в штуках`} value={formatNumber(totals.sales)} />
              <SummaryStatPill label="Дефицит до склада" value={formatNumber(totals.needBeforeWarehouse)} />
              <SummaryStatPill label="Остаток склада" value={formatNumber(totals.warehouse)} />
              <SummaryStatPill label="К закупке в штуках" value={formatNumber(totals.need)} tone="need" />
              <SummaryStatPill label="К закупке в пачках" value={formatNumber(totals.packs)} tone="need" />
            </div>
          </div>

          <PurchaseMultiplierSelector selected={purchaseMultiplier} onSelect={setPurchaseMultiplier} />
          <VariantSelector selected={displayVariant} onSelect={setDisplayVariant} />
          {showPlan && <PlanSection />}

          <GoogleStockVariant sheet={selectedStockSheet} loading={stockLoading} error={stockError} />
          <SelectedVariant variant={displayVariant} rows={rows} category={category} settings={articleSettings} catalog={purchaseArticles} />
        </>
      )}
    </div>
  );
}
