import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { isPostgresReadonlyConnection } from "@/lib/postgres";
import { getReviewsPg } from "@/lib/reviews-db";

export const maxDuration = 600;

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const sp = req.nextUrl.searchParams;
    const syncParam = sp.get("sync");
    const shouldSync = syncParam === "true" || syncParam === "full";

    if (shouldSync) {
      return NextResponse.json(
        {
          error: isPostgresReadonlyConnection()
            ? "Reviews sync is disabled in local PostgreSQL readonly mode"
            : "Reviews sync via API is disabled in PostgreSQL mode. Use the server-side reviews sync job.",
          code: "reviews_sync_disabled_pg",
        },
        { status: isPostgresReadonlyConnection() ? 403 : 409 },
      );
    }

    const filters = {
      account_id: sp.get("account_id") ? Number(sp.get("account_id")) : undefined,
      date_from: sp.get("date_from") || undefined,
      date_to: sp.get("date_to") || undefined,
      rating: sp.get("rating") || undefined,
      status: sp.get("status") || undefined,
      complaint_status: sp.get("complaint_status") || undefined,
      is_hidden:
        sp.get("is_hidden") !== null && sp.get("is_hidden") !== ""
          ? Number(sp.get("is_hidden"))
          : undefined,
      is_updated:
        sp.get("is_updated") !== null && sp.get("is_updated") !== ""
          ? Number(sp.get("is_updated"))
          : undefined,
      is_excluded_rating:
        sp.get("is_excluded_rating") !== null && sp.get("is_excluded_rating") !== ""
          ? Number(sp.get("is_excluded_rating"))
          : undefined,
      purchase_type: sp.get("purchase_type") || undefined,
      search_product: sp.get("search_product") || undefined,
      search_article: sp.get("search_article") || undefined,
      search_text: sp.get("search_text") || undefined,
      search_buyer: sp.get("search_buyer") || undefined,
      search_comment: sp.get("search_comment") || undefined,
      wb_review_id: sp.get("wb_review_id") || undefined,
      buyer_chat_id: sp.get("buyer_chat_id") || undefined,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      per_page: sp.get("per_page") ? Number(sp.get("per_page")) : 25,
      sort_by: sp.get("sort_by") || "date",
      sort_dir: (sp.get("sort_dir") as "asc" | "desc") || "desc",
    };

    const result = await getReviewsPg(filters);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
