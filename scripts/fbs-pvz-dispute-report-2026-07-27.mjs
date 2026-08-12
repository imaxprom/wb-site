import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const htmlPath = path.join(root, "fbs-pvz-dispute-report-2026-07-27.html");
const pdfPath = path.join(root, "fbs-pvz-dispute-report-2026-07-27.pdf");

const rows = [
  {
    sticker: "8736064100",
    order: "5191621364",
    created: "14.06.2026 15:54",
    article: "163785912",
    sellerArticle: "ST8187-MC-7",
    item: "Трусы стринги, набор 7 шт.",
    size: "201–203",
    sheet: "383 ₽",
    wb: "383 ₽",
    status: "Отменён клиентом",
    statusClass: "cancel",
    acceptance: "15 ₽",
    logistics: "137,74 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "42372457536",
    order: "5193132093",
    created: "14.06.2026 21:39",
    article: "333768796",
    sellerArticle: "SL-8369*6605-MC-9-3",
    item: "Трусы слипы, набор 9 шт.",
    size: "44–46",
    sheet: "1 195 ₽",
    wb: "1 195 ₽",
    status: "Отсортирован",
    statusClass: "sorted",
    acceptance: "15 ₽",
    logistics: "0 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "41988544570",
    order: "5192899150",
    created: "14.06.2026 20:44",
    article: "163785912",
    sellerArticle: "ST8187-MC-7",
    item: "Трусы стринги, набор 7 шт.",
    size: "201–203",
    sheet: "385 ₽",
    wb: "385 ₽",
    status: "Отменён клиентом",
    statusClass: "cancel",
    acceptance: "15 ₽",
    logistics: "137,74 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "8736035008",
    order: "5191603204",
    created: "14.06.2026 15:50",
    article: "333768800",
    sellerArticle: "SL-8369*6605-MC-9-7",
    item: "Трусы слипы, набор 9 шт.",
    size: "40–42",
    sheet: "1 381 ₽",
    wb: "1 328,09 ₽*",
    status: "Отменён клиентом",
    statusClass: "cancel",
    acceptance: "15 ₽",
    logistics: "198,82 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "42372457542",
    order: "5193132095",
    created: "14.06.2026 21:39",
    article: "333768796",
    sellerArticle: "SL-8369*6605-MC-9-3",
    item: "Трусы слипы, набор 9 шт.",
    size: "46–48",
    sheet: "1 195 ₽",
    wb: "1 195 ₽",
    status: "Отсортирован",
    statusClass: "sorted",
    acceptance: "15 ₽",
    logistics: "0 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "42372476115",
    order: "5193150781",
    created: "14.06.2026 21:43",
    article: "163785912",
    sellerArticle: "ST8187-MC-7",
    item: "Трусы стринги, набор 7 шт.",
    size: "201–203",
    sheet: "433 ₽",
    wb: "429,38 ₽*",
    status: "Готов к выдаче",
    statusClass: "ready",
    acceptance: "15 ₽",
    logistics: "0 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "55152939218",
    order: "5195877198",
    created: "15.06.2026 14:12",
    article: "333768800",
    sellerArticle: "SL-8369*6605-MC-9-7",
    item: "Трусы слипы, набор 9 шт.",
    size: "50–52",
    sheet: "1 380 ₽",
    wb: "1 380 ₽",
    status: "Готов к выдаче",
    statusClass: "ready",
    acceptance: "15 ₽",
    logistics: "0 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "55147690850",
    order: "5196019065",
    created: "15.06.2026 14:44",
    article: "163785912",
    sellerArticle: "ST8187-MC-7",
    item: "Трусы стринги, набор 7 шт.",
    size: "201–203",
    sheet: "379 ₽",
    wb: "379 ₽",
    status: "Отменён клиентом",
    statusClass: "cancel",
    acceptance: "15 ₽",
    logistics: "137,62 ₽",
    reimbursement: "2,60 ₽",
  },
  {
    sticker: "55146923467",
    order: "5195167194",
    created: "15.06.2026 11:21",
    article: "163785912",
    sellerArticle: "ST8187-MC-7",
    item: "Трусы стринги, набор 7 шт.",
    size: "201–203",
    sheet: "385 ₽",
    wb: "385 ₽",
    status: "Отменён клиентом",
    statusClass: "cancel",
    acceptance: "15 ₽",
    logistics: "102,72 ₽",
    reimbursement: "2,60 ₽",
  },
];

