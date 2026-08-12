export interface RawWarehouseTariff {
  date?: unknown;
  warehouseName?: unknown;
  boxTypeID?: unknown;
  deliveryCoef?: unknown;
  deliveryBaseLiter?: unknown;
  deliveryAdditionalLiter?: unknown;
}

export interface WarehouseDeliveryTariff {
  warehouseName: string;
  coefficientPercent: number;
  deliveryBase: number | null;
  deliveryAdditionalLiter: number | null;
}

export interface WarehouseOrderMix {
  warehouse: string;
  orders: number;
}

export interface WarehouseLogisticsBreakdown {
  warehouse: string;
  orders: number;
  coefficientPercent: number;
  logisticsPerOrder: number;
}

export interface WarehouseLogisticsEstimate {
  averagePerOrder: number;
  matchedOrders: number;
  totalOrders: number;
  breakdown: WarehouseLogisticsBreakdown[];
}

export interface WarehouseTariffIndex {
  exact: Map<string, WarehouseDeliveryTariff>;
  family: Map<string, WarehouseDeliveryTariff>;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeForecastWarehouseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getForecastWarehouseFamily(value: string): string {
  const normalized = normalizeForecastWarehouseName(value);

  if (normalized.includes("новосемейкино")) return "самара";
  if (normalized.includes("шушар")) return "шушары";
  if (normalized.includes("спб") || normalized.includes("санкт петербург")) return "санкт петербург";

  const knownFamilies = [
    "рязань", "екатеринбург", "самара", "невинномысск", "коледино", "тула",
    "электросталь", "краснодар", "подольск", "казань", "котовск", "сарапул",
    "владимир", "волгоград", "воронеж", "новосибирск", "пенза", "владивосток",
    "астана", "белая дача", "атакент", "актобе", "ереван", "ташкент",
    "красноярск", "калининград", "тверь", "вешки", "домодедово", "пермь",
    "радумля", "пушкино", "ногинск", "сургут", "петрозаводск", "уфа", "минск",
    "ростов", "ульяновск", "гродно", "гомель", "брест", "орша", "нижнекамск",
    "истра", "улан удэ", "тюмень", "старый оскол", "махачкала", "бийск",
    "архангельск",
  ];

  const family = knownFamilies.find((item) => normalized.includes(item));
  if (family) return family;

  return normalized
    .replace(/^(сц|ск|склад)\s+/g, "")
    .replace(/\bсгт\b/g, "")
    .replace(/\bмп\b/g, "")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ");
}

function familyOwnerRank(name: string): number {
  const normalized = normalizeForecastWarehouseName(name);
  let rank = 0;
  if (normalized.startsWith("склад ")) rank -= 5;
  if (normalized.startsWith("сц ")) rank += 100;
  if (normalized.includes("питание") || normalized.includes("горючее")) rank += 40;
  if (name.includes(":")) rank += 20;
  return rank;
}

export function buildWarehouseTariffIndex(
  payload: RawWarehouseTariff[],
  tariffDate: string,
): WarehouseTariffIndex {
  const exact = new Map<string, WarehouseDeliveryTariff>();
  const family = new Map<string, WarehouseDeliveryTariff>();

  for (const raw of payload) {
    if (String(raw.date || "").slice(0, 10) !== tariffDate) continue;
    if (Number(raw.boxTypeID) !== 2) continue;

    const warehouseName = typeof raw.warehouseName === "string" ? raw.warehouseName.trim() : "";
    const coefficientPercent = numberOrNull(raw.deliveryCoef);
    if (!warehouseName || coefficientPercent === null || coefficientPercent <= 0) continue;

    const tariff: WarehouseDeliveryTariff = {
      warehouseName,
      coefficientPercent,
      deliveryBase: numberOrNull(raw.deliveryBaseLiter),
      deliveryAdditionalLiter: numberOrNull(raw.deliveryAdditionalLiter),
    };

    const exactKey = normalizeForecastWarehouseName(warehouseName);
    if (!exact.has(exactKey)) exact.set(exactKey, tariff);

    const familyKey = getForecastWarehouseFamily(warehouseName);
    const current = family.get(familyKey);
    if (!current
      || familyOwnerRank(warehouseName) < familyOwnerRank(current.warehouseName)
      || (familyOwnerRank(warehouseName) === familyOwnerRank(current.warehouseName)
        && warehouseName.length < current.warehouseName.length)) {
      family.set(familyKey, tariff);
    }
  }

  return { exact, family };
}

export function getWarehouseTariff(
  warehouse: string,
  index: WarehouseTariffIndex,
): WarehouseDeliveryTariff | null {
  return index.exact.get(normalizeForecastWarehouseName(warehouse))
    || index.family.get(getForecastWarehouseFamily(warehouse))
    || null;
}

/** Базовый тариф WB при коэффициенте склада 100%. */
export function baseLogisticsForVolume(volumeLiters: number): number | null {
  if (!Number.isFinite(volumeLiters) || volumeLiters <= 0) return null;
  if (volumeLiters <= 0.2) return 23;
  if (volumeLiters <= 0.4) return 26;
  if (volumeLiters <= 0.6) return 29;
  if (volumeLiters <= 0.8) return 30;
  if (volumeLiters <= 1) return 32;
  return 46 + (volumeLiters - 1) * 14;
}

/**
 * deliveryBase/deliveryAdditionalLiter из WB уже умножены на коэффициент склада.
 * Для объёма >1 л используем их напрямую, чтобы не применить коэффициент дважды.
 */
export function logisticsForWarehouse(
  volumeLiters: number,
  tariff: WarehouseDeliveryTariff,
): number | null {
  const baseAt100 = baseLogisticsForVolume(volumeLiters);
  if (baseAt100 === null) return null;

  if (volumeLiters > 1 && tariff.deliveryBase !== null) {
    return tariff.deliveryBase
      + (volumeLiters - 1) * (tariff.deliveryAdditionalLiter || 0);
  }

  return baseAt100 * tariff.coefficientPercent / 100;
}

export function estimateWarehouseLogistics(
  volumeLiters: number,
  warehouseMix: WarehouseOrderMix[],
  tariffIndex: WarehouseTariffIndex,
): WarehouseLogisticsEstimate | null {
  const totalOrders = warehouseMix.reduce((sum, row) => sum + Math.max(Number(row.orders) || 0, 0), 0);
  if (totalOrders <= 0) return null;

  let matchedOrders = 0;
  let weightedTotal = 0;
  const breakdown: WarehouseLogisticsBreakdown[] = [];

  for (const row of warehouseMix) {
    const orders = Math.max(Number(row.orders) || 0, 0);
    if (orders <= 0) continue;
    const tariff = getWarehouseTariff(row.warehouse, tariffIndex);
    if (!tariff) continue;
    const logisticsPerOrder = logisticsForWarehouse(volumeLiters, tariff);
    if (logisticsPerOrder === null) continue;

    matchedOrders += orders;
    weightedTotal += orders * logisticsPerOrder;
    breakdown.push({
      warehouse: row.warehouse,
      orders,
      coefficientPercent: tariff.coefficientPercent,
      logisticsPerOrder,
    });
  }

  if (matchedOrders <= 0) return null;
  return {
    averagePerOrder: weightedTotal / matchedOrders,
    matchedOrders,
    totalOrders,
    breakdown,
  };
}
