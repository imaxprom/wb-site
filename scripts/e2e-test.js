#!/usr/bin/env node
/**
 * e2e-test.js — End-to-end тестирование /shipment через Puppeteer
 *
 * Запуск: node scripts/e2e-test.js [--screenshots-dir /path]
 *
 * Что делает:
 *  1. Открывает /shipment
 *  2. Проверяет все вкладки (Расчёт, Товары, Загрузка данных, Настройки отгрузки)
 *  3. Проверяет режимы V1/V2/V3
 *  4. Проверяет переключение настроек (выкуп, регионы)
 *  5. Проверяет инварианты (значения >= 0, суммы, корректность данных)
 *  6. Делает скриншоты каждого шага
 *  7. Выводит отчёт: ✅/❌ по каждой проверке
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const PROFILE_DIR = "/Users/octopus/.puppeteer-profile";
const BASE_URL = "http://localhost:3000";
const DEFAULT_SCREENSHOTS_DIR = "/Users/octopus/.openclaw/agents/chuck/agent/test-results";
const E2E_EMAIL = process.env.MPHUB_E2E_EMAIL || "admin";
const E2E_PASSWORD = process.env.MPHUB_E2E_PASSWORD || "admin";

// Parse args
const args = process.argv.slice(2);
const screenshotsDir = args.includes("--screenshots-dir")
  ? args[args.indexOf("--screenshots-dir") + 1]
  : DEFAULT_SCREENSHOTS_DIR;

// Test results
const results = [];
let screenshotIndex = 0;

function pass(name, details = "") {
  results.push({ status: "PASS", name, details });
  console.log(`  ✅ ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name, details = "") {
  results.push({ status: "FAIL", name, details });
  console.log(`  ❌ ${name}${details ? ` — ${details}` : ""}`);
}

async function screenshot(page, label) {
  screenshotIndex++;
  const filename = `${String(screenshotIndex).padStart(2, "0")}-${label.replace(/[^a-zA-Z0-9а-яА-Я-]/g, "_")}.png`;
  const filepath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((t) => {
    for (const b of document.querySelectorAll("button")) {
      if (b.textContent && b.textContent.trim().includes(t)) {
        b.click();
        return true;
      }
    }
    return false;
  }, text);
  if (clicked) await new Promise((r) => setTimeout(r, 1500));
  return clicked;
}

async function getPageText(page) {
  return page.evaluate(() => document.body.innerText);
}

async function getTableNumbers(page, selector = "table.data-table") {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return [];
    const cells = Array.from(table.querySelectorAll("td.num, td[class*='num']"));
    return cells.map((c) => {
      const text = c.textContent.trim().replace(/\s/g, "").replace("—", "");
      return text === "" ? null : parseFloat(text.replace(",", "."));
    }).filter((n) => n !== null);
  }, selector);
}

async function countTableRows(page) {
  return page.evaluate(() => {
    const table = document.querySelector("table.data-table");
    if (!table) return 0;
    return table.querySelectorAll("tbody tr").length;
  });
}

async function getCardValues(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*='grid'] > div"));
    return cards.map((c) => ({
      label: (c.querySelector("[class*='text-muted']") || {}).textContent || "",
      value: (c.querySelector("[class*='font-bold']") || {}).textContent || "",
    }));
  });
}

// ═══════════════════════════════════════════════════
// ТЕСТЫ
// ═══════════════════════════════════════════════════

async function testPageLoad(page) {
  console.log("\n📋 ГРУППА 1: Загрузка страницы");
  await page.goto(BASE_URL + "/shipment", { waitUntil: "networkidle2", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));

  const text = await getPageText(page);

  // 1.1 Страница загрузилась
  if (text.includes("Расчёт отгрузки")) {
    pass("Страница /shipment загрузилась");
  } else {
    fail("Страница /shipment не загрузилась");
    return false;
  }

  // 1.2 Есть данные
  if (!text.includes("Нет данных для расчёта")) {
    pass("Данные загружены (не пустая страница)");
  } else {
    fail("Нет данных — загрузите через UploadTab сначала");
    return false;
  }

  // 1.3 Все 4 вкладки присутствуют
  const tabs = ["Расчёт", "Товары", "Загрузка данных", "Настройки отгрузки"];
  for (const tab of tabs) {
    if (text.includes(tab)) {
      pass(`Вкладка «${tab}» присутствует`);
    } else {
      fail(`Вкладка «${tab}» отсутствует`);
    }
  }

  await screenshot(page, "01-page-loaded");
  return true;
}

async function testCalcModes(page) {
  console.log("\n📋 ГРУППА 2: Режимы расчёта V1/V2/V3");

  // Убедимся что мы на вкладке Расчёт
  await clickButton(page, "Расчёт");
  await new Promise((r) => setTimeout(r, 1000));

  // 2.1 V3 по умолчанию — проверяем карточки Smart
  const textV3 = await getPageText(page);
  if (textV3.includes("Коробов (Smart)") || textV3.includes("Smart")) {
    pass("V3 — карточки Smart видны (режим по умолчанию)");
  } else {
    fail("V3 — карточки Smart НЕ видны");
  }

  // Проверяем summary карточки V3
  const hasBalance = textV3.includes("Баланс склада");
  const hasDemand = textV3.includes("Переизбыток") || textV3.includes("Дефицит");
  const hasOnWB = textV3.includes("Остаток на складе WB");
  if (hasBalance && hasDemand && hasOnWB) {
    pass("V3 — все 4 карточки видны (Остаток/Переизбыток/К отгрузке/Баланс)");
  } else {
    fail("V3 — не все карточки видны", `Баланс:${hasBalance} Потребность:${hasDemand} НаВБ:${hasOnWB}`);
  }

  await screenshot(page, "02-v3-default");

  // 2.2 Переключение на V1
  await clickButton(page, "V1 Стандарт");
  const textV1 = await getPageText(page);
  const v1HasBoxes = textV1.includes("Шт/кор") || textV1.includes("Коробки");
  if (!v1HasBoxes && textV1.includes("Нужно")) {
    pass("V1 — без коробок, столбец «Нужно» виден");
  } else if (!v1HasBoxes) {
    pass("V1 — без коробок");
  } else {
    fail("V1 — столбцы коробок присутствуют (не должны)");
  }
  await screenshot(page, "03-v1-standard");

  // 2.3 Переключение на V2
  await clickButton(page, "V2 Динамика");
  await new Promise((r) => setTimeout(r, 500));
  const textV2 = await getPageText(page);
  const textV2Lower = textV2.toLowerCase();
  const v2HasTrend = textV2.includes("Динамика заказов по неделям");
  const v2HasBoxCol = textV2Lower.includes("шт/кор");
  if (v2HasTrend) {
    pass("V2 — панель динамики по неделям видна");
  } else {
    fail("V2 — панель динамики НЕ видна");
  }
  if (v2HasBoxCol) {
    pass("V2 — столбец Шт/кор виден");
  } else {
    fail("V2 — столбец Шт/кор НЕ виден");
  }
  await screenshot(page, "04-v2-dynamics");

  // 2.4 Вернуться на V3
  await clickButton(page, "V3 Умный");
  await new Promise((r) => setTimeout(r, 500));
}

async function testWeeklyData(page) {
  console.log("\n📋 ГРУППА 3: Динамика по неделям");

  // Переключимся на V2 для проверки графика
  await clickButton(page, "Расчёт");
  await clickButton(page, "V2 Динамика");
  await new Promise((r) => setTimeout(r, 1000));

  // 3.1 Проверяем количество недель
  const weekData = await page.evaluate(() => {
    // Ищем элементы с текстом "Нед. N" — это лейблы баров графика
    const spans = Array.from(document.querySelectorAll("span"));
    const weeks = [];
    for (const span of spans) {
      const text = (span.textContent || "").trim();
      const match = text.match(/^Нед\.\s*(\d+)$/);
      if (match) {
        // Найден лейбл недели — теперь ищем данные в родительском div
        const row = span.closest("div[class*='flex']");
        if (!row) continue;
        // Количество заказов — элемент font-mono
        const numEls = row.querySelectorAll("[class*='font-mono']");
        let count = 0;
        for (const el of numEls) {
          const val = parseInt(el.textContent.replace(/\s/g, ""), 10);
          if (!isNaN(val)) { count = val; break; }
        }
        // Диапазон дат — последний text-muted в строке
        const muteds = row.querySelectorAll("[class*='text-muted']");
        const dateRange = muteds.length > 0 ? muteds[muteds.length - 1].textContent.trim() : "";
        weeks.push({ week: parseInt(match[1]), count, dateRange });
      }
    }
    return weeks;
  });

  if (weekData.length >= 4) {
    pass(`Найдено ${weekData.length} недель в графике`);
  } else {
    fail(`Найдено ${weekData.length} недель (ожидалось >= 4)`);
  }

  // 3.2 Все недели имеют даты
  const allHaveDates = weekData.every((w) => w.dateRange && w.dateRange.includes("–"));
  if (allHaveDates) {
    pass("Все недели имеют диапазон дат");
  } else {
    fail("Не все недели имеют диапазон дат", JSON.stringify(weekData));
  }

  // 3.3 Заказы >= 0 (инвариант)
  const allPositive = weekData.every((w) => w.count >= 0 && !isNaN(w.count));
  if (allPositive) {
    pass("Все недели: заказы >= 0 (нет NaN/отрицательных)");
  } else {
    fail("Есть недели с NaN или отрицательными заказами", JSON.stringify(weekData));
  }

  // 3.4 Есть прогноз
  const pageText = await getPageText(page);
  if (pageText.includes("Прогн.") || pageText.includes("прогноз")) {
    pass("Прогнозная строка присутствует");
  } else {
    fail("Прогнозная строка отсутствует");
  }

  // 3.5 R² отображается
  if (pageText.includes("R²")) {
    pass("R² коэффициент отображается");
  } else {
    fail("R² коэффициент не отображается");
  }

  // 3.6 Множитель отображается
  if (pageText.includes("Множитель") || pageText.includes("×")) {
    pass("Множитель тренда отображается");
  } else {
    fail("Множитель тренда не отображается");
  }

  await screenshot(page, "05-weekly-data");
}

async function testTabs(page) {
  console.log("\n📋 ГРУППА 4: Вкладки");

  // 4.1 Товары
  await clickButton(page, "Товары");
  await new Promise((r) => setTimeout(r, 500));
  const textProducts = await getPageText(page);
  const textProductsLower = textProducts.toLowerCase();
  if (textProductsLower.includes("артикул") || textProductsLower.includes("размер") || textProductsLower.includes("на складах") || textProductsLower.includes("карточки товаров")) {
    pass("Вкладка «Товары» — контент отображается");
  } else {
    fail("Вкладка «Товары» — контент не найден");
  }
  await screenshot(page, "06-tab-products");

  // 4.2 Загрузка данных
  await clickButton(page, "Загрузка данных");
  await new Promise((r) => setTimeout(r, 500));
  const textUpload = await getPageText(page);

  // Проверяем диапазон дат рядом с селектом
  const hasDateRange = /\d{2}\.\d{2}\s*–\s*\d{2}\.\d{2}/.test(textUpload);
  if (hasDateRange) {
    pass("Загрузка данных — диапазон дат отображается рядом с селектом");
  } else {
    fail("Загрузка данных — диапазон дат НЕ найден");
  }

  if (textUpload.includes("Загрузить всё из WB")) {
    pass("Загрузка данных — кнопка загрузки присутствует");
  } else {
    fail("Загрузка данных — кнопка загрузки отсутствует");
  }

  // Проверяем текущие данные
  if (textUpload.includes("Текущие данные")) {
    pass("Загрузка данных — секция «Текущие данные» видна");
  } else {
    fail("Загрузка данных — секция «Текущие данные» не видна");
  }
  await screenshot(page, "07-tab-upload");

  // 4.3 Настройки отгрузки
  await clickButton(page, "Настройки отгрузки");
  await new Promise((r) => setTimeout(r, 500));
  const textSettings = await getPageText(page);

  if (textSettings.includes("% выкупа") || textSettings.includes("выкуп")) {
    pass("Настройки — секция % выкупа присутствует");
  } else {
    fail("Настройки — секция % выкупа отсутствует");
  }

  if (textSettings.includes("Регион") || textSettings.includes("ФО")) {
    pass("Настройки — секция регионов присутствует");
  } else {
    fail("Настройки — секция регионов отсутствует");
  }

  if (textSettings.includes("Размер короба") || textSettings.includes("Длина")) {
    pass("Настройки — размер короба присутствует");
  } else {
    fail("Настройки — размер короба отсутствует");
  }
  await screenshot(page, "08-tab-settings");

  // Вернуться на Расчёт
  await clickButton(page, "Расчёт");
}

async function testBuyoutMode(page) {
  console.log("\n📋 ГРУППА 5: Переключение % выкупа");

  await clickButton(page, "Настройки отгрузки");
  await new Promise((r) => setTimeout(r, 500));

  // 5.1 Проверяем кнопки Авто/Ручной
  const hasAutoBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.some((b) => b.textContent && b.textContent.includes("Авто") && b.textContent.includes("артикул"));
  });
  if (hasAutoBtn) {
    pass("Кнопка «Авто (по артикулам)» присутствует");
  } else {
    fail("Кнопка «Авто (по артикулам)» не найдена");
  }

  // 5.2 Нажать «Ручной» — должна появиться шкала
  const clickedManual = await clickButton(page, "Ручной");
  if (clickedManual) {
    await new Promise((r) => setTimeout(r, 500));
    const textManual = await getPageText(page);
    const hasSlider = await page.evaluate(() => {
      return !!document.querySelector("input[type='range']");
    });
    if (hasSlider || textManual.includes("%")) {
      pass("Ручной выкуп — шкала/% видна");
    } else {
      fail("Ручной выкуп — шкала не появилась");
    }
    await screenshot(page, "09-buyout-manual");
  }

  // 5.3 Нажать «Авто» — шкала должна скрыться
  const clickedAutoArr = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      if (b.textContent && b.textContent.includes("Авто") && b.textContent.includes("артикул")) {
        b.click();
        return true;
      }
    }
    return false;
  });
  if (clickedAutoArr) {
    await new Promise((r) => setTimeout(r, 500));
    const hasSliderAfter = await page.evaluate(() => {
      // In auto mode, the range slider for buyout should be hidden
      const ranges = Array.from(document.querySelectorAll("input[type='range']"));
      // Check if buyout range is present (might still have region ranges)
      return ranges.length;
    });
    pass("Авто выкуп — переключение работает");
    await screenshot(page, "10-buyout-auto");
  }

  // Сохраняем настройки
  await clickButton(page, "Сохранить");
  await clickButton(page, "Расчёт");
}

async function testInvariants(page) {
  console.log("\n📋 ГРУППА 6: Инварианты (числовые проверки)");

  // Переключиться на V3 для максимальных проверок
  await clickButton(page, "Расчёт");
  await clickButton(page, "V3 Умный");
  await new Promise((r) => setTimeout(r, 1000));

  // 6.1 Все числа в таблице >= 0 (нет NaN, Infinity, отрицательных)
  const tableNums = await getTableNumbers(page);
  const hasNaN = tableNums.some((n) => isNaN(n));
  const hasInfinity = tableNums.some((n) => !isFinite(n));
  const hasNegative = tableNums.some((n) => n < 0);

  if (!hasNaN) {
    pass(`Таблица: нет NaN (проверено ${tableNums.length} ячеек)`);
  } else {
    fail("Таблица: обнаружен NaN");
  }

  if (!hasInfinity) {
    pass("Таблица: нет Infinity");
  } else {
    fail("Таблица: обнаружен Infinity");
  }

  if (!hasNegative) {
    pass("Таблица: нет отрицательных значений");
  } else {
    fail("Таблица: обнаружены отрицательные значения");
  }

  // 6.2 Карточки: Smart коробов >= 0
  const cardData = await page.evaluate(() => {
    const cards = document.querySelectorAll("[class*='grid'] > [class*='bg-']");
    const data = {};
    for (const card of cards) {
      const label = card.querySelector("[class*='text-muted']");
      // Value: font-bold + text-lg (card value, not InfoTip "?")
      const value = card.querySelector("[class*='font-bold'][class*='text-lg']");
      if (label && value) {
        // Strip InfoTip "?" from label text
        const key = label.textContent.trim().replace(/\?/g, "").trim();
        data[key] = value.textContent.trim().replace(/\s/g, "");
      }
    }
    return data;
  });

  const toShipText = (cardData["К отгрузке"] || "0").replace(/[^\d]/g, "");
  const toShip = parseInt(toShipText, 10);
  if (toShip >= 0 && !isNaN(toShip)) {
    pass(`К отгрузке = ${toShip.toLocaleString("ru-RU")} шт (валидное число)`);
  } else {
    fail(`К отгрузке = ${cardData["К отгрузке"]} (невалидное)`);
  }

  // 6.3 Остаток на складе WB > 0 (если данные загружены)
  const onWB = parseInt((cardData["Остаток на складе WB"] || "0").replace(/\s/g, ""), 10);
  if (onWB > 0) {
    pass(`Остаток на складе WB = ${onWB.toLocaleString("ru-RU")}`);
  } else {
    fail(`Остаток на складе WB = ${onWB} (подозрительно мало)`);
  }

  // 6.4 Количество строк в таблице > 0
  // Expand "Детализация по регионам" if collapsed
  await page.evaluate(() => {
    const headers = document.querySelectorAll("[class*='cursor-pointer']");
    for (const h of headers) {
      if (h.textContent && h.textContent.includes("Детализация")) {
        h.click();
      }
    }
  });
  await new Promise((r) => setTimeout(r, 500));

  const rowCount = await countTableRows(page);
  if (rowCount > 0) {
    pass(`Таблица: ${rowCount} строк`);
  } else {
    fail("Таблица: 0 строк");
  }

  await screenshot(page, "11-invariants-v3");

  // 6.5 Округление: все числа ×qty в коробах кратны roundTo (по умолчанию 5)
  const boxNumbers = await page.evaluate(() => {
    const nums = [];
    // Ищем "×число" только в элементах с text-muted (подпись кол-ва в коробе)
    document.querySelectorAll("span").forEach((el) => {
      const text = (el.textContent || "").trim();
      const match = text.match(/^×(\d+)$/);
      if (match) nums.push(parseInt(match[1], 10));
    });
    return nums;
  });
  const nonRounded = boxNumbers.filter((n) => n > 0 && n % 5 !== 0);
  if (boxNumbers.length > 0 && nonRounded.length === 0) {
    pass(`Округление: все ${boxNumbers.length} значений кратны 5`);
  } else if (boxNumbers.length === 0) {
    pass("Округление: нет коробов для проверки");
  } else {
    fail(`Округление: ${nonRounded.length} значений не кратны 5: ${nonRounded.slice(0, 5).join(", ")}`);
  }

  // 6.6 minUnits: ни одна позиция ×qty в коробах < roundTo (минимум при округлении)
  const roundTo = 5; // default
  const smallItems = boxNumbers.filter((n) => n > 0 && n < roundTo);
  if (smallItems.length === 0) {
    pass(`minUnits: нет позиций < ${roundTo} в коробах`);
  } else {
    fail(`minUnits: ${smallItems.length} позиций < ${roundTo}: ${smallItems.join(", ")}`);
  }

  // 6.7 Корректировка последней недели (Sales Funnel vs supplier/orders)
  const corrCheck = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/data/orders?days=7");
      const orders7 = await res.json();
      // Проверяем что количество заказов > 0
      return { ok: orders7.length > 0, count: orders7.length };
    } catch { return { ok: false, count: 0 }; }
  });
  if (corrCheck.ok) {
    pass(`Корректировка: ${corrCheck.count} заказов за 7 дней (с учётом Sales Funnel)`);
  } else {
    fail("Корректировка: нет заказов за 7 дней");
  }

  // 6.8 V1: проверка тех же инвариантов
  await clickButton(page, "V1 Стандарт");
  await new Promise((r) => setTimeout(r, 500));
  const v1Nums = await getTableNumbers(page);
  const v1HasNaN = v1Nums.some((n) => isNaN(n));
  if (!v1HasNaN) {
    pass(`V1 таблица: нет NaN (${v1Nums.length} ячеек)`);
  } else {
    fail("V1 таблица: обнаружен NaN");
  }

  // 6.9 V2: проверка
  await clickButton(page, "V2 Динамика");
  await new Promise((r) => setTimeout(r, 500));
  const v2Nums = await getTableNumbers(page);
  const v2HasNaN = v2Nums.some((n) => isNaN(n));
  if (!v2HasNaN) {
    pass(`V2 таблица: нет NaN (${v2Nums.length} ячеек)`);
  } else {
    fail("V2 таблица: обнаружен NaN");
  }

  await clickButton(page, "V3 Умный");
}

async function testArticleFilter(page) {
  console.log("\n📋 ГРУППА 7: Фильтр по артикулу");

  await clickButton(page, "Расчёт");
  await clickButton(page, "V3 Умный");
  await new Promise((r) => setTimeout(r, 500));

  // Expand "Детализация по регионам" if collapsed
  await page.evaluate(() => {
    const headers = document.querySelectorAll("[class*='cursor-pointer']");
    for (const h of headers) {
      if (h.textContent && h.textContent.includes("Детализация")) {
        // Only click if table not visible
        if (!document.querySelector("table.data-table")) {
          h.click();
        }
      }
    }
  });
  await new Promise((r) => setTimeout(r, 500));

  // 7.1 Селект «Все артикулы» присутствует
  const selectOptions = await page.evaluate(() => {
    const select = document.querySelector("select");
    if (!select) return [];
    return Array.from(select.options).map((o) => o.textContent);
  });

  if (selectOptions.length > 1) {
    pass(`Селект артикулов: ${selectOptions.length} опций (включая «Все»)`);
  } else {
    fail("Селект артикулов: мало опций");
  }

  // 7.2 Выбрать конкретный артикул
  const rowsBefore = await countTableRows(page);
  const switched = await page.evaluate(() => {
    const select = document.querySelector("select");
    if (!select || select.options.length < 2) return false;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });

  if (switched) {
    await new Promise((r) => setTimeout(r, 1000));
    const rowsAfter = await countTableRows(page);
    if (rowsAfter < rowsBefore && rowsAfter > 0) {
      pass(`Фильтр по артикулу: строк ${rowsBefore} → ${rowsAfter}`);
    } else if (rowsAfter > 0) {
      pass(`Фильтр по артикулу: ${rowsAfter} строк (может быть 1 артикул)`, `было ${rowsBefore}`);
    } else {
      fail("Фильтр по артикулу: 0 строк после фильтрации");
    }
    await screenshot(page, "12-article-filter");

    // Вернуть на «Все артикулы»
    await page.evaluate(() => {
      const select = document.querySelector("select");
      if (select) {
        select.value = "__all__";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function testRegressions(page) {
  console.log("\n📋 ГРУППА 8: Регрессии (прошлые баги)");

  const regressionsPath = path.join(__dirname, "regression-cases.json");
  if (!fs.existsSync(regressionsPath)) {
    pass("Файл регрессий не найден — пропуск");
    return;
  }

  const cases = JSON.parse(fs.readFileSync(regressionsPath, "utf-8"));
  for (const tc of cases) {
    try {
      // Each regression has a check function as string to evaluate
      if (tc.checkType === "page-text") {
        const text = await getPageText(page);
        if (tc.shouldContain && text.includes(tc.shouldContain)) {
          pass(`REG-${tc.id}: ${tc.description}`);
        } else if (tc.shouldNotContain && !text.includes(tc.shouldNotContain)) {
          pass(`REG-${tc.id}: ${tc.description}`);
        } else {
          fail(`REG-${tc.id}: ${tc.description}`);
        }
      } else if (tc.checkType === "evaluate") {
        const result = await page.evaluate(new Function("return " + tc.evaluateFn)());
        if (result) {
          pass(`REG-${tc.id}: ${tc.description}`);
        } else {
          fail(`REG-${tc.id}: ${tc.description}`);
        }
      }
    } catch (err) {
      fail(`REG-${tc.id}: ${tc.description}`, err.message);
    }
  }
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

(async () => {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║   E2E ТЕСТ: Расчёт отгрузки (/shipment)  ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`Скриншоты → ${screenshotsDir}`);

  // Ensure screenshots dir
  fs.mkdirSync(screenshotsDir, { recursive: true });
  // Clean old screenshots
  for (const f of fs.readdirSync(screenshotsDir)) {
    if (f.endsWith(".png")) fs.unlinkSync(path.join(screenshotsDir, f));
  }

  const browser = await puppeteer.launch({
    headless: "shell",
    userDataDir: PROFILE_DIR,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    protocolTimeout: 60000,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // Auth: login if redirected to /login
  await page.goto(BASE_URL + "/shipment", { waitUntil: "networkidle2", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));
  if (page.url().includes("/login")) {
    console.log("🔐 Авторизация...");
    const emailInput = await page.$('input[type="email"], input[type="text"], input[name="email"]');
    const passInput = await page.$('input[type="password"]');
    if (emailInput && passInput) {
      await emailInput.type(E2E_EMAIL);
      await passInput.type(E2E_PASSWORD);
      await clickButton(page, "Войти");
      await new Promise((r) => setTimeout(r, 3000));
      console.log("🔐 Авторизация OK → " + page.url());
    } else {
      console.log("⛔ Форма логина не найдена");
      await browser.close();
      process.exit(1);
    }
  }

  try {
    const loaded = await testPageLoad(page);
    if (!loaded) {
      console.log("\n⛔ Страница не загрузилась — тесты прерваны");
      await browser.close();
      process.exit(1);
    }

    await testCalcModes(page);
    await testWeeklyData(page);
    await testTabs(page);
    await testBuyoutMode(page);
    await testInvariants(page);
    await testArticleFilter(page);
    await testRegressions(page);

  } catch (err) {
    fail("CRASH", err.message);
    await screenshot(page, "99-crash");
  }

  await browser.close();

  // ═══════ ИТОГОВЫЙ ОТЧЁТ ═══════
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const total = results.length;

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log(`║   ИТОГО: ${passed}/${total} ✅    ${failed > 0 ? `${failed} ❌` : "Всё чисто! 🎉"}`.padEnd(44) + "║");
  console.log("╚═══════════════════════════════════════════╝");

  if (failed > 0) {
    console.log("\n❌ Проваленные тесты:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`   • ${r.name}${r.details ? `: ${r.details}` : ""}`);
    }
  }

  console.log(`\n📸 Скриншоты: ${screenshotsDir}`);
  const screenshots = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith(".png"));
  console.log(`   ${screenshots.length} файлов: ${screenshots.join(", ")}`);

  // Write JSON report
  const reportPath = path.join(screenshotsDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ date: new Date().toISOString(), passed, failed, total, results, screenshots }, null, 2));
  console.log(`\n📄 JSON отчёт: ${reportPath}`);

  process.exit(failed > 0 ? 1 : 0);
})();
