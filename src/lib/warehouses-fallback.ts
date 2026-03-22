/** Hardcoded list of major WB warehouses as fallback when API is unavailable */
export const FALLBACK_WAREHOUSES: string[] = [
  "Рязань (Тюшевское)",
  "Тула",
  "Подольск",
  "Коледино",
  "Электросталь",
  "Котовск",
  "Белая дача",
  "Истра",
  "Ногинск",
  "Чашниково",
  "Владимир",
  "Воронеж",
  "Невинномысск",
  "Краснодар",
  "Волгоград",
  "Волгоград DNS",
  "Казань",
  "Самара (Новосемейкино)",
  "Пенза",
  "Нижнекамск",
  "Сарапул",
  "Уфа Зубово",
  "Екатеринбург - Перспективная 14",
  "Екатеринбург - Испытателей 14г",
  "Екатеринбург - Перспективный 12",
  "Екатеринбург Черняховского",
  "Сургут",
  "Новосибирск",
  "Красноярск Старцево",
  "Бийск",
  "Калининград",
  "СПБ Шушары",
  "СЦ Шушары",
  "Тула Щегловская",
  "Владивосток",
  "Атакент",
  "Актобе",
  "Астана Карагандинское шоссе",
  "Минск Привольный",
  "Ташкент 2",
  "СЦ Барнаул",
  "СЦ Омск",
  "СЦ Челябинск 2",
  "СЦ Ижевск",
  "СЦ Кемерово",
  "СЦ Новокузнецк",
  "СЦ Кузнецк",
  "СЦ Брест",
  "СЦ Гродно",
  "СЦ Ереван",
  "Подольск МП",
];

const WH_CACHE_KEY = "wb-warehouses-cache";

export function getCachedWarehouses(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WH_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Cache for 7 days
    if (Date.now() - data.ts > 7 * 24 * 60 * 60 * 1000) return null;
    return data.list;
  } catch {
    return null;
  }
}

export function setCachedWarehouses(list: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WH_CACHE_KEY, JSON.stringify({ list, ts: Date.now() }));
}
