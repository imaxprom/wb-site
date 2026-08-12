import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isCronRequest } from "@/lib/cron-auth";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { isPostgresReadonlyConnection } from "@/lib/postgres";
import {
  getCartStockStatusLocal,
  getCartStockStatusPg,
} from "@/lib/wb-cart-stock";
import {
  enqueueCartStockJob,
  enqueueCartStockJobsAcrossOrganizations,
  getCartStockQueueStatus,
} from "@/lib/cart-stock-jobs";
import type { CartStockProductGroup } from "@/types/cart-stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function useLocalCache(): boolean {
  return process.env.NODE_ENV !== "production" && isPostgresReadonlyConnection();
}

function parseProductGroup(value: unknown): CartStockProductGroup | null {
  if (value === "rucksacks" || value === "underwear") return value;
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const productGroup = parseProductGroup(request.nextUrl.searchParams.get("group")) || "rucksacks";
    const localCache = useLocalCache();
    const status = localCache
      ? await getCartStockStatusLocal(productGroup)
      : await getCartStockStatusPg(productGroup);
    const queue = localCache ? undefined : await getCartStockQueueStatus(productGroup);
    return NextResponse.json({ ok: true, ...status, queue });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const cronRequest = isCronRequest(request);
  if (!cronRequest) {
    const authError = await requireAdmin(request);
    if (authError) return authError;
    activateAuthenticatedRequestContext(request);
  }

  const localCache = useLocalCache();
  if (localCache) {
    return apiError(
      new Error("Обновление выполняется production worker WB-Парсера; локальный read-only режим недоступен"),
      409,
    );
  }
  const readonlyError = localReadonlyGuard("WB cart stock refresh");
  if (readonlyError) return readonlyError;

  try {
    const body = await request.json().catch(() => ({})) as { productGroup?: unknown };
    const requestedGroup = body.productGroup == null ? "rucksacks" : parseProductGroup(body.productGroup);
    if (!requestedGroup) {
      return NextResponse.json({ ok: false, error: "Unknown cart-stock product group" }, { status: 400 });
    }

    const groups: CartStockProductGroup[] = cronRequest
      ? ["rucksacks", "underwear"]
      : [requestedGroup];
    if (cronRequest) {
      const jobs = await enqueueCartStockJobsAcrossOrganizations("cron", groups);
      return NextResponse.json({ ok: true, jobs }, { status: 202 });
    }
    const jobs = [];
    for (const productGroup of groups) {
      jobs.push(await enqueueCartStockJob(cronRequest ? "cron" : "manual", productGroup));
    }
    const job = jobs.find((item) => item.productGroup === requestedGroup) || jobs[0];
    const [status, queue] = await Promise.all([
      getCartStockStatusPg(requestedGroup),
      getCartStockQueueStatus(requestedGroup),
    ]);
    return NextResponse.json({ ok: true, ...status, queue, job, jobs }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
