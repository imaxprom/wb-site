import { NextRequest, NextResponse } from "next/server";
import { getComplaintByReviewId } from "@/lib/reviews-db";

/**
 * GET /api/reviews/complaint-status?review_id=N — статус жалобы
 * по review_id. UI polling-ит этот endpoint пока status=pending.
 *
 * Response: { status, error_message?, stuck? }
 * - status: "pending" | "submitted" | "error" | "approved" | "rejected" | "none"
 * - stuck: true если pending > 5 минут (процесс завис/упал)
 */
export async function GET(req: NextRequest) {
  const reviewId = Number(req.nextUrl.searchParams.get("review_id"));
  if (!reviewId) {
    return NextResponse.json({ error: "review_id required" }, { status: 400 });
  }
  const complaint = getComplaintByReviewId(reviewId);
  if (!complaint) {
    return NextResponse.json({ status: "none" });
  }
  const status = complaint.status || "pending";
  const stuck =
    status === "pending" &&
    complaint.created_at &&
    Date.now() - new Date(complaint.created_at).getTime() > 5 * 60 * 1000;

  return NextResponse.json({
    status,
    stuck: stuck || false,
    error_message: complaint.error_message || null,
    complaint_id: complaint.id,
  });
}