const identityRows = [
  { sticker: "8736064100", order: "5191621364", srid: "eI.rc9a40cbd99d9474f91626f55f545c2ea.0.0", logistics: "91,18 + 46,56 = 137,74 ₽" },
  { sticker: "42372457536", order: "5193132093", srid: "ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.5.0", logistics: "—" },
  { sticker: "41988544570", order: "5192899150", srid: "eAp.ia08766e1722bffcc48ec03c92c6d9776.0.0", logistics: "91,18 + 46,56 = 137,74 ₽" },
  { sticker: "8736035008", order: "5191603204", srid: "eZ.r21a8e780accc4340a7209bfb31b9fd2b.0.0", logistics: "131,82 + 67,00 = 198,82 ₽" },
  { sticker: "42372457542", order: "5193132095", srid: "ebi.rfffb8917a78d4517b3e22e2c7c9cafc3.4.0", logistics: "—" },
  { sticker: "42372476115", order: "5193150781", srid: "eBK.re9642a3fad3a4301ae6188ab66f6df96.0.0", logistics: "—" },
  { sticker: "55152939218", order: "5195877198", srid: "eAZ.r9a85df8a2169486daa8ddc84db92c63e.0.0", logistics: "—" },
  { sticker: "55147690850", order: "5196019065", srid: "ebr.if4c1afc797d0a5bfbc00df9a87a5a24f.0.0", logistics: "91,06 + 46,56 = 137,62 ₽" },
  { sticker: "55146923467", order: "5195167194", srid: "eA1.r0ac6e8e5859d48d28baeccf52bb7aa2d.0.0", logistics: "56,16 + 46,56 = 102,72 ₽" },
];

