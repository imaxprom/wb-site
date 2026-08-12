export type RealSnapshotProduct = {
  category: "backpack" | "underwear" | "other";
  name: string;
  article: string;
  nmId: number;
  size: string;
  barcode: string;
  total: number;
  printed: number;
};

// Read-only snapshot of production-saved "New orders". Captured for the
// localhost visual prototype; it is never imported by the production FBS page.
export const REAL_NEW_ORDERS_SNAPSHOT = {
  fetchedAt: "2026-08-09T06:02:28.355Z",
  orderCount: 109,
  products: [
    { category: "backpack", name: "Рюкзак школьный для подростков набор 4 в 1", article: "голубой_сетка_4в1", nmId: 1267015841, size: "0", barcode: "2053457901787", total: 14, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 8 в 1 Портфель подростковый", article: "черный_бежевый_сетка 8в1", nmId: 1267055950, size: "0", barcode: "2053458177839", total: 8, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 4 в 1 Портфель подростковый", article: "№2 фиолетовый_молочный_сетка_4в1", nmId: 1349340309, size: "0", barcode: "2054395374039", total: 3, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный для девочки", article: "черный_взрослый", nmId: 1275185370, size: "0", barcode: "2053542167050", total: 7, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 8 в 1 Портфель подростковый", article: "черный_сетка_8в1", nmId: 1267100490, size: "0", barcode: "2053458559857", total: 1, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 4 в 1 Портфель подростковый", article: "желтый_сетка_4в1", nmId: 1267117624, size: "0", barcode: "2053458759745", total: 3, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 4 в 1 Портфель подростковый", article: "фиолетовый_молочный_сетка_4в1", nmId: 1267077467, size: "0", barcode: "2053458275719", total: 5, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8369*6605-MC-9", nmId: 322000486, size: "50-52 (4XL)", barcode: "2042679177483", total: 3, printed: 0 },
    { category: "backpack", name: "Рюкзак лимон портфель подростковый", article: "лимон", nmId: 1275158118, size: "0", barcode: "2053541776765", total: 3, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 7 штук", article: "SL8369*6328-MC-7", nmId: 165140159, size: "52-54 (5XL)", barcode: "2038048384422", total: 1, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 8 в 1 Портфель подростковый", article: "№2 Черный_бежевый_8в1", nmId: 1349099782, size: "0", barcode: "2054393158372", total: 2, printed: 0 },
    { category: "backpack", name: "Школьный рюкзак Набор 4 в 1 Портфель подростковый", article: "черный_сетка_4в1", nmId: 1266604919, size: "0", barcode: "2053382846146", total: 5, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8338-MC-9", nmId: 398657691, size: "44-46 (XXL)", barcode: "2043775814661", total: 1, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8338-MC-9", nmId: 398657691, size: "46-48 (XXXL)", barcode: "2043775816092", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный портфель Капибара Супер Хит", article: "Копибара", nmId: 1275738803, size: "0", barcode: "2053545541567", total: 3, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный 4 в 1 портфель для подростков", article: "XINLAIBAIZI_БЕЛЫЙ", nmId: 1267193063, size: "0", barcode: "2053459918073", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный 5в1 портфель для подростков", article: "Кошки черные", nmId: 218225554, size: "0", barcode: "2039681425503", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный портфель Spy X Family", article: "Аниме девочка", nmId: 1275285416, size: "0", barcode: "2053543892210", total: 5, printed: 0 },
    { category: "underwear", name: "Трусы стринги набор 7 штук натуральные хлопковые", article: "ST8187-MC-7", nmId: 163785912, size: "48-50 (4XL)", barcode: "2039108224825", total: 1, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный в клетку подростковый портфель", article: "шашка бежевая", nmId: 176999608, size: "0", barcode: "2038615970508", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный черный", article: "черный_сбрелком", nmId: 1275218350, size: "0", barcode: "2053542796526", total: 3, printed: 0 },
    { category: "underwear", name: "Трусы стринги набор 7 штук натуральные хлопковые", article: "ST8187-MC-7", nmId: 163785912, size: "46-48 (XXXL)", barcode: "2037936095594", total: 2, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8369*6605-MC-9", nmId: 322000486, size: "48-50 (3XL)", barcode: "2042679170798", total: 3, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный для девочки 5в1", article: "Кошки серо зеленые", nmId: 142223431, size: "0", barcode: "2037352002107", total: 2, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8369*6605-MC-9", nmId: 322000486, size: "42-44 (XL)", barcode: "2042679166388", total: 2, printed: 0 },
    { category: "underwear", name: "Трусы слипы набор 9 штук натуральные хлопковые", article: "№2 SL-8369*6605-MC-9", nmId: 304049984, size: "50-52 (4XL)", barcode: "2042294339532", total: 1, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8369*6605-MC-9", nmId: 322000486, size: "44-46 (XXL)", barcode: "2042679167262", total: 2, printed: 0 },
    { category: "underwear", name: "Трусы стринги набор 7 штук натуральные хлопковые", article: "ST8187-MC-7", nmId: 163785912, size: "44-46 (XXL)", barcode: "2037936095211", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный для девочки 5в1", article: "Кошки розовые", nmId: 154377544, size: "0", barcode: "2037659487362", total: 1, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный", article: "№2 Копибара", nmId: 90120326, size: "0", barcode: "5032780255680", total: 4, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8338-MC-9", nmId: 398657691, size: "52-54 (5XL)", barcode: "2043775810595", total: 3, printed: 0 },
    { category: "underwear", name: "Трусы слипы набор 9 штук натуральные хлопковые", article: "№2 SL-8369*6605-MC-9", nmId: 304049984, size: "48-50 (3XL)", barcode: "2042294339044", total: 2, printed: 0 },
    { category: "underwear", name: "Трусы женские набор 9 штук", article: "SL-8338-MC-9", nmId: 398657691, size: "40-42 (L)", barcode: "2043775779342", total: 1, printed: 0 },
    { category: "backpack", name: "Рюкзак в клетку школьный подростковый портфель", article: "шашки_черный", nmId: 1267156182, size: "0", barcode: "2053459590286", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный 4 в 1 портфель для подростков", article: "XINLAIBAIZI_ЧЕРНЫЙ", nmId: 1267205036, size: "0", barcode: "2053460104434", total: 1, printed: 0 },
    { category: "underwear", name: "Трусы слипы набор 9 штук натуральные хлопковые", article: "№2 SL-8369*6605-MC-9", nmId: 304049984, size: "44-46 (XXL)", barcode: "2042294343355", total: 2, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный 5в1 портфель для подростков", article: "Кошки фиолетовые", nmId: 90693351, size: "0", barcode: "2036686028753", total: 1, printed: 0 },
    { category: "backpack", name: "Рюкзак школьный Магическая битва", article: "Аниме мальчик", nmId: 1275399258, size: "0", barcode: "2053545476852", total: 1, printed: 0 },
    { category: "underwear", name: "Трусы слипы набор 9 штук натуральные хлопковые", article: "№2 SL-8369*6605-MC-9", nmId: 304049984, size: "52-54 (5XL)", barcode: "2042294340293", total: 1, printed: 0 },
  ] satisfies RealSnapshotProduct[],
};
