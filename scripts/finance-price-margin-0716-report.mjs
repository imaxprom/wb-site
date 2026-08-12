import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const SOURCE_JSON = path.join(ROOT, "finance-realization-analysis-2026-07-16.json");
const OUT_PDF = path.join(ROOT, "finance-price-margin-analysis-2026-07-16.pdf");
const OUT_HTML = path.join(ROOT, "finance-price-margin-analysis-2026-07-16.html");
const BASE_DAYS = 6;

const report = JSON.parse(fs.readFileSync(SOURCE_JSON, "utf8"));

const n = (v) => Number(v) || 0;
const div = (a, b) => (Math.abs(n(b)) > 0.000001 ? n(a) / n(b) : 0);
const rub = (v) => `${Math.round(n(v)).toLocaleString("ru-RU")} ₽`;
const one = (v) => n(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const qty = (v) => Math.round(n(v)).toLocaleString("ru-RU");
const pct = (v) => `${n(v).toFixed(1).replace(".", ",")}%`;
const pp = (v) => `${n(v).toFixed(1).replace(".", ",")} п.п.`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const cls = (v) => n(v) >= 0 ? "pos" : "neg";

const beforeByNm = new Map(report.before.articles.map((row) => [row.nm_id, row]));
const afterRows = report.after.articles
  .map((after) => {
    const before = beforeByNm.get(after.nm_id) || null;
    const beforeDailyQty = before ? before.net_qty / BASE_DAYS : 0;
    const beforeDailyRevenue = before ? before.revenue / BASE_DAYS : 0;
    const beforeDailyProfit = before ? before.profit / BASE_DAYS : 0;
    return {
      nm_id: after.nm_id,
      article: after.article || after.wb_article_name || "",
      before,
      after,
      beforeDailyQty,
      beforeDailyRevenue,
      beforeDailyProfit,
      qtyDelta: after.net_qty - beforeDailyQty,
      qtyDeltaPct: beforeDailyQty ? (after.net_qty / beforeDailyQty - 1) * 100 : null,
      avgPriceDelta: before ? after.avg_price - before.avg_price : null,
      avgPriceDeltaPct: before?.avg_price ? (after.avg_price / before.avg_price - 1) * 100 : null,
      revenueDelta: after.revenue - beforeDailyRevenue,
      revenueDeltaPct: beforeDailyRevenue ? (after.revenue / beforeDailyRevenue - 1) * 100 : null,
      commissionDeltaPp: before ? after.commission_rate - before.commission_rate : null,
      marginDeltaPp: before ? after.margin - before.margin : null,
      profitDelta: after.profit - beforeDailyProfit,
      profitDeltaPct: beforeDailyProfit ? (after.profit / beforeDailyProfit - 1) * 100 : null,
    };
  })
  .sort((a, b) => b.after.revenue - a.after.revenue);

const before = report.before.totals;
const after = report.after.totals;
const beforeDaily = {
  net_qty: before.net_qty / BASE_DAYS,
  revenue: before.revenue / BASE_DAYS,
  profit: before.profit / BASE_DAYS,
  commission: before.commission / BASE_DAYS,
  logistics: before.logistics / BASE_DAYS,
  ad_spend: before.ad_spend / BASE_DAYS,
  cogs: before.cogs / BASE_DAYS,
};

function metric(title, value, sub = "") {
  return `<div class="card"><div class="label">${esc(title)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function changeCell(value, suffix = "", digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return `<td class="muted">нет базы</td>`;
  const shown = suffix === "%" ? pct(value) : suffix === "п.п." ? pp(value) : suffix === "₽" ? rub(value) : one(value);
  return `<td class="${cls(value)}">${shown}</td>`;
}

const topMoved = [...afterRows]
  .filter((r) => r.before && Number.isFinite(r.avgPriceDeltaPct))
  .sort((a, b) => Math.abs(b.avgPriceDeltaPct) - Math.abs(a.avgPriceDeltaPct))
  .slice(0, 8);

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Цена и маржинальность: до 07.07 vs 16.07</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #1f2937; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    h2 { margin: 18px 0 8px; font-size: 15px; color: #111827; }
    p { margin: 0 0 7px; line-height: 1.35; }
    .header { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 10px; border-bottom: 2px solid #111827; margin-bottom: 10px; }
    .muted { color: #667085; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 12px; }
    .card { border: 1px solid #d0d5dd; border-radius: 8px; padding: 8px 9px; background: #f8fafc; min-height: 64px; }
    .label { font-size: 9.5px; color: #667085; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-size: 17px; color: #111827; font-weight: 700; margin-top: 3px; }
    .sub { font-size: 9.5px; color: #667085; margin-top: 2px; }
    .note { background: #eff6ff; border-left: 4px solid #2563eb; padding: 8px 10px; font-size: 11px; line-height: 1.35; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.7px; }
    th { background: #111827; color: white; border: 1px solid #111827; padding: 4px 3px; text-align: right; }
    th.text, td.text { text-align: left; }
    td { border: 1px solid #e4e7ec; padding: 3.5px 3px; text-align: right; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .pos { color: #087443; font-weight: 700; }
    .neg { color: #b42318; font-weight: 700; }
    .tiny { font-size: 7.8px; color: #667085; line-height: 1.18; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
    .page-break { break-before: page; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Цена и маржинальность: до повышения vs 16.07.2026</h1>
      <div class="muted">База до повышения: 01.07–06.07.2026. День после повышения цен и комиссии: 16.07.2026.</div>
    </div>
    <div class="muted" style="text-align:right">
      MpHub · отчёт реализации WB<br/>
      ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК
    </div>
  </div>

  <div class="grid">
    ${metric("Средняя цена до 07.07", rub(before.avg_price), `по ${qty(before.net_qty)} выкупленным шт.`)}
    ${metric("Средняя цена 16.07", rub(after.avg_price), `<span class="${cls(after.avg_price - before.avg_price)}">${rub(after.avg_price - before.avg_price)} / ${pct((after.avg_price / before.avg_price - 1) * 100)}</span>`)}
    ${metric("Продажи до, средний день", `${qty(beforeDaily.net_qty)} шт`, rub(beforeDaily.revenue))}
    ${metric("Продажи 16.07", `${qty(after.net_qty)} шт`, `${rub(after.revenue)} · ${pct((after.net_qty / beforeDaily.net_qty - 1) * 100)} к среднему дню`)}
    ${metric("Комиссия до", pct(before.commission_rate), rub(before.commission))}
    ${metric("Комиссия 16.07", pct(after.commission_rate), `${pp(after.commission_rate - before.commission_rate)} к базе`)}
    ${metric("Маржа до", pct(before.margin), `прибыль ${rub(before.profit)}`)}
    ${metric("Маржа 16.07", pct(after.margin), `<span class="${cls(after.margin - before.margin)}">${pp(after.margin - before.margin)}</span> · прибыль ${rub(after.profit)}`)}
  </div>

  <div class="two">
    <div>
      <h2>Что изменилось на уровне магазина</h2>
      <p>До повышения средняя цена по реализованной единице была <b>${rub(before.avg_price)}</b>. За 16.07 средняя цена стала <b>${rub(after.avg_price)}</b>, то есть выше на <b>${rub(after.avg_price - before.avg_price)}</b> или <b>${pct((after.avg_price / before.avg_price - 1) * 100)}</b>.</p>
      <p>Количество выкупленных единиц на 16.07: <b>${qty(after.net_qty)} шт.</b> против среднего дня до повышения <b>${qty(beforeDaily.net_qty)} шт.</b>. Изменение: <b class="${cls(after.net_qty - beforeDaily.net_qty)}">${qty(after.net_qty - beforeDaily.net_qty)} шт. / ${pct((after.net_qty / beforeDaily.net_qty - 1) * 100)}</b>.</p>
      <p>Комиссия выросла с <b>${pct(before.commission_rate)}</b> до <b>${pct(after.commission_rate)}</b>. Несмотря на рост средней цены, маржа снизилась с <b>${pct(before.margin)}</b> до <b>${pct(after.margin)}</b>.</p>
    </div>
    <div class="note">
      <b>Как читать отчёт.</b> Для периода до повышения показаны фактические totals за 01–06.07 и средний день. Для 16.07 показан один фактический день. По артикулам сравниваются средняя цена, выручка, комиссия, расходы, прибыль/шт и маржа. Это не модель старой комиссии, а прямое сравнение факта до повышения и факта после повышения цены/комиссии.
    </div>
  </div>

  <h2>Сводная таблица магазина</h2>
  <table>
    <thead>
      <tr>
        <th class="text">Показатель</th>
        <th>01–06.07<br/>итого</th>
        <th>01–06.07<br/>средний день</th>
        <th>16.07<br/>факт</th>
        <th>Изменение 16.07<br/>к среднему дню</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="text">Выкуплено, шт.</td><td>${qty(before.net_qty)}</td><td>${qty(beforeDaily.net_qty)}</td><td>${qty(after.net_qty)}</td><td class="${cls(after.net_qty - beforeDaily.net_qty)}">${qty(after.net_qty - beforeDaily.net_qty)} / ${pct((after.net_qty / beforeDaily.net_qty - 1) * 100)}</td></tr>
      <tr><td class="text">Средняя цена/шт.</td><td>${rub(before.avg_price)}</td><td>${rub(before.avg_price)}</td><td>${rub(after.avg_price)}</td><td class="${cls(after.avg_price - before.avg_price)}">${rub(after.avg_price - before.avg_price)} / ${pct((after.avg_price / before.avg_price - 1) * 100)}</td></tr>
      <tr><td class="text">Реализация</td><td>${rub(before.revenue)}</td><td>${rub(beforeDaily.revenue)}</td><td>${rub(after.revenue)}</td><td class="${cls(after.revenue - beforeDaily.revenue)}">${rub(after.revenue - beforeDaily.revenue)} / ${pct((after.revenue / beforeDaily.revenue - 1) * 100)}</td></tr>
      <tr><td class="text">Комиссия WB</td><td>${rub(before.commission)} (${pct(before.commission_rate)})</td><td>${rub(beforeDaily.commission)}</td><td>${rub(after.commission)} (${pct(after.commission_rate)})</td><td class="neg">${pp(after.commission_rate - before.commission_rate)}</td></tr>
      <tr><td class="text">Логистика</td><td>${rub(before.logistics)} (${pct(before.logistics_rate)})</td><td>${rub(beforeDaily.logistics)}</td><td>${rub(after.logistics)} (${pct(after.logistics_rate)})</td><td class="${cls(after.logistics - beforeDaily.logistics)}">${rub(after.logistics - beforeDaily.logistics)}</td></tr>
      <tr><td class="text">Реклама</td><td>${rub(before.ad_spend)} (${pct(before.ad_rate)})</td><td>${rub(beforeDaily.ad_spend)}</td><td>${rub(after.ad_spend)} (${pct(after.ad_rate)})</td><td class="${cls(after.ad_spend - beforeDaily.ad_spend)}">${rub(after.ad_spend - beforeDaily.ad_spend)}</td></tr>
      <tr><td class="text">Себестоимость</td><td>${rub(before.cogs)}</td><td>${rub(beforeDaily.cogs)}</td><td>${rub(after.cogs)}</td><td class="${cls(after.cogs - beforeDaily.cogs)}">${rub(after.cogs - beforeDaily.cogs)}</td></tr>
      <tr><td class="text">Прибыль</td><td>${rub(before.profit)} (${pct(before.margin)})</td><td>${rub(beforeDaily.profit)}</td><td>${rub(after.profit)} (${pct(after.margin)})</td><td class="${cls(after.profit - beforeDaily.profit)}">${rub(after.profit - beforeDaily.profit)} / ${pct((after.profit / beforeDaily.profit - 1) * 100)}</td></tr>
    </tbody>
  </table>

  <div class="two">
    <div>
      <h2>Самые заметные изменения средней цены</h2>
      <table>
        <thead><tr><th class="text">Артикул</th><th>Цена до</th><th>Цена 16.07</th><th>Изм.</th><th>Маржа до</th><th>Маржа 16.07</th></tr></thead>
        <tbody>
          ${topMoved.map((r) => `<tr>
            <td class="text"><b>${r.nm_id}</b><div class="tiny">${esc(r.article).slice(0, 52)}</div></td>
            <td>${rub(r.before.avg_price)}</td>
            <td>${rub(r.after.avg_price)}</td>
            ${changeCell(r.avgPriceDeltaPct, "%")}
            <td>${pct(r.before.margin)}</td>
            <td class="${cls(r.after.margin)}">${pct(r.after.margin)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div>
      <h2>Расходы 16.07 от реализации</h2>
      <table>
        <tbody>
          <tr><td class="text">Комиссия WB</td><td>${rub(after.commission)}</td><td>${pct(after.commission_rate)}</td></tr>
          <tr><td class="text">Логистика</td><td>${rub(after.logistics)}</td><td>${pct(after.logistics_rate)}</td></tr>
          <tr><td class="text">Реклама</td><td>${rub(after.ad_spend)}</td><td>${pct(after.ad_rate)}</td></tr>
          <tr><td class="text">Себестоимость</td><td>${rub(after.cogs)}</td><td>${pct(div(after.cogs, after.revenue) * 100)}</td></tr>
          <tr><td class="text">Налоги</td><td>${rub(after.tax)}</td><td>${pct(div(after.tax, after.revenue) * 100)}</td></tr>
          <tr><td class="text">Хранение/штрафы/прочее</td><td>${rub(after.other)}</td><td>${pct(div(after.other, after.revenue) * 100)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="page-break"></div>
  <h2>Артикулы: цена, продажи, комиссия и маржа</h2>
  <table>
    <thead>
      <tr>
        <th class="text" style="width:17%">Артикул</th>
        <th>Шт./день<br/>до</th>
        <th>Шт.<br/>16.07</th>
        <th>Цена<br/>до</th>
        <th>Цена<br/>16.07</th>
        <th>Изм.<br/>цены</th>
        <th>Выручка/день<br/>до</th>
        <th>Выручка<br/>16.07</th>
        <th>Комиссия<br/>до</th>
        <th>Комиссия<br/>16.07</th>
        <th>Себест./шт<br/>до / 16.07</th>
        <th>Логист./шт<br/>до / 16.07</th>
        <th>Приб./шт<br/>до / 16.07</th>
        <th>Маржа<br/>до</th>
        <th>Маржа<br/>16.07</th>
        <th>Изм.<br/>маржи</th>
      </tr>
    </thead>
    <tbody>
      ${afterRows.map((r) => {
        const b = r.before;
        return `<tr>
          <td class="text"><b>${r.nm_id}</b><div class="tiny">${esc(r.article).slice(0, 76)}</div></td>
          <td>${b ? one(r.beforeDailyQty) : "нет"}</td>
          <td>${qty(r.after.net_qty)}</td>
          <td>${b ? rub(b.avg_price) : "нет"}</td>
          <td>${rub(r.after.avg_price)}</td>
          ${changeCell(r.avgPriceDeltaPct, "%")}
          <td>${b ? rub(r.beforeDailyRevenue) : "нет"}</td>
          <td>${rub(r.after.revenue)}</td>
          <td>${b ? pct(b.commission_rate) : "нет"}</td>
          <td>${pct(r.after.commission_rate)}</td>
          <td>${b ? `${rub(b.cogs_unit)} / ${rub(r.after.cogs_unit)}` : `нет / ${rub(r.after.cogs_unit)}`}</td>
          <td>${b ? `${rub(div(b.logistics, b.net_qty))} / ${rub(div(r.after.logistics, r.after.net_qty))}` : `нет / ${rub(div(r.after.logistics, r.after.net_qty))}`}</td>
          <td>${b ? `${rub(b.profit_unit)} / ${rub(r.after.profit_unit)}` : `нет / ${rub(r.after.profit_unit)}`}</td>
          <td>${b ? pct(b.margin) : "нет"}</td>
          <td class="${cls(r.after.margin)}">${pct(r.after.margin)}</td>
          ${changeCell(r.marginDeltaPp, "п.п.")}
        </tr>`;
      }).join("")}
    </tbody>
  </table>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html);
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: OUT_PDF,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
  });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  pdf: OUT_PDF,
  html: OUT_HTML,
  totals: {
    beforeAvgPrice: before.avg_price,
    afterAvgPrice: after.avg_price,
    beforeAvgDailyQty: beforeDaily.net_qty,
    afterQty: after.net_qty,
    beforeMargin: before.margin,
    afterMargin: after.margin,
    beforeCommissionRate: before.commission_rate,
    afterCommissionRate: after.commission_rate,
    articles: afterRows.length,
  },
}, null, 2));
