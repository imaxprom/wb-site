#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const reportDate = process.argv[2] || new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
  throw new Error("Date must use YYYY-MM-DD format");
}

const [year, month, day] = reportDate.split("-");
const displayDate = `${day}.${month}.${year}`;
const outputDir = path.join(process.cwd(), "reports");
const htmlPath = path.join(outputDir, `fbs-shipments-${reportDate}.html`);
const pdfPath = path.join(outputDir, `fbs-shipments-${reportDate}.pdf`);

const remoteSql = String.raw`
set -euo pipefail
cd /home/makson/current
set -a
. ./.env.local
. ./.env.production.local
set +a
psql "$DATABASE_URL" -X -q -t -A <<'SQL'
WITH delivered AS (
  SELECT 1 AS organization_id, 'ИП Беликова'::text AS organization_name,
         e.supply_id, MIN(e.created_at) AS delivered_at
  FROM public.fbs_fulfillment_events e
  WHERE e.action='supply_delivered'
    AND e.created_at >= TIMESTAMPTZ '${reportDate} 00:00:00 Europe/Moscow'
    AND e.created_at <  TIMESTAMPTZ '${reportDate} 00:00:00 Europe/Moscow' + INTERVAL '1 day'
  GROUP BY e.supply_id
  UNION ALL
  SELECT 2, 'ИП Made in China', e.supply_id, MIN(e.created_at)
  FROM organization_2.fbs_fulfillment_events e
  WHERE e.action='supply_delivered'
    AND e.created_at >= TIMESTAMPTZ '${reportDate} 00:00:00 Europe/Moscow'
    AND e.created_at <  TIMESTAMPTZ '${reportDate} 00:00:00 Europe/Moscow' + INTERVAL '1 day'
  GROUP BY e.supply_id
), orders AS (
  SELECT 1 AS organization_id, o.* FROM public.fbs_fulfillment_orders o
  UNION ALL
  SELECT 2 AS organization_id, o.* FROM organization_2.fbs_fulfillment_orders o
), supplies AS (
  SELECT 1 AS organization_id, s.* FROM public.fbs_fulfillment_supplies s
  UNION ALL
  SELECT 2 AS organization_id, s.* FROM organization_2.fbs_fulfillment_supplies s
), picked AS (
  SELECT d.organization_id, d.organization_name, d.supply_id, d.delivered_at,
         s.name AS supply_name, s.destination_office_id,
         COALESCE(NULLIF(o.raw_json->>'_mphubWarehouseName',''), NULLIF(s.destination_name,''), '—') AS warehouse_name,
         o.nm_id, TRIM(o.vendor_code) AS vendor_code, o.product_name, o.size_name,
         CASE
           WHEN LOWER(o.product_name || ' ' || o.vendor_code) ~ 'трус|слип|стринг|нижн.*бель' THEN 'underwear'
           WHEN LOWER(o.product_name || ' ' || o.vendor_code) ~ 'рюкзак' THEN 'backpack'
           ELSE 'other'
         END AS category
  FROM delivered d
  JOIN orders o USING (organization_id, supply_id)
  LEFT JOIN supplies s USING (organization_id, supply_id)
), supply_grouped AS (
  SELECT organization_id, organization_name, supply_id, delivered_at,
         COALESCE(MIN(supply_name), supply_id) AS supply_name,
         COALESCE(MAX(warehouse_name) FILTER (WHERE warehouse_name <> '—'), '—') AS warehouse_name,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE category='backpack')::int AS backpacks,
         COUNT(*) FILTER (WHERE category='underwear')::int AS underwear,
         COUNT(*) FILTER (WHERE category='other')::int AS other
  FROM picked
  GROUP BY organization_id, organization_name, supply_id, delivered_at
), backpack_grouped AS (
  SELECT organization_id, organization_name, nm_id, vendor_code, MIN(product_name) AS product_name,
         COUNT(*)::int AS quantity
  FROM picked WHERE category='backpack'
  GROUP BY organization_id, organization_name, nm_id, vendor_code
), underwear_grouped AS (
  SELECT organization_id, organization_name, nm_id, vendor_code, MIN(product_name) AS product_name,
         COALESCE(NULLIF(size_name,''),'Без размера') AS size_name, COUNT(*)::int AS quantity
  FROM picked WHERE category='underwear'
  GROUP BY organization_id, organization_name, nm_id, vendor_code, COALESCE(NULLIF(size_name,''),'Без размера')
)
SELECT jsonb_build_object(
  'date', '${reportDate}',
  'organizations', COALESCE((
    SELECT jsonb_agg(row_data ORDER BY organization_name)
    FROM (
      SELECT organization_id, organization_name, COUNT(DISTINCT supply_id)::int AS supplies,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE category='backpack')::int AS backpacks,
             COUNT(*) FILTER (WHERE category='underwear')::int AS underwear,
             COUNT(*) FILTER (WHERE category='other')::int AS other
      FROM picked GROUP BY organization_id, organization_name
    ) row_data
  ), '[]'::jsonb),
  'supplies', COALESCE((
    SELECT jsonb_agg(to_jsonb(row_data) ORDER BY delivered_at, supply_id)
    FROM (
      SELECT organization_id, organization_name, supply_id, supply_name, warehouse_name,
             to_char(delivered_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY HH24:MI') AS delivered_msk,
             delivered_at, total, backpacks, underwear, other
      FROM supply_grouped
    ) row_data
  ), '[]'::jsonb),
  'backpacks', COALESCE((
    SELECT jsonb_agg(to_jsonb(row_data) ORDER BY organization_name, nm_id, vendor_code)
    FROM backpack_grouped row_data
  ), '[]'::jsonb),
  'underwear', COALESCE((
    SELECT jsonb_agg(to_jsonb(row_data) ORDER BY organization_name, nm_id, size_name)
    FROM underwear_grouped row_data
  ), '[]'::jsonb)
)::text;
SQL
`;

