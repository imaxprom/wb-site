import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const htmlPath = path.join(root, "wb-support-appeal-box-43346319.html");
const pdfPath = path.join(root, "wb-support-appeal-box-43346319.pdf");

const orders = [
  {
    sticker: "8736064100",
    assembly: "5191621364",
    srid: "eI.rc9a40cbd99d9474f91626f55f545c2ea.0.0",
    nm: "163785912",
    status: "Отменён клиентом",
    events: "15.06 — обработка 15 ₽; 26.06 — логистика: 91,18 + 46,56 ₽",
    calculation: "15 + 137,74",
    disputed: "152,74 ₽",
  },
  {
    sticker: "42372457536",
    assembly: "5193132093",
    srid: "ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.5.0",
    nm: "333768796",
    status: "Отсортирован",
    events: "15.06 — обработка 15 ₽; логистических строк нет",
    calculation: "15 + 0",
    disputed: "15,00 ₽",
  },
  {
    sticker: "41988544570",
    assembly: "5192899150",
    srid: "eAp.ia08766e1722bffcc48ec03c92c6d9776.0.0",
    nm: "163785912",
    status: "Отменён клиентом",
    events: "15.06 — обработка 15 ₽; 29.06 — логистика: 91,18 + 46,56 ₽",
    calculation: "15 + 137,74",
    disputed: "152,74 ₽",
  },
  {
    sticker: "8736035008",
    assembly: "5191603204",
    srid: "eZ.r21a8e780accc4340a7209bfb31b9fd2b.0.0",
    nm: "333768800",
    status: "Отменён клиентом",
    events: "15.06 — обработка 15 ₽; 27.06 — логистика: 131,82 + 67,00 ₽",
    calculation: "15 + 198,82",
    disputed: "213,82 ₽",
  },
  {
    sticker: "42372457542",
    assembly: "5193132095",
    srid: "ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.4.0",
    nm: "333768796",
    status: "Отсортирован",
    events: "15.06 — обработка 15 ₽; логистических строк нет",
    calculation: "15 + 0",
    disputed: "15,00 ₽",
  },
  {
    sticker: "42372476115",
    assembly: "5193150781",
    srid: "eBK.re9642a3fad3a4301ae6188ab66f6df96.0.0",
    nm: "163785912",
    status: "Готов к выдаче",
    events: "15.06 — обработка 15 ₽; отчёт 20–26.07 — складские/перевозочные издержки 3,99 ₽",
    calculation: "15 + 3,99",
    disputed: "18,99 ₽",
  },
  {
    sticker: "55152939218",
    assembly: "5195877198",
    srid: "eAZ.r9a85df8a2169486daa8ddc84db92c63e.0.0",
    nm: "333768800",
    status: "Готов к выдаче",
    events: "15.06 — обработка 15 ₽; отчёт 20–26.07 — складские/перевозочные издержки 4,26 ₽",
    calculation: "15 + 4,26",
    disputed: "19,26 ₽",
  },
  {
    sticker: "55147690850",
    assembly: "5196019065",
    srid: "ebr.if4c1afc797d0a5bfbc00df9a87a5a24f.0.0",
    nm: "163785912",
    status: "Отменён клиентом",
    events: "15.06 — обработка 15 ₽; 18.07 — логистика: 91,06 + 46,56 ₽",
    calculation: "15 + 137,62",
    disputed: "152,62 ₽",
  },
  {
    sticker: "55146923467",
    assembly: "5195167194",
    srid: "eA1.r0ac6e8e5859d48d28baeccf52bb7aa2d.0.0",
    nm: "163785912",
    status: "Отменён клиентом",
    events: "15.06 — обработка 15 ₽; 23.07 — логистика: 56,16 + 46,56 ₽",
    calculation: "15 + 102,72",
    disputed: "117,72 ₽",
  },
];

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Обращение в поддержку WB — короб 43346319</title>
<style>
  :root {
    --ink:#182238; --navy:#142a50; --blue:#2868bc; --muted:#667186;
    --line:#dbe2ec; --pale:#f4f7fb; --warn:#fff3e2; --good:#eaf6f1;
  }
  * { box-sizing:border-box; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body {
    margin:0; background:#edf1f6; color:var(--ink);
    font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
    font-size:10pt; line-height:1.43;
  }
  @page { size:A4; margin:13mm 12mm 14mm; }
  .page {
    width:210mm; min-height:297mm; margin:0 auto 10mm; padding:13mm 12mm 14mm;
    background:white; position:relative; page-break-after:always;
  }
  .page:last-child { page-break-after:auto; }
  .hero {
    margin:-13mm -12mm 9mm; padding:15mm 15mm 11mm;
    color:white; background:linear-gradient(135deg,#122544,#235792);
  }
  .eyebrow { font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase; opacity:.75; margin-bottom:4mm; }
  h1 { margin:0 0 3mm; font-size:24pt; line-height:1.08; }
  h2 { margin:0 0 4mm; color:var(--navy); font-size:16pt; }
  h3 { margin:5mm 0 2mm; color:var(--navy); font-size:11pt; }
  p { margin:0 0 3mm; }
  .lead { font-size:11pt; }
  .facts { display:grid; grid-template-columns:1fr 1fr; gap:2mm 8mm; margin:4mm 0; }
  .fact { border-bottom:1px solid var(--line); padding-bottom:2mm; }
  .fact span { display:block; color:var(--muted); font-size:7.6pt; }
  .fact strong { display:block; margin-top:.5mm; }
  .box { border-left:3px solid var(--blue); background:#eef5ff; padding:4mm 5mm; margin:4mm 0; }
  .box.warn { border-color:#bc6a15; background:var(--warn); }
  .box.good { border-color:#15805a; background:var(--good); }
  ol { margin:2mm 0 4mm; padding-left:6mm; }
  li { margin-bottom:1.8mm; }
  table { width:100%; border-collapse:collapse; font-size:7pt; line-height:1.28; margin:3mm 0; }
  th { color:white; background:var(--navy); text-align:left; padding:2mm 1.3mm; }
  td { vertical-align:top; padding:1.9mm 1.3mm; border-bottom:1px solid var(--line); }
  tbody tr:nth-child(even) { background:var(--pale); }
  .srid { display:block; color:var(--muted); font-size:5.9pt; overflow-wrap:anywhere; margin-top:.6mm; }
  .nowrap { white-space:nowrap; }
  .total td { font-weight:750; background:#eaf0f8; }
  .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; margin:4mm 0 6mm; }
  .card { padding:4mm 3mm; background:var(--pale); border:1px solid var(--line); border-radius:2.5mm; }
  .value { color:var(--navy); font-size:17pt; font-weight:750; line-height:1; margin-bottom:1.5mm; }
  .label { color:var(--muted); font-size:7.4pt; }
  .footer {
    position:absolute; left:12mm; right:12mm; bottom:5mm; display:flex;
    justify-content:space-between; color:#8b95a5; font-size:7pt;
  }
  .sign { display:grid; grid-template-columns:1fr 1fr; gap:15mm; margin-top:10mm; }
  .sign div { border-top:1px solid #8b95a5; padding-top:1.5mm; color:var(--muted); font-size:8pt; }
  @media print {
    body { background:white; font-size:8.7pt; line-height:1.35; }
    .page { width:auto; min-height:270mm; margin:0; padding:0; }
    .hero { padding:12mm 14mm 8mm; margin-bottom:6mm; }
    h1 { font-size:20pt; }
    h2 { font-size:14pt; margin-bottom:3mm; }
    h3 { margin:3.5mm 0 1.5mm; }
    p { margin-bottom:2.4mm; }
    .lead { font-size:9.5pt; }
    .box { padding:3mm 4mm; margin:3mm 0; }
    table { font-size:6.3pt; margin:2mm 0; }
    th { padding:1.5mm 1.1mm; }
    td { padding:1.35mm 1.1mm; }
    .cards { gap:2.5mm; margin:3mm 0 4mm; }
    .card { padding:3mm 2.5mm; }
    .value { font-size:14pt; }
    li { margin-bottom:1.2mm; }
  }
</style>
</head>
<body>
<section class="page">
  <div class="hero">
    <div class="eyebrow">Обращение продавца в поддержку Wildberries</div>
    <h1>Некорректные статусы и начисления по FBS-поставке</h1>
    <div>Поставка WB-GI-246883602 · короб WB-MP-43346319</div>
  </div>

  <h2>Суть обращения</h2>
  <p class="lead">Короб был передан для отправки и отсканирован при приёмке. При приезде курьер WB не смог отсканировать QR короба и не забрал его. Впоследствии короб со всеми девятью товарами был возвращён нам на склад. Физическая перевозка поставки WB не выполнялась.</p>

  <p>Несмотря на это, WB закрыл поставку, присвоил всем заданиям статус продавца <strong>complete</strong>, сформировал дальнейшие статусы и отразил расходы на обработку, логистику и перевозочно-складские операции.</p>

  <div class="facts">
    <div class="fact"><span>Поставка создана</span><strong>15.06.2026, 15:52 МСК</strong></div>
    <div class="fact"><span>Поставка закрыта WB</span><strong>15.06.2026, 16:48 МСК</strong></div>
    <div class="fact"><span>Признак завершения</span><strong>done = true</strong></div>
    <div class="fact"><span>Время сканирования WB</span><strong>scanDt = null</strong></div>
    <div class="fact"><span>Заданий</span><strong>9, все supplierStatus = complete</strong></div>
    <div class="fact"><span>Текущие статусы</span><strong>5 отменены, 2 отсортированы, 2 готовы к выдаче</strong></div>
  </div>

  <div class="box warn">
    WB не передал timestamp сканирования короба. Дата 15.06 в строке «Обработка товара» является датой финансовой операции, а не подтверждённым временем физической приёмки.
  </div>

  <h2>Что просим</h2>
  <ol>
    <li>Предоставить журнал сканирования QR короба и всех девяти заданий, включая неудачную попытку сканирования курьером.</li>
    <li>Объяснить, на основании каких событий задания получили статусы complete, sorted и ready_for_pickup.</li>
    <li>Обосновать каждую начисленную услугу, указанную в расчёте на следующей странице.</li>
    <li>Если физическое перемещение не подтверждается, отменить необоснованные начисления <strong>857,89 ₽</strong> и вернуть удержанные средства.</li>
    <li>Исправить некорректные статусы заданий и предоставить ответ отдельно по каждому assembly_id/srid.</li>
  </ol>

  <div class="box good">
    Привязка проверена по точному номеру сборочного задания <strong>assembly_id</strong> и уникальному <strong>srid</strong>. Расчёт не основан на совпадении артикулов, цен или дат.
  </div>
  <div class="footer"><span>Обращение в поддержку WB</span><span>1 / 3</span></div>
</section>

<section class="page">
  <h2>Расчёт по каждому заданию</h2>
  <table>
    <thead>
      <tr>
        <th>Стикер / assembly_id / srid</th>
        <th>Статус</th>
        <th>Строки отчёта WB</th>
        <th>Расчёт</th>
        <th>Спорная сумма</th>
      </tr>
    </thead>
    <tbody>
      ${orders.map((o) => `
      <tr>
        <td><strong>${o.sticker}</strong><br>${o.assembly}<br>nm ${o.nm}<span class="srid">${o.srid}</span></td>
        <td>${o.status}<br><span class="srid">supplier: complete</span></td>
        <td>${o.events}</td>
        <td class="nowrap">${o.calculation}</td>
        <td class="nowrap"><strong>${o.disputed}</strong></td>
      </tr>`).join("")}
      <tr class="total">
        <td colspan="3">Итого по девяти заданиям</td>
        <td>135 + 714,64 + 8,25</td>
        <td class="nowrap">857,89 ₽</td>
      </tr>
    </tbody>
  </table>

  <div class="box">
    <strong>Формула:</strong> обработка 9 × 15 ₽ = 135 ₽; логистика по пяти отменённым заданиям = 714,64 ₽; перевозочно-складские издержки по двум заданиям = 3,99 + 4,26 = 8,25 ₽. Общая спорная сумма: <strong>857,89 ₽</strong>.
  </div>

  <div class="box warn">
    Отдельно в отчётах присутствует сервисное поле 2,60 ₽ по каждому заданию, всего 23,40 ₽. Оно не включено в требование 857,89 ₽, поскольку WB должен разъяснить его назначение и влияние на взаиморасчёты.
  </div>
  <div class="footer"><span>Построчный расчёт</span><span>2 / 3</span></div>
</section>

<section class="page">
  <h2>Контрольные итоги и требуемый ответ</h2>
  <div class="cards">
    <div class="card"><div class="value">135 ₽</div><div class="label">обработка</div></div>
    <div class="card"><div class="value">714,64 ₽</div><div class="label">логистика</div></div>
    <div class="card"><div class="value">8,25 ₽</div><div class="label">перевозочно-складские издержки</div></div>
    <div class="card"><div class="value">857,89 ₽</div><div class="label">общая спорная сумма</div></div>
  </div>

  <h3>Прочие поля отчёта</h3>
  <table>
    <tbody>
      <tr><td>Штраф продавцу, penalty</td><td><strong>0 ₽</strong></td></tr>
      <tr><td>Удержания, deduction</td><td><strong>0 ₽</strong></td></tr>
      <tr><td>Хранение, storage</td><td><strong>0 ₽</strong></td></tr>
      <tr><td>Эквайринг, acquiring</td><td><strong>0 ₽</strong></td></tr>
      <tr><td>Продажа / выплата продавцу</td><td><strong>0 ₽ / 0 ₽</strong></td></tr>
      <tr><td>Отдельное сервисное поле, не включённое в требование</td><td><strong>23,40 ₽</strong></td></tr>
    </tbody>
  </table>

  <h2>Просим дать конкретный ответ</h2>
  <ol>
    <li>Указать дату, время, место и идентификатор каждого сканирования.</li>
    <li>Предоставить последовательность изменения статусов каждого задания.</li>
    <li>Подтвердить документами фактическую перевозку, на основании которой начислено 714,64 ₽.</li>
    <li>Объяснить две перевозочно-складские строки на 3,99 ₽ и 4,26 ₽.</li>
    <li>Пояснить назначение отдельного сервисного поля 23,40 ₽.</li>
    <li>При отсутствии подтверждения перевозки вернуть 857,89 ₽ и скорректировать статусы.</li>
  </ol>

  <div class="box warn">
    Просим не ограничиваться общим описанием правил FBS. Нужен ответ по каждому указанному sticker, assembly_id и srid с приложением журналов событий.
  </div>

  <div class="sign"><div>Дата обращения</div><div>Продавец / подпись</div></div>
  <div class="footer"><span>Требования к WB</span><span>3 / 3</span></div>
</section>
</body>
</html>`;

await fs.writeFile(htmlPath, html, "utf8");

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
} finally {
  await browser.close();
}

console.log(pdfPath);
