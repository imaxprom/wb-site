/**
 * packing-engine.ts — Smart Packing: укладка разных размеров/артикулов в физические короба.
 * 
 * Единицы: литры (1 литр = 1000 см³)
 * Короб по умолчанию: 600×400×400 мм = 96 литров
 */

export interface BoxConfig {
  lengthMm: number;   // 600
  widthMm: number;    // 400
  heightMm: number;   // 400
  fillRate: number;    // 0.85 (85%)
}

export const DEFAULT_BOX: BoxConfig = {
  lengthMm: 600,
  widthMm: 400,
  heightMm: 400,
  fillRate: 1.0,
};

/** Объём короба в литрах */
export function boxVolumeLiters(box: BoxConfig): number {
  return (box.lengthMm / 10) * (box.widthMm / 10) * (box.heightMm / 10) / 1000;
}

/** Полезный объём короба в литрах (с учётом коэфф. заполнения) */
export function usableVolumeLiters(box: BoxConfig): number {
  return boxVolumeLiters(box) * box.fillRate;
}

/** Объём одной единицы товара в литрах (на основе perBox) */
export function unitVolumeLiters(box: BoxConfig, perBox: number): number {
  if (perBox <= 0) return 0;
  return boxVolumeLiters(box) / perBox;
}

// ─── Packing Types ──────────────────────────────────────────

export interface PackingItem {
  id: string;         // уникальный ключ (barcode или articleWB + size)
  label: string;      // "322000486 / 42-44 (XL)"
  articleWB: string;   // артикул WB (nm_id)
  articleName: string; // артикул продавца (sa_name)
  productName: string; // наименование из вкладки Товары (custom_name)
  size: string;
  barcode: string;
  needed: number;     // сколько штук нужно отгрузить
  perBox: number;     // вмещаемость в полный короб
  unitVolume: number; // объём 1 шт в литрах
}

export interface PackedBox {
  boxNumber: number;
  items: { item: PackingItem; qty: number; volumeUsed: number }[];
  totalVolume: number;      // занято литров
  maxVolume: number;        // полезный объём короба
  fillPercent: number;      // % заполнения
}

export interface PackingResult {
  boxes: PackedBox[];
  totalBoxes: number;
  totalItems: number;
  boxConfig: BoxConfig;
  boxVolume: number;        // полный объём литров
  usableVolume: number;     // полезный объём литров
}

// ─── Packing Algorithm ──────────────────────────────────────

/**
 * Укладывает список потребностей в короба.
 * 
 * Принцип: один размер — в одну коробку (по возможности).
 * Сначала каждый размер получает свои короба, потом мелкие остатки
 * докладываются в коробки где есть свободное место.
 */
export function packItems(
  items: PackingItem[],
  box: BoxConfig = DEFAULT_BOX,
  maxArticlesPerBox: number = 99,
  minUnitsLeftover: number = 10,
  roundTo: number = 1
): PackingResult {
  const maxVol = usableVolumeLiters(box);
  const fullVol = boxVolumeLiters(box);

  // Фильтр: только те, где needed > 0
  const topack = items.filter((i) => i.needed > 0);

  // Сортировка: больше штук → первыми (основные размеры сначала)
  topack.sort((a, b) => b.needed - a.needed);

  const boxes: PackedBox[] = [];

  // ЭТАП 1: Каждый размер — в свои короба (не мешаем с другими)
  const leftovers: { item: PackingItem; remaining: number }[] = [];

  function roundDown(n: number): number {
    return roundTo > 1 ? Math.floor(n / roundTo) * roundTo : n;
  }

  for (const item of topack) {
    const maxPerBox = roundDown(Math.floor(maxVol / item.unitVolume));
    if (maxPerBox <= 0) continue; // единица больше короба

    let remaining = item.needed;

    // Заполняем полные короба этим размером
    while (remaining >= maxPerBox) {
      const qty = maxPerBox;
      const vol = qty * item.unitVolume;
      boxes.push({
        boxNumber: 0, // пронумеруем в конце
        items: [{ item, qty, volumeUsed: vol }],
        totalVolume: vol,
        maxVolume: maxVol,
        fillPercent: (vol / maxVol) * 100,
      });
      remaining -= qty;
    }

    // Остаток этого размера — в отдельный короб (или в leftovers если мало)
    if (remaining > 0) {
      const vol = remaining * item.unitVolume;
      const fillPct = (vol / maxVol) * 100;

      if (fillPct >= 40) {
        // Достаточно для своего короба — не мешаем
        boxes.push({
          boxNumber: 0,
          items: [{ item, qty: remaining, volumeUsed: vol }],
          totalVolume: vol,
          maxVolume: maxVol,
          fillPercent: fillPct,
        });
      } else if (remaining >= minUnitsLeftover) {
        // Мелкий остаток но выше порога — попробуем доложить в другой короб позже
        leftovers.push({ item, remaining });
      }
      // else: остаток < minUnitsLeftover — отбрасываем (не стоит докладывать)
    }
  }

  // ЭТАП 2: Мелкие остатки — докладываем в короба где есть место
  for (const { item, remaining: leftQty } of leftovers) {
    let remaining = leftQty;

    // Сначала ищем короб с наибольшим свободным местом
    const sortedBoxes = [...boxes].sort((a, b) =>
      (b.maxVolume - b.totalVolume) - (a.maxVolume - a.totalVolume)
    );

    for (const existingBox of sortedBoxes) {
      if (remaining <= 0) break;

      // Лимит позиций (строк) в коробе
      if (existingBox.items.length >= maxArticlesPerBox) continue;

      const freeVol = existingBox.maxVolume - existingBox.totalVolume;
      const canFit = roundDown(Math.floor(freeVol / item.unitVolume));
      if (canFit >= minUnitsLeftover) {
        // Кладём только если влезет >= мин. штук
        const qty = Math.min(canFit, remaining);
        const vol = qty * item.unitVolume;
        existingBox.items.push({ item, qty, volumeUsed: vol });
        existingBox.totalVolume += vol;
        existingBox.fillPercent = (existingBox.totalVolume / existingBox.maxVolume) * 100;
        remaining -= qty;
      }
    }

    // Если всё ещё остались — новый короб (только если >= minUnits)
    if (remaining >= minUnitsLeftover) {
      const vol = remaining * item.unitVolume;
      boxes.push({
        boxNumber: 0,
        items: [{ item, qty: remaining, volumeUsed: vol }],
        totalVolume: vol,
        maxVolume: maxVol,
        fillPercent: (vol / maxVol) * 100,
      });
    }
  }

  // Пронумеровать короба
  boxes.forEach((b, i) => { b.boxNumber = i + 1; });

  const totalItems = boxes.reduce(
    (sum, b) => sum + b.items.reduce((s, i) => s + i.qty, 0),
    0
  );

  return {
    boxes,
    totalBoxes: boxes.length,
    totalItems,
    boxConfig: box,
    boxVolume: fullVol,
    usableVolume: maxVol,
  };
}