const raw = execFileSync("ssh", ["wb-site", "bash", "-s"], {
  input: remoteSql,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
}).trim();
const data = JSON.parse(raw);

const supplies = Array.isArray(data.supplies) ? data.supplies : [];
const backpacks = Array.isArray(data.backpacks) ? data.backpacks : [];
const underwear = Array.isArray(data.underwear) ? data.underwear : [];
const organizations = Array.isArray(data.organizations) ? data.organizations : [];

const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const total = sum(supplies, "total");
const backpackTotal = sum(backpacks, "quantity");
const underwearTotal = sum(underwear, "quantity");
const otherTotal = sum(supplies, "other");

if (total !== backpackTotal + underwearTotal + otherTotal) {
  throw new Error(`Report totals mismatch: ${total} != ${backpackTotal} + ${underwearTotal} + ${otherTotal}`);
}
if (otherTotal > 0) {
  throw new Error(`Report contains ${otherTotal} unclassified FBS orders`);
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatNumber = (value) => Number(value || 0).toLocaleString("ru-RU");

function sizeNumbers(value) {
  return Array.from(String(value).matchAll(/\d+(?:[.,]\d+)?/g), (match) => Number(match[0].replace(",", ".")));
}

function compareSizes(left, right) {
  const leftNumbers = sizeNumbers(left.size_name);
  const rightNumbers = sizeNumbers(right.size_name);
  for (let index = 0; index < Math.max(leftNumbers.length, rightNumbers.length); index += 1) {
    const delta = (leftNumbers[index] ?? Number.POSITIVE_INFINITY) - (rightNumbers[index] ?? Number.POSITIVE_INFINITY);
    if (delta) return delta;
  }
  return String(left.size_name).localeCompare(String(right.size_name), "ru", { numeric: true });
}

const organizationLabel = organizations.map((row) => row.organization_name).join(", ") || "—";
const underwearGroups = new Map();
for (const row of underwear) {
  const key = `${row.organization_id}:${row.nm_id}:${row.vendor_code}`;
  if (!underwearGroups.has(key)) underwearGroups.set(key, []);
  underwearGroups.get(key).push(row);
}

const generatedAt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date());

const supplyRows = supplies.map((row, index) => `
  <tr>
    <td class="num">${index + 1}</td>
    <td>${escapeHtml(row.delivered_msk)}</td>
    <td><strong>${escapeHtml(row.warehouse_name)}</strong><small>${escapeHtml(row.supply_id)}</small></td>
    <td class="qty">${formatNumber(row.backpacks)}</td>
    <td class="qty">${formatNumber(row.underwear)}</td>
    <td class="qty total-cell">${formatNumber(row.total)}</td>
  </tr>`).join("");

const backpackRows = backpacks.map((row, index) => `
  <tr>
    <td class="num">${index + 1}</td>
    <td class="article">${escapeHtml(row.nm_id)}</td>
    <td><strong>${escapeHtml(row.vendor_code || "—")}</strong><small>${escapeHtml(row.product_name)}</small></td>
    <td class="qty">${formatNumber(row.quantity)}</td>
  </tr>`).join("");

