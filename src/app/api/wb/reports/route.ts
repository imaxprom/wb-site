import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getWeeklyReports, downloadReportById } from "@/lib/wb-seller-api";
import { listReports } from "@/lib/wb-scraper";
import fs from "fs";

/**
 * GET /api/wb/reports — List weekly reports from WB API
 * GET /api/wb/reports?file=<filename> — Download a local report file
 * POST /api/wb/reports — Download a report by ID from WB
 *   Body: { reportId: number }
 */

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const fileName = req.nextUrl.searchParams.get("file");

    if (fileName) {
      // Serve a specific local file for download
      const reports = listReports();
      const report = reports.find((r) => r.name === fileName);

      if (!report) {
        return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
      }

      const fileBuffer = fs.readFileSync(report.path);
      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": "application/vnd.ms-excel",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(report.name)}"`,
        },
      });
    }

    // Fetch weekly reports list from WB API
    const dateFrom = req.nextUrl.searchParams.get("dateFrom") || undefined;
    const dateTo = req.nextUrl.searchParams.get("dateTo") || undefined;
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "15");
    const skip = parseInt(req.nextUrl.searchParams.get("skip") || "0");

    const result = await getWeeklyReports({ dateFrom, dateTo, limit, skip });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const reportId = body.reportId as number;

    if (!reportId) {
      return NextResponse.json({ ok: false, error: "reportId обязателен" }, { status: 400 });
    }

    const result = await downloadReportById(reportId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