const auditRows = [
  { sticker: "8736064100", created: "14.06 15:54", status: "Отменён клиентом", events: "15.06 — обработка 15 ₽; 26.06 — к клиенту 91,18 ₽ и от клиента 46,56 ₽, Подольск МП (office 215304); отчёт 06–12.07 — поле ПВЗ 2,60 ₽." },
  { sticker: "42372457536", created: "14.06 21:39", status: "Отсортирован", events: "15.06 — обработка 15 ₽; отчёт 06–12.07 — поле ПВЗ 2,60 ₽. Логистических строк нет." },
  { sticker: "41988544570", created: "14.06 20:44", status: "Отменён клиентом", events: "15.06 — обработка 15 ₽; 29.06 — к клиенту 91,18 ₽ и от клиента 46,56 ₽, Подольск МП (office 50008217); отчёт 06–12.07 — поле ПВЗ 2,60 ₽." },
  { sticker: "8736035008", created: "14.06 15:50", status: "Отменён клиентом", events: "15.06 — обработка 15 ₽; 27.06 — к клиенту 131,82 ₽ и от клиента 67 ₽, Подольск МП (office 305262); отчёт 06–12.07 — поле ПВЗ 2,60 ₽." },
  { sticker: "42372457542", created: "14.06 21:39", status: "Отсортирован", events: "15.06 — обработка 15 ₽; отчёт 06–12.07 — поле ПВЗ 2,60 ₽. Логистических строк нет." },
  { sticker: "42372476115", created: "14.06 21:43", status: "Готов к выдаче", events: "15.06 — обработка 15 ₽; отчёт 06–12.07 — поле ПВЗ 2,60 ₽; отчёт 20–26.07 — возмещение издержек по перевозке/складским операциям 3,99 ₽." },
  { sticker: "55152939218", created: "15.06 14:12", status: "Готов к выдаче", events: "15.06 — обработка 15 ₽; отчёт 06–12.07 — поле ПВЗ 2,60 ₽; отчёт 20–26.07 — возмещение издержек по перевозке/складским операциям 4,26 ₽." },
  { sticker: "55147690850", created: "15.06 14:44", status: "Отменён клиентом", events: "15.06 — обработка 15 ₽; 18.07 — к клиенту 91,06 ₽ и от клиента 46,56 ₽, Подольск МП (office 141738); отчёт 06–12.07 — поле ПВЗ 2,60 ₽." },
  { sticker: "55146923467", created: "15.06 11:21", status: "Отменён клиентом", events: "15.06 — обработка 15 ₽; 23.07 — к клиенту 56,16 ₽ и от клиента 46,56 ₽, Рязань (Тюшевское), office 50005751; отчёт 06–12.07 — поле ПВЗ 2,60 ₽." },
];

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Пояснение по FBS-поставке и коробу 43346319</title>
<style>
  :root {
    --ink: #172033;
    --muted: #657084;
    --navy: #14284b;
    --blue: #2368c4;
    --pale: #f3f6fa;
    --line: #dce3ec;
    --good: #147a55;
    --good-bg: #e8f6f0;
    --warn: #a96013;
    --warn-bg: #fff4e6;
    --cancel: #9a3c47;
    --cancel-bg: #fff0f2;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    background: #edf1f6;
    color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    font-size: 10.1pt;
    line-height: 1.47;
  }
  @page { size: A4; margin: 13mm 12mm 14mm; }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 10mm;
    padding: 13mm 12mm 14mm;
    background: white;
    position: relative;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }
  @media print {
    body { background: white; }
    .page {
      width: auto;
      min-height: 270mm;
      margin: 0;
      padding: 0;
    }
    body { font-size: 8.4pt; line-height: 1.35; }
    .hero { padding: 13mm 14mm 9mm; margin-bottom: 6mm; }
    .eyebrow { font-size: 7pt; margin-bottom: 3mm; }
    h1 { font-size: 20pt; margin-bottom: 3mm; }
    .subtitle { font-size: 9.5pt; }
    h2 { font-size: 13.5pt; margin-bottom: 3.5mm; }
    h3 { font-size: 10pt; margin: 3.5mm 0 1.5mm; }
    p { margin-bottom: 2.5mm; }
    .lead { font-size: 9.4pt; line-height: 1.4; }
    .grid { gap: 2.5mm; margin: 3.5mm 0; }
    .card { padding: 3mm; }
    .card .value { font-size: 15pt; margin-bottom: 1.3mm; }
    .card .label { font-size: 7.4pt; }
    .box { padding: 3mm 4mm; margin: 3.5mm 0; }
    .facts { gap: 1.3mm 7mm; margin: 3mm 0; }
    .fact { padding-bottom: 1.3mm; }
    .fact span { font-size: 7.1pt; }
    table { margin: 2mm 0 3.5mm; font-size: 6.2pt; line-height: 1.2; }
    th { padding: 1.5mm 1.1mm; }
    td { padding: 1.35mm 1.1mm; }
    .tag { font-size: 6pt; padding: .7mm 1.2mm; }
    .small { font-size: 7.1pt; }
    ul, ol { margin: 1.5mm 0 3mm; }
    li { margin-bottom: 1.25mm; }
    .letter { padding: 4.5mm; font-size: 8.7pt; }
    .letter p { margin-bottom: 2.2mm; }
    .signature { margin-top: 6mm; }
    .audit-page table { font-size: 5.7pt; }
    .audit-page td { padding: 1mm 1.05mm; }
    .audit-page th { padding: 1.2mm 1.05mm; }
    .audit-page li { margin-bottom: .9mm; }
    .audit-page .box { margin: 2.5mm 0; padding: 2.5mm 4mm; }
  }
  .hero {
    margin: -13mm -12mm 10mm;
    padding: 18mm 16mm 13mm;
    color: white;
    background: linear-gradient(135deg, #102142, #1d4c88);
  }
  .eyebrow {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: .12em;
    opacity: .75;
    margin-bottom: 5mm;
  }
  h1 { font-size: 25pt; line-height: 1.08; margin: 0 0 5mm; max-width: 160mm; }
  .subtitle { font-size: 11.5pt; max-width: 165mm; opacity: .88; }
  h2 { font-size: 16pt; color: var(--navy); margin: 0 0 5mm; line-height: 1.2; }
  h3 { font-size: 11.5pt; color: var(--navy); margin: 5mm 0 2.5mm; }
  p { margin: 0 0 3.5mm; }
  .lead { font-size: 11.4pt; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.5mm; margin: 5mm 0; }
  .card {
    border: 1px solid var(--line);
    border-radius: 3mm;
    padding: 4mm;
    background: var(--pale);
    break-inside: avoid;
  }
  .card .value { font-size: 18pt; line-height: 1; font-weight: 750; color: var(--navy); margin-bottom: 2mm; }
  .card .label { color: var(--muted); font-size: 8.5pt; }
  .box {
    border-left: 3.5px solid var(--blue);
    background: #eef5ff;
    padding: 4mm 5mm;
    margin: 5mm 0;
    border-radius: 0 2mm 2mm 0;
  }
  .box.warning { border-left-color: var(--warn); background: var(--warn-bg); }
  .box.conclusion { border-left-color: var(--good); background: var(--good-bg); }
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2mm 8mm;
    margin: 4mm 0;
  }
  .fact { padding-bottom: 2mm; border-bottom: 1px solid var(--line); }
  .fact span { display: block; color: var(--muted); font-size: 8pt; }
  .fact strong { display: block; margin-top: .7mm; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 3mm 0 5mm;
    font-size: 7.25pt;
    line-height: 1.28;
  }
  th {
    text-align: left;
    padding: 2.1mm 1.4mm;
    color: white;
    background: var(--navy);
    font-weight: 650;
  }
  td { padding: 2mm 1.4mm; border-bottom: 1px solid var(--line); vertical-align: top; }
  tbody tr:nth-child(even) { background: #f7f9fc; }
  .nowrap { white-space: nowrap; }
  .item { max-width: 39mm; }
  .tag {
    display: inline-block;
    padding: 1mm 1.6mm;
    border-radius: 999px;
    font-weight: 650;
    white-space: nowrap;
    font-size: 6.9pt;
  }
  .tag.cancel { color: var(--cancel); background: var(--cancel-bg); }
  .tag.sorted { color: var(--warn); background: var(--warn-bg); }
  .tag.ready { color: var(--good); background: var(--good-bg); }
  .small { font-size: 8.3pt; color: var(--muted); }
  ul, ol { margin: 2mm 0 4mm; padding-left: 5.5mm; }
  li { margin-bottom: 1.8mm; }
  .letter {
    border: 1px solid var(--line);
    border-radius: 3mm;
    padding: 6mm;
    background: #fafbfd;
    font-size: 10.2pt;
  }
  .letter p { margin-bottom: 3mm; }
  .source { overflow-wrap: anywhere; }
  .footer {
    position: absolute;
    left: 12mm;
    right: 12mm;
    bottom: 5mm;
    display: flex;
    justify-content: space-between;
    color: #8993a3;
    font-size: 7pt;
  }
  .signature {
    margin-top: 9mm;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15mm;
  }
  .signature div { border-top: 1px solid #8993a3; padding-top: 1.5mm; color: var(--muted); font-size: 8pt; }
</style>
</head>
<body>
  <section class="page">
    <div class="hero">
      <div class="eyebrow">Аналитическая сверка · FBS Wildberries</div>
      <h1>Пояснение по поставке и коробу 43346319</h1>
      <div class="subtitle">Сверка рукописного списка, WB Marketplace API и финансовых отчётов продавца</div>
    </div>

    <p class="lead"><strong>Основной вывод.</strong> По данным WB поставка закрыта и переведена в доставку, а все девять заданий получили статус продавца <strong>complete</strong>. На дату проверки пять заказов отменены клиентами, два отсортированы и два готовы к выдаче. По каждому заказу отражена обработка, а по всем пяти отменённым заказам — логистические операции.</p>

    <div class="box conclusion">
      Совокупность этих признаков подтверждает, что задания были зарегистрированы и обрабатывались в логистическом контуре WB. Статусы «отсортирован» и «готов к выдаче» у четырёх заказов, а также начисленная логистика по всем пяти отменённым заказам <strong>не согласуются с версией, что вся коробка целиком не была передана или принята системой WB</strong>.
    </div>

    <div class="grid">
      <div class="card"><div class="value">9</div><div class="label">заданий в поставке; все найдены по стикерам</div></div>
      <div class="card"><div class="value">complete</div><div class="label">статус продавца у всех девяти заданий</div></div>
      <div class="card"><div class="value">15.06</div><div class="label">поставка закрыта 15 июня 2026 года</div></div>
    </div>

    <h2>Идентификация поставки</h2>
    <div class="facts">
      <div class="fact"><span>Поставка WB</span><strong>WB-GI-246883602</strong></div>
      <div class="fact"><span>Название</span><strong>Поставка от 15.06.2026</strong></div>
      <div class="fact"><span>Короб</span><strong>WB-MP-43346319</strong></div>
      <div class="fact"><span>QR короба</span><strong>$WBMP:1:1166225:43346319</strong></div>
      <div class="fact"><span>Создана</span><strong>15.06.2026, 15:52 МСК</strong></div>
      <div class="fact"><span>Закрыта</span><strong>15.06.2026, 16:48 МСК</strong></div>
      <div class="fact"><span>Признак завершения</span><strong>done = true</strong></div>
      <div class="fact"><span>Отказ от поставки</span><strong>не зафиксирован</strong></div>
    </div>

    <div class="box warning">
      <strong>Что нельзя утверждать без данных WB/PВЗ.</strong> В карточке поставки поле <strong>scanDt</strong> не заполнено. Поэтому текущая выгрузка не доказывает точное время и терминал сканирования QR короба и не позволяет определить виновника штрафа. Для этого необходимы акт начисления и журналы сканирования WB.
    </div>

    <h3>Почему девять заказов отнесены к коробу</h3>
    <p>В поставке ровно девять заданий и ровно один короб — 43346319. Следовательно, эти девять заданий составляют содержимое единственного короба. В актуальном методе WB список коробов возвращается без массива заказов: это официально изменено в API, поэтому пустой массив <strong>orders</strong> в ответе по коробу не означает, что короб был пуст.</p>

    <p class="small">Дата и время проверки: 27.07.2026, Москва. Данные отражают состояние систем на момент запроса и могут позднее измениться.</p>
    <div class="footer"><span>Пояснение по FBS-поставке</span><span>1 / 6</span></div>
  </section>

  <section class="page">
    <h2>Сверка всех стикеров и заказов</h2>
    <p>Все девять номеров с листа найдены. Первый номер уточнён по полям <strong>partA + partB</strong> ответа WB: верный стикер — <strong>8736064100</strong>.</p>
    <table>
      <thead>
        <tr>
          <th>Стикер / ID заказа</th>
          <th>Товар</th>
          <th>Цена: лист / WB</th>
          <th>Текущий статус WB</th>
          <th>Обработка</th>
          <th>Логистика</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
        <tr>
          <td class="nowrap"><strong>${r.sticker}</strong><br><span class="small">${r.order}<br>${r.created}</span></td>
          <td class="item"><strong>${r.article}</strong><br>${r.item}<br><span class="small">${r.sellerArticle}<br>размер ${r.size}</span></td>
          <td class="nowrap">${r.sheet}<br><strong>${r.wb}</strong></td>
          <td><span class="tag ${r.statusClass}">${r.status}</span><br><span class="small">supplier: complete</span></td>
          <td class="nowrap">${r.acceptance}</td>
          <td class="nowrap">${r.logistics}</td>
        </tr>`).join("")}
      </tbody>
    </table>

    <div class="box">
      <strong>Разница в двух ценах.</strong> Заказы 8736035008 и 42372476115 оформлены в BYN. В таблице показана рублёвая конвертация WB на момент заказа: 1 328,09 ₽ и 429,38 ₽. На листе указаны 1 381 ₽ и 433 ₽. По остальным семи заказам цены совпадают.
    </div>

    <h3>Распределение текущих статусов</h3>
    <div class="grid">
      <div class="card"><div class="value">5</div><div class="label">canceled_by_client — отменены клиентами, не продавцом</div></div>
      <div class="card"><div class="value">2</div><div class="label">sorted — прошли до этапа сортировки</div></div>
      <div class="card"><div class="value">2</div><div class="label">ready_for_pickup — готовы к выдаче покупателю</div></div>
    </div>

    <p><strong>Значение complete.</strong> В модели статусов FBS это статус продавца, означающий передачу заказа в доставку. Текущий статус WB показывает последующий этап движения заказа. Поэтому отмена клиентом не равна отмене или непередаче заказа продавцом.</p>
    <div class="footer"><span>Полная сверка стикеров</span><span>2 / 6</span></div>
  </section>

  <section class="page">
    <h2>Контроль идентификаторов: sticker → assembly_id → srid</h2>
    <p class="lead">Финансовые строки привязаны не по артикулу, цене или дате. Для каждого задания использованы точный номер стикера, номер сборочного задания WB и уникальный <strong>srid</strong> из исходного отчёта.</p>

    <table>
      <thead>
        <tr><th>Стикер</th><th>Номер сборочного задания<br>assembly_id</th><th>Уникальный srid</th><th>Строки логистики</th></tr>
      </thead>
      <tbody>
        ${identityRows.map((r) => `
        <tr>
          <td><strong>${r.sticker}</strong></td>
          <td>${r.order}</td>
          <td style="overflow-wrap:anywhere">${r.srid}</td>
          <td>${r.logistics}</td>
        </tr>`).join("")}
      </tbody>
    </table>

    <div class="box conclusion">
      <strong>Проверка уникальности в production-БД.</strong> У каждого из девяти <strong>srid</strong> найден ровно один assembly_id. Каждый из девяти стикеров также связан ровно с одним assembly_id и одним srid. Посторонних заданий или неоднозначных совпадений нет.
    </div>

    <h3>Как восстановлена цепочка</h3>
    <ol>
      <li>WB Marketplace API вернул стикер по полям <strong>partA + partB</strong> и ID сборочного задания.</li>
      <li>В исходном Excel-отчёте WB поле «Номер сборочного задания» равно этому же ID; в базе оно хранится как <strong>assembly_id</strong>.</li>
      <li>В той же строке отчёта указан <strong>Srid</strong>. Все последующие финансовые строки по заданию сохраняют тот же assembly_id и тот же srid, даже если поле «Стикер МП» в поздней строке пустое.</li>
      <li>Суммы рассчитаны только внутри каждой такой пары assembly_id + srid, без соединения по артикулу, баркоду, цене или дате.</li>
    </ol>

    <h3>Проверка полноты источника</h3>
    <p>Использованные отчёты WB за периоды 15.06–26.07.2026 загружены полностью: число строк в таблице совпадает с контрольным числом строк каждого отчёта. Последний отчёт за 20–26 июля загружен 27.07.2026 в 10:12 МСК; именно в нём появилась логистика 102,72 ₽ по заданию 5195167194.</p>

    <div class="box warning">
      <strong>Граница доказательства.</strong> Такая привязка однозначно доказывает, что WB отнёс финансовые операции именно к этим заданиям. Она сама по себе не доказывает физическое сканирование именно спорным ПВЗ: в строках нет идентификатора этого ПВЗ, а поле поставки scanDt не заполнено.
    </div>
    <div class="footer"><span>Аудит уникальных идентификаторов</span><span>3 / 6</span></div>
  </section>

  <section class="page audit-page">
    <h2>Построчная хронология, которую передал WB</h2>
    <div class="box warning">
      <strong>Сканирование и физическая приёмка.</strong> Для поставки WB передал <strong>scanDt = null</strong>. Отдельного времени сканирования короба сотрудником ПВЗ и времени неудачной попытки курьера в доступных данных нет. Дата 15.06 в строке «Обработка товара» — бухгалтерская дата операции, а не подтверждённый timestamp физического сканирования.
    </div>

    <table>
      <thead>
        <tr><th>Стикер</th><th>Создано, МСК</th><th>Статус WB</th><th>Операции и даты из еженедельных отчётов</th></tr>
      </thead>
      <tbody>
        ${auditRows.map((r) => `
        <tr>
          <td><strong>${r.sticker}</strong></td>
          <td class="nowrap">${r.created}</td>
          <td>${r.status}<br><span class="small">supplier: complete</span></td>
          <td>${r.events}</td>
        </tr>`).join("")}
      </tbody>
    </table>

    <h3>Общие данные поставки</h3>
    <ul>
      <li>Поставка создана 15.06.2026 в 15:52 МСК, закрыта системой 15.06.2026 в 16:48 МСК; <strong>done = true</strong>.</li>
      <li>Отказ от поставки в API не зафиксирован: rejectDt и rejectReason пустые.</li>
      <li>По фактическому пояснению продавца короб был принят сотрудником ПВЗ, но курьер не смог отсканировать QR и не забрал его; затем короб вернули продавцу на склад.</li>
      <li>Эта фактическая последовательность отсутствует в доступной выгрузке WB и должна быть проверена по внутреннему журналу сканирований.</li>
    </ul>

    <div class="box conclusion">
      <strong>Расхождение для проверки WB:</strong> при подтверждённом возврате физического короба продавцу система показывает дальнейшие статусы, логистические направления «Подольск МП» и «Рязань (Тюшевское)», а также услуги «к клиенту» и «от клиента».
    </div>
    <div class="footer"><span>Построчные события WB</span><span>4 / 6</span></div>
  </section>

  <section class="page">
    <h2>Финансовые и логистические признаки</h2>
    <p class="lead">В еженедельных финансовых данных продавца обнаружены операции по каждому из девяти заказов.</p>

    <div class="grid">
      <div class="card"><div class="value">135 ₽</div><div class="label">«Обработка товара»: поле приёмки, 9 × 15 ₽</div></div>
      <div class="card"><div class="value">714,64 ₽</div><div class="label">логистические операции по 5 заказам</div></div>
      <div class="card"><div class="value">23,40 ₽</div><div class="label">поле отчёта о выдаче/возврате на ПВЗ: 9 × 2,60 ₽</div></div>
    </div>

    <table>
      <thead>
        <tr><th>Стикер</th><th>Статус</th><th>Обработка</th><th>Логистика</th><th>Поле ПВЗ</th><th>Возмещение издержек</th></tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
        <tr>
          <td><strong>${r.sticker}</strong></td>
          <td>${r.status}</td>
          <td>${r.acceptance}</td>
          <td>${r.logistics}</td>
          <td>${r.reimbursement}</td>
          <td>${r.sticker === "42372476115" ? "3,99 ₽" : r.sticker === "55152939218" ? "4,26 ₽" : "0 ₽"}</td>
        </tr>`).join("")}
        <tr>
          <td colspan="2"><strong>Итого</strong></td>
          <td><strong>135 ₽</strong></td>
          <td><strong>714,64 ₽</strong></td>
          <td><strong>23,40 ₽</strong></td>
          <td><strong>8,25 ₽</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="box conclusion">
      <strong>Интерпретация.</strong> Строки «Обработка товара» по всем заданиям и логистика по всем отменённым заказам являются финансовыми следами, которые WB связал с конкретными assembly_id и srid. Дополнительно по двум заданиям отражено 8,25 ₽ «возмещения издержек по перевозке/складским операциям». Поле 2,60 ₽ называется в отчёте «Возмещение за выдачу и возврат товаров на ПВЗ», но оно не доказывает выплату именно спорному ПВЗ.
    </div>

    <h3>Что это доказывает</h3>
    <ul>
      <li>Все номера с листа существуют в WB и привязаны к одной завершённой FBS-поставке.</li>
      <li>Все задания перешли со стороны продавца в состояние <strong>complete</strong>.</li>
      <li>Как минимум четыре заказа дошли до текущих этапов «отсортирован» или «готов к выдаче».</li>
      <li>По всем пяти отменённым клиентами заказам WB отразил логистические операции.</li>
      <li>В данных продавца нет признака отмены этих заказов продавцом.</li>
    </ul>

    <h3>Чего это не доказывает</h3>
    <ul>
      <li>Не устанавливает конкретного сотрудника или ПВЗ, выполнившего каждое сканирование.</li>
      <li>Не раскрывает причину и правомерность штрафа ПВЗ — уведомление о штрафе нам не предоставлено.</li>
      <li>Не заменяет внутренний журнал событий WB, акт расхождений или видеозапись приёмки.</li>
    </ul>

    <div class="box warning">
      <strong>Формальные удержания.</strong> По всем девяти заданиям поля penalty, deduction, storage и acquiring равны 0 ₽; продажа, retail_amount и выплата продавцу также равны 0 ₽. Суммы 135 ₽, 714,64 ₽, 23,40 ₽ и 8,25 ₽ — разные поля отчёта, их нельзя автоматически складывать в сумму штрафа или ущерба.
    </div>
    <div class="footer"><span>Финансовые признаки</span><span>5 / 6</span></div>
  </section>

  <section class="page">
    <h2>Готовое обращение в поддержку WB</h2>
    <div class="letter">
      <p>Просим проверить FBS-поставку <strong>WB-GI-246883602</strong>, короб <strong>WB-MP-43346319</strong>. Наш сотрудник передал короб на ПВЗ, сотрудник ПВЗ отсканировал и принял его. При приезде курьер WB не смог отсканировать штрихкод короба и поэтому короб не забрал. Впоследствии короб со всеми товарами был возвращён нам на склад; получение подтверждаем. Физическая перевозка этой поставки WB не выполнялась.</p>

      <p>Несмотря на это, система закрыла поставку 15.06.2026 в 16:48 МСК, всем девяти заданиям присвоен supplierStatus <strong>complete</strong>; пять заказов позднее отмечены как отменённые клиентами, два — «отсортирован», два — «готов к выдаче». У поставки поле <strong>scanDt = null</strong>, то есть доступный API не содержит времени сканирования короба.</p>

      <p>В финансовых отчётах по точным assembly_id и srid отражены: обработка 135 ₽, логистика по пяти заданиям 714,64 ₽ и возмещение издержек по перевозке/складским операциям 8,25 ₽. Дополнительно по каждому заданию присутствует поле «Возмещение за выдачу и возврат товаров на ПВЗ» 2,60 ₽, всего 23,40 ₽. При этом фактического перемещения товаров не было.</p>

      <p>Просим объяснить, на основании каких событий и сканирований сформированы статусы и услуги, предоставить журнал приёмки и попытки передачи курьеру, а также отдельно обосновать каждую финансовую строку. Просим проверить правомерность штрафа ПВЗ в размере <strong>[указать сумму]</strong> и исправить статусы и начисления, если они сформированы ошибочно.</p>
    </div>

    <h2 style="margin-top:8mm">Что запросить у WB для разрешения спора</h2>
    <ol>
      <li>Полный акт или уведомление о штрафе: сумма, основание, код нарушения и привязка к каждому стикеру.</li>
      <li>Журнал сканирования QR короба <strong>$WBMP:1:1166225:43346319</strong>: время, ПВЗ, терминал и пользователь.</li>
      <li>Журнал неудачной попытки сканирования короба курьером и причину отказа в заборе.</li>
      <li>Историю переходов статусов и индивидуальных сканирований всех девяти заданий.</li>
      <li>Обоснование логистики, обработки, возмещения издержек и штрафа по каждому assembly_id/srid.</li>
    </ol>

    <h3>Источники и методика</h3>
    <p class="small">WB Marketplace API: поставка, короб, задания, стикеры и текущие статусы; производственная база продавца: еженедельные финансовые операции. Официальное описание FBS API: <span class="source">https://dev.wildberries.ru/openapi/orders-fbs/</span>. Изменение ответа метода коробов: <span class="source">https://dev.wildberries.ru/release-notes?id=214</span>.</p>
    <p class="small">Документ является аналитическим пояснением по доступным данным, а не юридическим заключением. Окончательное установление причин штрафа возможно только после получения первичных документов и журналов WB.</p>

    <div class="signature">
      <div>Дата передачи пояснения</div>
      <div>Подпись / ФИО</div>
    </div>
    <div class="footer"><span>Обращение в поддержку WB</span><span>6 / 6</span></div>
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
  await page.emulateMediaType("screen");
  const sections = await page.$$(".page");
  for (let index = 0; index < sections.length; index += 1) {
    await sections[index].screenshot({
      path: `/private/tmp/fbs-pvz-report-page-${index + 1}.png`,
    });
  }
} finally {
  await browser.close();
}

console.log(pdfPath);
