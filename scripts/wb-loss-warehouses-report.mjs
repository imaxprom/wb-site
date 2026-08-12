import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "wb-loss-warehouses-report-2026-07-24.json");
const OUT_HTML = path.join(ROOT, "wb-loss-warehouses-report-2026-07-24.html");
const OUT_PDF = path.join(ROOT, "wb-loss-warehouses-report-2026-07-24.pdf");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const RUB = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("ru-RU");

function money(value) {
  return RUB.format(Math.round(Number(value || 0))).replace(/\s?₽/, " ₽");
}

function num(value) {
  return NUM.format(Number(value || 0));
}

function dt(value) {
  if (!value) return "нет данных";
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(part, total) {
  if (!total) return "0,0%";
  return `${(part / total * 100).toFixed(1).replace(".", ",")}%`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function articleRows(rows, totalAmount) {
  return rows.map((row) => `
    <tr>
      <td>${esc(row.articleWb)}</td>
      <td>${esc(row.brand)}</td>
      <td>${esc(row.articleSeller)}</td>
      <td class="num">${num(row.quantity)}</td>
      <td class="num">${money(row.amount)}</td>
      <td class="num">${pct(row.amount, totalAmount)}</td>
    </tr>
  `).join("");
}

function brandRows(rows) {
  return rows.map((row) => `
    <tr>
      <td>${esc(row.brand)}</td>
      <td class="num">${num(row.quantity)}</td>
      <td class="num">${money(row.amount)}</td>
      <td class="num">${row.missingQuantity ? num(row.missingQuantity) : "0"}</td>
    </tr>
  `).join("");
}

function detailRows(rows) {
  return rows.map((row) => `
    <tr class="${row.missingCost ? "warn-row" : ""}">
      <td>${esc(row.articleWb)}</td>
      <td>${esc(row.brand)}</td>
      <td>${esc(row.articleSeller)}</td>
      <td>${esc(row.size)}</td>
      <td>${esc(row.barcode)}</td>
      <td class="num">${num(row.quantity)}</td>
      <td class="num">${money(row.unitCost)}</td>
      <td class="num">${money(row.amount)}</td>
    </tr>
  `).join("");
}

const missingDetails = data.warehouses.flatMap((warehouse) =>
  warehouse.details
    .filter((row) => row.missingCost)
    .map((row) => ({ warehouse: warehouse.name, ...row }))
);

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Отчёт по остаткам и себестоимости WB</title>
  <style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      margin: 0;
      color: #111827;
      font-size: 10.5px;
      line-height: 1.35;
    }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: 24px; line-height: 1.12; }
    h2 { font-size: 16px; margin-top: 18px; margin-bottom: 8px; }
    h3 { font-size: 12px; margin-top: 12px; margin-bottom: 6px; }
    p { margin: 5px 0; }
    .muted { color: #6b7280; }
    .small { font-size: 9.5px; }
    .topline {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 2px solid #111827;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .doc-meta { text-align: right; color: #374151; min-width: 190px; }
    .notice {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      padding: 10px 12px;
      border-radius: 6px;
      margin: 10px 0 12px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 12px 0;
    }
    .metric {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 9px;
      min-height: 58px;
    }
    .metric .label { color: #6b7280; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
    .metric .value { font-size: 17px; font-weight: 700; margin-top: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 6px 0 10px;
      page-break-inside: auto;
    }
    tr { page-break-inside: avoid; }
    th, td {
      border: 1px solid #d1d5db;
      padding: 4px 5px;
      vertical-align: top;
    }
    th {
      background: #eef2f7;
      font-weight: 700;
      text-align: left;
    }
    .num { text-align: right; white-space: nowrap; }
    .section { page-break-inside: avoid; }
    .warehouse-section { page-break-before: auto; }
    .appendix { page-break-before: always; }
    .warn {
      border: 1px solid #f59e0b;
      background: #fffbeb;
      padding: 8px 10px;
      border-radius: 6px;
      margin: 10px 0;
    }
    .warn-row td { background: #fffbeb; }
    .sign {
      margin-top: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    .line {
      border-top: 1px solid #111827;
      padding-top: 5px;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="topline">
    <div>
      <h1>Расчёт остатков товара и себестоимости<br>для заявления на возмещение убытка</h1>
      <p class="muted">Склады Wildberries: Электросталь, Невинномысск, Санкт-Петербург / Шушары</p>
    </div>
    <div class="doc-meta">
      <p><strong>Дата формирования:</strong><br>${dt(data.generatedAt)} МСК</p>
      <p><strong>Снимок остатков:</strong><br>${dt(data.snapshot.maxUpdatedAt)} МСК</p>
    </div>
  </div>

  <div class="notice">
    <p><strong>Назначение документа:</strong> расчёт количества товара и его себестоимости на складах Wildberries на основании актуального снимка остатков, находившегося в системе на момент формирования отчёта.</p>
    <p><strong>Источник остатков:</strong> ${esc(data.source.stockSource)} → production-таблица <strong>${esc(data.source.stockTable)}</strong>. <strong>Источник себестоимости:</strong> production-таблица <strong>${esc(data.source.costTable)}</strong>, значение по barcode.</p>
  </div>

  <div class="summary-grid">
    <div class="metric"><div class="label">Итого товара</div><div class="value">${num(data.total.quantity)} шт.</div></div>
    <div class="metric"><div class="label">Итого себестоимость</div><div class="value">${money(data.total.amount)}</div></div>
    <div class="metric"><div class="label">Средняя себестоимость</div><div class="value">${money(data.total.avgCost)}</div></div>
    <div class="metric"><div class="label">Склады</div><div class="value">${data.warehouses.length}</div></div>
  </div>

  <h2>Сводная таблица по складам</h2>
  <table>
    <thead>
      <tr>
        <th>Склад для отчёта</th>
        <th>Название склада в WB</th>
        <th class="num">Кол-во</th>
        <th class="num">Себестоимость</th>
        <th class="num">Средняя себестоимость</th>
        <th class="num">Артикулов</th>
      </tr>
    </thead>
    <tbody>
      ${data.warehouses.map((warehouse) => `
        <tr>
          <td>${esc(warehouse.name)}</td>
          <td>${warehouse.wbWarehouses.map(esc).join("<br>")}</td>
          <td class="num">${num(warehouse.quantity)}</td>
          <td class="num">${money(warehouse.amount)}</td>
          <td class="num">${money(warehouse.avgCost)}</td>
          <td class="num">${num(warehouse.articleCount)}</td>
        </tr>
      `).join("")}
      <tr>
        <th colspan="2">Итого</th>
        <th class="num">${num(data.total.quantity)}</th>
        <th class="num">${money(data.total.amount)}</th>
        <th class="num">${money(data.total.avgCost)}</th>
        <th class="num">${num(new Set(data.warehouses.flatMap((warehouse) => warehouse.byArticle.map((row) => row.articleWb))).size)}</th>
      </tr>
    </tbody>
  </table>

  ${missingDetails.length ? `
    <div class="warn">
      <p><strong>Примечание по себестоимости:</strong> по ${num(data.total.missingQuantity)} шт. себестоимость в базе не задана, поэтому эта позиция не включена в сумму к возмещению.</p>
      <p>${missingDetails.map((row) => `${esc(row.warehouse)}: WB ${esc(row.articleWb)}, barcode ${esc(row.barcode)}, ${num(row.quantity)} шт.`).join("; ")}</p>
    </div>
  ` : ""}

  ${data.warehouses.map((warehouse) => `
    <div class="section warehouse-section">
      <h2>${esc(warehouse.name)}</h2>
      <p class="muted">WB-название склада: ${warehouse.wbWarehouses.map(esc).join(", ")}. Снимок остатков: ${dt(warehouse.maxUpdatedAt)} МСК.</p>
      <div class="summary-grid">
        <div class="metric"><div class="label">Количество</div><div class="value">${num(warehouse.quantity)} шт.</div></div>
        <div class="metric"><div class="label">Себестоимость</div><div class="value">${money(warehouse.amount)}</div></div>
        <div class="metric"><div class="label">Barcode</div><div class="value">${num(warehouse.barcodeCount)}</div></div>
        <div class="metric"><div class="label">Артикулы WB</div><div class="value">${num(warehouse.articleCount)}</div></div>
      </div>

      <h3>Разбивка по брендам</h3>
      <table>
        <thead><tr><th>Бренд</th><th class="num">Кол-во</th><th class="num">Себестоимость</th><th class="num">Без себестоимости, шт.</th></tr></thead>
        <tbody>${brandRows(warehouse.byBrand)}</tbody>
      </table>

      <h3>Разбивка по артикулам</h3>
      <table>
        <thead><tr><th>Артикул WB</th><th>Бренд</th><th>Артикул продавца</th><th class="num">Кол-во</th><th class="num">Себестоимость</th><th class="num">Доля суммы</th></tr></thead>
        <tbody>${articleRows(warehouse.byArticle, warehouse.amount)}</tbody>
      </table>
    </div>
  `).join("")}

  <div class="appendix">
    <h2>Приложение: детализация по размерам и barcode</h2>
    <p class="muted">В таблицах ниже количество и сумма приведены по каждой строке barcode/размер внутри склада.</p>
    ${data.warehouses.map((warehouse) => `
      <h3>${esc(warehouse.name)}</h3>
      <table>
        <thead>
          <tr>
            <th>Артикул WB</th>
            <th>Бренд</th>
            <th>Артикул продавца</th>
            <th>Размер</th>
            <th>Barcode</th>
            <th class="num">Кол-во</th>
            <th class="num">Себестоимость / шт.</th>
            <th class="num">Сумма</th>
          </tr>
        </thead>
        <tbody>${detailRows(warehouse.details)}</tbody>
      </table>
    `).join("")}
  </div>

  <div class="appendix">
    <h2>Пояснение к расчёту</h2>
    <p>Расчёт выполнен как произведение количества товара на складе Wildberries по каждому barcode на установленную себестоимость этого barcode в учётной базе.</p>
    <p>Формула строки: <strong>Количество на складе × Себестоимость единицы = Сумма себестоимости</strong>.</p>
    <p>Итоговая сумма является суммой всех строк по трём складам, за исключением позиций, по которым себестоимость в базе не задана.</p>
    <div class="sign">
      <div class="line">Подпись / ответственное лицо</div>
      <div class="line">Дата</div>
    </div>
  </div>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html);

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({
  headless: "new",
  executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: OUT_PDF,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;color:#6b7280;width:100%;padding:0 12mm;">Отчёт по остаткам и себестоимости WB</div>`,
    footerTemplate: `<div style="font-size:8px;color:#6b7280;width:100%;padding:0 12mm;text-align:right;">стр. <span class="pageNumber"></span> из <span class="totalPages"></span></div>`,
    margin: { top: "18mm", right: "12mm", bottom: "16mm", left: "12mm" },
  });
} finally {
  await browser.close();
}

console.log(JSON.stringify({ html: OUT_HTML, pdf: OUT_PDF }, null, 2));
