import fs from "fs";
import path from "path";
import process from "process";
import { Pool } from "pg";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const REPORT_DATE = "2026-07-16";
const BASE_FROM = "2026-07-01";
const BASE_TO = "2026-07-06";
const OUT_PDF = path.join(ROOT, "finance-realization-analysis-2026-07-16.pdf");
const OUT_HTML = path.join(ROOT, "finance-realization-analysis-2026-07-16.html");
const OUT_JSON = path.join(ROOT, "finance-realization-analysis-2026-07-16.json");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    let value = line.slice(idx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...readEnvFile(path.join(ROOT, ".env.local")), ...process.env };
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });

const n = (v) => Number(v) || 0;
const rub = (v) => `${Math.round(n(v)).toLocaleString("ru-RU")} ₽`;
const qty = (v) => Math.round(n(v)).toLocaleString("ru-RU");
const pct = (v, digits = 1) => `${n(v).toFixed(digits).replace(".", ",")}%`;
const pp = (v, digits = 1) => `${n(v).toFixed(digits).replace(".", ",")} п.п.`;
const safeDiv = (a, b) => (Math.abs(n(b)) > 0.000001 ? n(a) / n(b) : 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function cogsCostSql(alias, dateColumn) {
  return `COALESCE((
    SELECT h.cost FROM cogs_history h
    WHERE h.barcode = ${alias}.barcode
      AND h.valid_from <= ${alias}.${dateColumn}
      AND (h.valid_to IS NULL OR h.valid_to >= ${alias}.${dateColumn})
    ORDER BY h.valid_from DESC
    LIMIT 1
  ), 0)`;
}

async function rows(sql, params = []) {
  const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${++rows.param}`), params);
  return res.rows;
}
rows.param = 0;

async function q(sql, params = []) {
  rows.param = 0;
  return rows(sql, params);
}

async function periodMetrics(from, to) {
  const saleRows = await q(`
    SELECT
      r.nm_id::bigint AS nm_id,
      COALESCE((ARRAY_REMOVE(ARRAY_AGG(NULLIF(r.sa_name, '') ORDER BY r.sale_dt DESC), NULL))[1], '') AS article,
      COALESCE((ARRAY_REMOVE(ARRAY_AGG(NULLIF(r.brand_name, '') ORDER BY r.sale_dt DESC), NULL))[1], '') AS brand,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.quantity ELSE 0 END) AS sales_qty,
      SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.quantity ELSE 0 END) AS returns_qty,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.retail_price_withdisc_rub ELSE 0 END) AS sales_rpwd,
      SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.retail_price_withdisc_rub ELSE 0 END) AS returns_rpwd,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.retail_amount ELSE 0 END) AS sales_retail_amount,
      SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.retail_amount ELSE 0 END) AS returns_retail_amount,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.ppvz_for_pay ELSE 0 END) AS sales_ppvz,
      SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.ppvz_for_pay ELSE 0 END) AS returns_ppvz,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.quantity * ${cogsCostSql("r", "sale_dt")} ELSE 0 END) AS cogs_sales,
      SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.quantity * ${cogsCostSql("r", "sale_dt")} ELSE 0 END) AS cogs_returns
    FROM realization r
    WHERE r.supplier_oper_name IN ('Продажа','Возврат')
      AND r.sale_dt >= ? AND r.sale_dt <= ?
      AND r.nm_id > 0
    GROUP BY r.nm_id
  `, [from, to]);

  const commissionRows = await q(`
    SELECT r.nm_id::bigint AS nm_id,
      SUM(CASE WHEN r.supplier_oper_name='Продажа' THEN r.retail_price_withdisc_rub - r.ppvz_for_pay ELSE 0 END)
      - SUM(CASE WHEN r.supplier_oper_name='Возврат' THEN r.retail_price_withdisc_rub - r.ppvz_for_pay ELSE 0 END) AS commission
    FROM realization r
    WHERE r.supplier_oper_name IN ('Продажа','Возврат')
      AND r.rr_dt >= ? AND r.rr_dt <= ?
      AND r.nm_id > 0
    GROUP BY r.nm_id
  `, [from, to]);

  const svcRows = await q(`
    SELECT r.nm_id::bigint AS nm_id,
      SUM(CASE WHEN r.supplier_oper_name IN ('Логистика','Коррекция логистики') THEN r.delivery_rub ELSE 0 END) AS logistics,
      SUM(r.storage_fee) AS storage,
      SUM(r.penalty) AS penalty,
      SUM(r.acceptance) AS acceptance,
      SUM(r.rebill_logistic_cost) AS rebill
    FROM realization r
    WHERE r.rr_dt >= ? AND r.rr_dt <= ?
      AND r.nm_id > 0
    GROUP BY r.nm_id
  `, [from, to]);

  const adRows = await q(`
    SELECT nm_id::bigint AS nm_id, SUM(amount) AS ad_spend
    FROM advertising
    WHERE date >= ? AND date <= ? AND nm_id > 0
    GROUP BY nm_id
  `, [from, to]);

  const names = await q(`
    SELECT DISTINCT ON (r.nm_id) r.nm_id::bigint AS nm_id, r.sa_name AS article, r.brand_name AS brand
    FROM realization r
    WHERE r.nm_id > 0 AND r.supplier_oper_name='Продажа'
    ORDER BY r.nm_id, r.sale_dt DESC
  `);

  const products = await q(`
    SELECT article_wb, name
    FROM shipment_products
  `);

  const custom = await q(`
    SELECT article_wb, MAX(NULLIF(custom_name, '')) AS custom_name
    FROM product_overrides
    GROUP BY article_wb
  `);

  const map = new Map();
  for (const row of names) {
    map.set(String(row.nm_id), { nm_id: Number(row.nm_id), article: row.article || "", brand: row.brand || "" });
  }
  for (const row of saleRows) {
    const key = String(row.nm_id);
    map.set(key, { ...(map.get(key) || {}), ...row, nm_id: Number(row.nm_id) });
  }
  for (const row of commissionRows) {
    const key = String(row.nm_id);
    map.set(key, { ...(map.get(key) || { nm_id: Number(row.nm_id) }), commission: n(row.commission) });
  }
  for (const row of svcRows) {
    const key = String(row.nm_id);
    map.set(key, { ...(map.get(key) || { nm_id: Number(row.nm_id) }), ...row });
  }
  for (const row of adRows) {
    const key = String(row.nm_id);
    map.set(key, { ...(map.get(key) || { nm_id: Number(row.nm_id) }), ad_spend: n(row.ad_spend) });
  }
  const productMap = new Map(products.map((r) => [String(r.article_wb), r.name || ""]));
  const customMap = new Map(custom.map((r) => [String(r.article_wb), r.custom_name || ""]));

  const articles = [...map.values()].map((r) => {
    const revenue = n(r.sales_rpwd) - n(r.returns_rpwd);
    const retailAmount = n(r.sales_retail_amount) - n(r.returns_retail_amount);
    const ppvz = n(r.sales_ppvz) - n(r.returns_ppvz);
    const netQty = n(r.sales_qty) - n(r.returns_qty);
    const cogs = n(r.cogs_sales) - n(r.cogs_returns);
    const commission = n(r.commission);
    const logistics = n(r.logistics);
    const storage = n(r.storage);
    const penalty = n(r.penalty);
    const acceptance = n(r.acceptance);
    const rebill = n(r.rebill);
    const adSpend = n(r.ad_spend);
    const nds = ppvz * 5 / 105;
    const usn = (ppvz - nds) * 0.01;
    const tax = nds + usn;
    const other = storage + penalty + acceptance + rebill;
    const profit = revenue - commission - logistics - other - adSpend - cogs - tax;
    const nmId = Number(r.nm_id);
    const customName = customMap.get(String(nmId)) || "";
    const productName = productMap.get(String(nmId)) || "";
    const article = customName || productName || r.article || "";
    return {
      nm_id: nmId,
      article,
      wb_article_name: r.article || "",
      brand: r.brand || "",
      sales_qty: n(r.sales_qty),
      returns_qty: n(r.returns_qty),
      net_qty: netQty,
      revenue,
      retail_amount: retailAmount,
      ppvz,
      cogs,
      commission,
      logistics,
      storage,
      penalty,
      acceptance,
      rebill,
      other,
      ad_spend: adSpend,
      tax,
      profit,
      avg_price: safeDiv(revenue, netQty),
      cogs_unit: safeDiv(cogs, netQty),
      commission_rate: safeDiv(commission, revenue) * 100,
      logistics_rate: safeDiv(logistics, revenue) * 100,
      ad_rate: safeDiv(adSpend, revenue) * 100,
      margin: safeDiv(profit, revenue) * 100,
      profit_unit: safeDiv(profit, netQty),
    };
  }).filter((r) => Math.abs(r.revenue) > 0.01 || Math.abs(r.commission) > 0.01 || Math.abs(r.profit) > 0.01);

  const totals = articles.reduce((s, r) => {
    for (const k of ["sales_qty", "returns_qty", "net_qty", "revenue", "retail_amount", "ppvz", "cogs", "commission", "logistics", "storage", "penalty", "acceptance", "rebill", "other", "ad_spend", "tax", "profit"]) {
      s[k] = n(s[k]) + n(r[k]);
    }
    return s;
  }, {});
  totals.avg_price = safeDiv(totals.revenue, totals.net_qty);
  totals.cogs_unit = safeDiv(totals.cogs, totals.net_qty);
  totals.commission_rate = safeDiv(totals.commission, totals.revenue) * 100;
  totals.logistics_rate = safeDiv(totals.logistics, totals.revenue) * 100;
  totals.ad_rate = safeDiv(totals.ad_spend, totals.revenue) * 100;
  totals.margin = safeDiv(totals.profit, totals.revenue) * 100;
  totals.profit_unit = safeDiv(totals.profit, totals.net_qty);
  return { articles, totals };
}

function enrich(after, before) {
  const beforeByNm = new Map(before.articles.map((r) => [r.nm_id, r]));
  const storeBeforeRate = before.totals.commission_rate;
  const result = after.articles.map((r) => {
    const b = beforeByNm.get(r.nm_id);
    const beforeRate = b && b.revenue > 0 ? b.commission_rate : storeBeforeRate;
    const oldCommission = r.revenue * beforeRate / 100;
    const extraCommission = r.commission - oldCommission;
    const profitAtOldCommission = r.profit + extraCommission;
    const marginAtOldCommission = safeDiv(profitAtOldCommission, r.revenue) * 100;
    const beforeMargin = b && b.revenue > 0 ? b.margin : null;
    return {
      ...r,
      before_revenue: b?.revenue || 0,
      before_commission_rate: beforeRate,
      before_margin: beforeMargin,
      old_commission: oldCommission,
      extra_commission: extraCommission,
      profit_at_old_commission: profitAtOldCommission,
      margin_at_old_commission: marginAtOldCommission,
      margin_delta_vs_old_commission: r.margin - marginAtOldCommission,
      margin_delta_vs_before: beforeMargin === null ? null : r.margin - beforeMargin,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const totals = after.totals;
  const oldCommission = totals.revenue * before.totals.commission_rate / 100;
  const extraCommission = totals.commission - oldCommission;
  const profitAtOldCommission = totals.profit + extraCommission;
  return {
    articles: result,
    totals: {
      ...totals,
      before_commission_rate: before.totals.commission_rate,
      before_margin: before.totals.margin,
      old_commission: oldCommission,
      extra_commission: extraCommission,
      profit_at_old_commission: profitAtOldCommission,
      margin_at_old_commission: safeDiv(profitAtOldCommission, totals.revenue) * 100,
      margin_delta_vs_old_commission: totals.margin - safeDiv(profitAtOldCommission, totals.revenue) * 100,
      margin_delta_vs_before: totals.margin - before.totals.margin,
    },
  };
}

function metricCard(title, value, sub = "") {
  return `<div class="card"><div class="label">${esc(title)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

function buildHtml(report) {
  const { before, after, enriched } = report;
  const topArticles = enriched.articles.slice(0, 12);
  const total = enriched.totals;
  const maxRevenue = Math.max(...topArticles.map((r) => r.revenue), 1);
  const totalServices = n(total.commission) + n(total.logistics) + n(total.other) + n(total.ad_spend);
  const beforeDailyProfit = before.totals.profit / 6;
  const beforeDailyRevenue = before.totals.revenue / 6;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Аналитика отчёта реализации за 16.07.2026</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; background: #fff; }
    h1 { font-size: 23px; margin: 0 0 6px; }
    h2 { font-size: 15px; margin: 18px 0 8px; color: #111827; }
    h3 { font-size: 12px; margin: 10px 0 6px; color: #111827; }
    p { margin: 0 0 8px; line-height: 1.38; }
    .muted { color: #667085; }
    .header { border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; gap: 18px; }
    .header small { display:block; color:#667085; margin-top:2px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 12px; }
    .card { border: 1px solid #d9dee8; border-radius: 8px; padding: 9px 10px; background: #f8fafc; min-height: 66px; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #667085; }
    .value { font-size: 18px; font-weight: 700; color: #111827; margin-top: 3px; }
    .sub { font-size: 10px; color: #667085; margin-top: 2px; }
    .summary { display: grid; grid-template-columns: 1.2fr .8fr; gap: 12px; align-items: start; }
    .note { border-left: 4px solid #2563eb; background: #eff6ff; padding: 8px 10px; font-size: 11px; line-height: 1.35; }
    .warn { border-left-color: #d97706; background: #fffbeb; }
    table { width: 100%; border-collapse: collapse; font-size: 9.2px; table-layout: fixed; }
    th { background: #111827; color: white; font-weight: 600; padding: 5px 4px; border: 1px solid #111827; text-align: right; }
    th.text, td.text { text-align: left; }
    td { padding: 4px 4px; border: 1px solid #e4e7ec; text-align: right; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .pos { color: #087443; font-weight: 700; }
    .neg { color: #b42318; font-weight: 700; }
    .tiny { font-size: 8px; color: #667085; line-height: 1.2; }
    .barwrap { height: 9px; background: #eef2f7; border-radius: 99px; overflow: hidden; margin-top: 2px; }
    .bar { height: 100%; background: #2563eb; border-radius: 99px; }
    .page-break { break-before: page; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .footer { margin-top: 10px; font-size: 9px; color: #667085; }
    .nowrap { white-space: nowrap; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Аналитика отчёта реализации за 16.07.2026</h1>
      <div class="muted">Сравнение факта после повышения комиссии с базой до повышения: 01.07–06.07.2026</div>
    </div>
    <div class="muted" style="text-align:right">
      MpHub · production PostgreSQL<br/>
      <small>Сформировано: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК</small>
    </div>
  </div>

  <div class="grid">
    ${metricCard("Реализация 16.07", rub(total.revenue), `продано ${qty(total.sales_qty)} / возвраты ${qty(total.returns_qty)}`)}
    ${metricCard("Комиссия WB 16.07", rub(total.commission), `${pct(total.commission_rate)} от реализации`)}
    ${metricCard("Опер. прибыль 16.07", rub(total.profit), `маржа ${pct(total.margin)}`)}
    ${metricCard("Эффект комиссии", rub(total.extra_commission), `${pp(total.commission_rate - total.before_commission_rate)} к базе`)}
    ${metricCard("Комиссия до повышения", pct(before.totals.commission_rate), `база 01–06.07, реализация ${rub(before.totals.revenue)}`)}
    ${metricCard("Комиссия после", pct(total.commission_rate), `факт 16.07`)}
    ${metricCard("Маржа до повышения", pct(before.totals.margin), `среднедневная прибыль ${rub(beforeDailyProfit)}`)}
    ${metricCard("Маржа 16.07", pct(total.margin), `изменение ${pp(total.margin_delta_vs_before)}`)}
  </div>

  <div class="summary">
    <div>
      <h2>Ключевой вывод</h2>
      <p>Фактическая ставка комиссии WB за 16.07 составила <b>${pct(total.commission_rate)}</b> против <b>${pct(before.totals.commission_rate)}</b> в базе до повышения. Рост составил <b>${pp(total.commission_rate - before.totals.commission_rate)}</b>.</p>
      <p>На обороте 16.07 это дало примерно <b>${rub(total.extra_commission)}</b> дополнительной комиссии. Без повышения комиссии прибыль дня была бы около <b>${rub(total.profit_at_old_commission)}</b>, фактически получилось <b>${rub(total.profit)}</b>.</p>
      <p>Чисто из-за новой комиссии маржинальность дня ниже примерно на <b>${pp(Math.abs(total.margin_delta_vs_old_commission))}</b>. Общая маржа относительно периода до повышения изменилась на <b>${pp(total.margin_delta_vs_before)}</b>, потому что кроме комиссии влияли логистика, реклама, себестоимость и структура продаж.</p>
    </div>
    <div class="note">
      <b>Методика.</b> Продажи, возвраты, выручка, PPVZ и себестоимость взяты по <b>sale_dt</b>. Комиссия WB, логистика, хранение, штрафы и прочие удержания взяты по <b>rr_dt</b>, как в текущей логике раздела «Финансы по дням». НДС 5% и УСН 1% рассчитаны от PPVZ по действующей формуле проекта.
    </div>
  </div>

  <h2>Сводка до/после</h2>
  <table>
    <thead>
      <tr>
        <th class="text">Показатель</th>
        <th>До повышения<br/>01–06.07</th>
        <th>До повышения<br/>в день</th>
        <th>После<br/>16.07</th>
        <th>Изменение<br/>к средн. дню</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="text">Реализация</td><td>${rub(before.totals.revenue)}</td><td>${rub(beforeDailyRevenue)}</td><td>${rub(total.revenue)}</td><td>${rub(total.revenue - beforeDailyRevenue)}</td></tr>
      <tr><td class="text">Комиссия WB</td><td>${rub(before.totals.commission)} (${pct(before.totals.commission_rate)})</td><td>${rub(before.totals.commission / 6)}</td><td>${rub(total.commission)} (${pct(total.commission_rate)})</td><td>${rub(total.commission - before.totals.commission / 6)}</td></tr>
      <tr><td class="text">Логистика</td><td>${rub(before.totals.logistics)} (${pct(before.totals.logistics_rate)})</td><td>${rub(before.totals.logistics / 6)}</td><td>${rub(total.logistics)} (${pct(total.logistics_rate)})</td><td>${rub(total.logistics - before.totals.logistics / 6)}</td></tr>
      <tr><td class="text">Реклама</td><td>${rub(before.totals.ad_spend)} (${pct(before.totals.ad_rate)})</td><td>${rub(before.totals.ad_spend / 6)}</td><td>${rub(total.ad_spend)} (${pct(total.ad_rate)})</td><td>${rub(total.ad_spend - before.totals.ad_spend / 6)}</td></tr>
      <tr><td class="text">Себестоимость</td><td>${rub(before.totals.cogs)}</td><td>${rub(before.totals.cogs / 6)}</td><td>${rub(total.cogs)}</td><td>${rub(total.cogs - before.totals.cogs / 6)}</td></tr>
      <tr><td class="text">Налоги</td><td>${rub(before.totals.tax)}</td><td>${rub(before.totals.tax / 6)}</td><td>${rub(total.tax)}</td><td>${rub(total.tax - before.totals.tax / 6)}</td></tr>
      <tr><td class="text">Операционная прибыль</td><td>${rub(before.totals.profit)} (${pct(before.totals.margin)})</td><td>${rub(beforeDailyProfit)}</td><td>${rub(total.profit)} (${pct(total.margin)})</td><td>${rub(total.profit - beforeDailyProfit)}</td></tr>
    </tbody>
  </table>

  <div class="two-col">
    <div>
      <h2>Топ артикулов по обороту 16.07</h2>
      <table>
        <thead><tr><th class="text">Артикул</th><th>Реализация</th><th>Комиссия</th><th>Маржа</th></tr></thead>
        <tbody>
          ${topArticles.map((r) => `<tr>
            <td class="text"><b>${r.nm_id}</b><div class="tiny">${esc(r.article).slice(0, 52)}</div><div class="barwrap"><div class="bar" style="width:${Math.max(3, Math.round(r.revenue / maxRevenue * 100))}%"></div></div></td>
            <td>${rub(r.revenue)}</td>
            <td>${pct(r.commission_rate)}</td>
            <td class="${r.margin >= 0 ? "pos" : "neg"}">${pct(r.margin)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div>
      <h2>Структура расходов 16.07</h2>
      <table>
        <tbody>
          <tr><td class="text">Комиссия WB</td><td>${rub(total.commission)}</td><td>${pct(safeDiv(total.commission, total.revenue) * 100)}</td></tr>
          <tr><td class="text">Логистика</td><td>${rub(total.logistics)}</td><td>${pct(safeDiv(total.logistics, total.revenue) * 100)}</td></tr>
          <tr><td class="text">Хранение/штрафы/прочее</td><td>${rub(total.other)}</td><td>${pct(safeDiv(total.other, total.revenue) * 100)}</td></tr>
          <tr><td class="text">Реклама</td><td>${rub(total.ad_spend)}</td><td>${pct(safeDiv(total.ad_spend, total.revenue) * 100)}</td></tr>
          <tr><td class="text">Себестоимость</td><td>${rub(total.cogs)}</td><td>${pct(safeDiv(total.cogs, total.revenue) * 100)}</td></tr>
          <tr><td class="text">Налоги</td><td>${rub(total.tax)}</td><td>${pct(safeDiv(total.tax, total.revenue) * 100)}</td></tr>
          <tr><td class="text"><b>Все расходы</b></td><td><b>${rub(totalServices + total.cogs + total.tax)}</b></td><td><b>${pct(safeDiv(totalServices + total.cogs + total.tax, total.revenue) * 100)}</b></td></tr>
        </tbody>
      </table>
      <div class="note warn" style="margin-top:10px">Дополнительная комиссия рассчитана как разница между фактической комиссией 16.07 и комиссией, которая была бы при старой ставке периода 01–06.07.</div>
    </div>
  </div>

  <div class="page-break"></div>
  <h2>Артикулы: эффект повышения комиссии на 16.07</h2>
  <table>
    <thead>
      <tr>
        <th class="text" style="width:18%">Артикул</th>
        <th>Шт.</th>
        <th>Реализация</th>
        <th>Комиссия<br/>до</th>
        <th>Комиссия<br/>16.07</th>
        <th>Доп.<br/>комиссия</th>
        <th>Прибыль<br/>при старой</th>
        <th>Прибыль<br/>факт</th>
        <th>Маржа<br/>при старой</th>
        <th>Маржа<br/>факт</th>
        <th>Изм.<br/>маржи</th>
      </tr>
    </thead>
    <tbody>
      ${enriched.articles.map((r) => `<tr>
        <td class="text"><b>${r.nm_id}</b><div class="tiny">${esc(r.article).slice(0, 80)}</div></td>
        <td>${qty(r.net_qty)}</td>
        <td>${rub(r.revenue)}</td>
        <td>${pct(r.before_commission_rate)}</td>
        <td>${pct(r.commission_rate)}</td>
        <td class="${r.extra_commission >= 0 ? "neg" : "pos"}">${rub(r.extra_commission)}</td>
        <td>${rub(r.profit_at_old_commission)}</td>
        <td class="${r.profit >= 0 ? "pos" : "neg"}">${rub(r.profit)}</td>
        <td>${pct(r.margin_at_old_commission)}</td>
        <td class="${r.margin >= 0 ? "pos" : "neg"}">${pct(r.margin)}</td>
        <td class="${r.margin_delta_vs_old_commission >= 0 ? "pos" : "neg"}">${pp(r.margin_delta_vs_old_commission)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <div class="footer">
    Файл данных: ${esc(path.basename(OUT_JSON))}. Расчёт не меняет БД и не использует прогнозные сценарии комиссии.
  </div>
</body>
</html>`;
}

async function main() {
  const before = await periodMetrics(BASE_FROM, BASE_TO);
  const after = await periodMetrics(REPORT_DATE, REPORT_DATE);
  const enriched = enrich(after, before);
  const report = { reportDate: REPORT_DATE, baseFrom: BASE_FROM, baseTo: BASE_TO, before, after, enriched };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  const html = buildHtml(report);
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
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    pdf: OUT_PDF,
    html: OUT_HTML,
    json: OUT_JSON,
    totals: {
      beforeRevenue: before.totals.revenue,
      beforeCommissionRate: before.totals.commission_rate,
      beforeMargin: before.totals.margin,
      afterRevenue: enriched.totals.revenue,
      afterCommissionRate: enriched.totals.commission_rate,
      afterMargin: enriched.totals.margin,
      extraCommission: enriched.totals.extra_commission,
      profit: enriched.totals.profit,
      profitAtOldCommission: enriched.totals.profit_at_old_commission,
      articles: enriched.articles.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await pool.end().catch(() => {});
});
