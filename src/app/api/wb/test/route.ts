import { NextRequest, NextResponse } from "next/server";

/** All WB API scopes with a lightweight test endpoint for each */
const SCOPES = [
  {
    name: "Контент",
    url: "https://content-api.wildberries.ru/content/v2/get/cards/list",
    method: "POST" as const,
    body: JSON.stringify({
      settings: { sort: { ascending: false }, cursor: { limit: 1 }, filter: { withPhoto: -1 } },
    }),
  },
  {
    name: "Маркетплейс",
    url: "https://marketplace-api.wildberries.ru/api/v3/offices",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Статистика",
    url: `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${new Date().toISOString()}`,
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Аналитика",
    url: "https://seller-analytics-api.wildberries.ru/api/v2/nm-report/detail",
    method: "POST" as const,
    body: JSON.stringify({ period: { begin: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) }, page: 1 }),
  },
  {
    name: "Продвижение",
    url: "https://advert-api.wildberries.ru/adv/v1/promotion/count",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Вопросы и отзывы",
    url: "https://feedbacks-api.wildberries.ru/api/v1/feedbacks/count-unanswered",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Цены и скидки",
    url: "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Поставки",
    url: "https://marketplace-api.wildberries.ru/api/v3/supplies?limit=1&next=0",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Возвраты",
    url: "https://returns-api.wildberries.ru/api/v1/returns?limit=1",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Финансы",
    url: "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage?dateFrom=2026-03-01&dateTo=2026-03-01",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Документы",
    url: "https://marketplace-api.wildberries.ru/api/v3/supplies?limit=1&next=0",
    method: "GET" as const,
    body: undefined,
  },
  {
    name: "Чат с покупателем",
    url: "https://marketplace-api.wildberries.ru/api/v3/supplies?limit=1&next=0",
    method: "GET" as const,
    body: undefined,
  },
];

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  const results: { name: string; ok: boolean }[] = [];

  // Run all checks in parallel
  const checks = SCOPES.map(async (scope) => {
    try {
      const res = await fetch(scope.url, {
        method: scope.method,
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: scope.body,
      });
      // 401/403 = no scope access; anything else (200, 400, 429) = scope is granted
      const denied = res.status === 401 || res.status === 403;
      return { name: scope.name, ok: !denied };
    } catch {
      return { name: scope.name, ok: false };
    }
  });

  const settled = await Promise.all(checks);
  results.push(...settled);

  const anyOk = results.some((r) => r.ok);

  return NextResponse.json({
    ok: anyOk,
    scopes: results,
  });
}
