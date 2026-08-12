import crypto from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireFbsAccess } from "@/lib/api-auth";
import { pgRows } from "@/lib/postgres";
import { getWbImageUrlCandidates, getWbImageUrlFromKnownSource } from "@/lib/wb-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PhotoOrder = { order_id: number; nm_id: number; photo_url: string };

function imageResponse(bytes: Uint8Array, cacheState: "HIT" | "MISS" | "FALLBACK") {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-MpHub-Image-Cache": cacheState,
    },
  });
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "MpHub-FBS-Image-Cache/1.0" },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= 10 * 1024 * 1024 ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const orderId = Number(request.nextUrl.searchParams.get("orderId") || 0);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });

  const order = (await pgRows<PhotoOrder>(`SELECT order_id,nm_id,photo_url FROM fbs_fulfillment_orders WHERE order_id=? LIMIT 1`, [orderId]))[0];
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

  const cacheDirectory = path.join(process.cwd(), "data", "fbs-image-cache");
  const cachePath = path.join(cacheDirectory, `${order.nm_id}-1-c516x688.webp`);
  try {
    const details = await stat(cachePath);
    if (details.isFile() && details.size > 0) return imageResponse(new Uint8Array(await readFile(cachePath)), "HIT");
  } catch {
    // A cache miss is expected on the first view of a product.
  }

  const knownMedium = getWbImageUrlFromKnownSource(order.photo_url || "", "medium");
  const mediumCandidates = Array.from(new Set([knownMedium, ...getWbImageUrlCandidates(order.nm_id, "medium")].filter(Boolean)));
  for (const candidate of mediumCandidates) {
    const bytes = await fetchImage(candidate);
    if (!bytes) continue;
    await mkdir(cacheDirectory, { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, cachePath);
    } catch {
      await unlink(temporaryPath).catch(() => undefined);
    }
    return imageResponse(bytes, "MISS");
  }

  const fallbackCandidates = Array.from(new Set([order.photo_url, ...getWbImageUrlCandidates(order.nm_id, "small")].filter(Boolean)));
  for (const candidate of fallbackCandidates) {
    const bytes = await fetchImage(candidate);
    if (bytes) return imageResponse(bytes, "FALLBACK");
  }

  return NextResponse.json({ error: "Фотография временно недоступна" }, { status: 404 });
}