const underwearRows = Array.from(underwearGroups.values()).map((rows) => {
  rows.sort(compareSizes);
  const first = rows[0];
  const groupTotal = sum(rows, "quantity");
  return `
    <tbody class="product-group">
      <tr class="group-title">
        <td colspan="3"><strong>${escapeHtml(first.vendor_code || "—")}</strong> · WB ${escapeHtml(first.nm_id)}<small>${escapeHtml(first.product_name)}</small></td>
        <td class="qty">${formatNumber(groupTotal)}</td>
      </tr>
      ${rows.map((row) => `
        <tr>
          <td class="num"></td>
          <td colspan="2" class="size">Размер ${escapeHtml(row.size_name)}</td>
          <td class="qty">${formatNumber(row.quantity)}</td>
        </tr>`).join("")}
    </tbody>`;
}).join("");

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>FBS — отгрузки за ${displayDate}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; line-height: 1.35; }
    h1 { margin: 0; font-size: 24px; letter-spacing: -.4px; }
    h2 { margin: 22px 0 8px; font-size: 16px; page-break-after: avoid; }
    p { margin: 4px 0 0; color: #5b6475; }
    .top { border-bottom: 2px solid #172033; padding-bottom: 10px; }
    .meta { display: flex; justify-content: space-between; gap: 16px; margin-top: 8px; font-size: 10px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin: 14px 0 6px; }
    .card { border: 1px solid #cfd5df; border-radius: 7px; padding: 9px 10px; background: #f7f8fa; }
    .card span { display: block; color: #687184; font-size: 9px; text-transform: uppercase; letter-spacing: .45px; }
    .card strong { display: block; margin-top: 2px; font-size: 19px; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th { background: #e7eaf0; border: 1px solid #aeb6c4; padding: 6px 7px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
    td { border: 1px solid #cfd5df; padding: 5px 7px; vertical-align: top; }
    tr { page-break-inside: avoid; }
    td small { display: block; margin-top: 2px; color: #687184; font-size: 8.8px; }
    .num { width: 28px; text-align: center; color: #687184; }
    .article { width: 92px; font-family: "Courier New", monospace; }
    .qty { width: 58px; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    .total-cell { background: #f1f3f6; }
    .group-title td { background: #eef0f4; padding-top: 7px; padding-bottom: 7px; }
    .product-group { page-break-inside: avoid; }
    .size { padding-left: 22px; }
    .check { margin-top: 13px; border: 1px solid #172033; padding: 8px 10px; display: flex; justify-content: space-between; font-weight: 700; }
    .footnote { margin-top: 12px; font-size: 8.8px; color: #687184; }
  </style>
</head>
<body>
  <section class="top">
    <h1>FBS — отгрузки за ${displayDate}</h1>
    <p>Только поставки, успешно переданные в доставку Wildberries. Время — МСК.</p>
    <div class="meta"><span>Юрлицо: <strong>${escapeHtml(organizationLabel)}</strong></span><span>Сформировано: ${escapeHtml(generatedAt)} МСК</span></div>
  </section>

  <section class="cards">
    <div class="card"><span>Поставок</span><strong>${formatNumber(supplies.length)}</strong></div>
    <div class="card"><span>Всего товаров</span><strong>${formatNumber(total)}</strong></div>
    <div class="card"><span>Рюкзаков</span><strong>${formatNumber(backpackTotal)}</strong></div>
    <div class="card"><span>Трусов</span><strong>${formatNumber(underwearTotal)}</strong></div>
  </section>

  <h2>Поставки</h2>
  <table>
    <thead><tr><th>№</th><th>Передано</th><th>Склад / номер поставки</th><th>Рюкзаки</th><th>Трусы</th><th>Всего</th></tr></thead>
    <tbody>${supplyRows}</tbody>
  </table>

  <h2>Рюкзаки по артикулам</h2>
  <table>
    <thead><tr><th>№</th><th>Артикул WB</th><th>Артикул продавца / товар</th><th>Штук</th></tr></thead>
    <tbody>${backpackRows}</tbody>
  </table>
  <div class="check"><span>Итого рюкзаков</span><span>${formatNumber(backpackTotal)} шт.</span></div>

  <h2>Трусы по артикулам и размерам</h2>
  <table>
    <thead><tr><th>№</th><th colspan="2">Артикул / размер</th><th>Штук</th></tr></thead>
    ${underwearRows}
  </table>
  <div class="check"><span>Итого трусов</span><span>${formatNumber(underwearTotal)} шт.</span></div>

  <p class="footnote">Источник: production MpHub FBS, события supply_delivered за ${displayDate} по часовому поясу Europe/Moscow. Черновики, активные поставки и только напечатанные задания в отчет не включены.</p>
</body>
</html>`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(htmlPath, html);

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#697386;padding:0 12mm;display:flex;justify-content:space-between"><span>FBS · ${displayDate}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "14mm", right: "12mm", bottom: "15mm", left: "12mm" },
  });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  pdfPath,
  htmlPath,
  supplies: supplies.length,
  total,
  backpacks: backpackTotal,
  underwear: underwearTotal,
}, null, 2));
