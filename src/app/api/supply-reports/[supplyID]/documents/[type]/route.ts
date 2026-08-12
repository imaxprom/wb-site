import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  downloadAndStoreSupplyReportDocumentPg,
  getSupplyReportDocumentFilePg,
  SUPPLY_REPORT_DOCUMENT_TYPES,
  type SupplyReportDocumentType,
} from "@/lib/supply-reports";

function isDocumentType(value: string): value is SupplyReportDocumentType {
  return SUPPLY_REPORT_DOCUMENT_TYPES.some((item) => item.key === value);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ supplyID: string; type: string }> }
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const { supplyID: rawSupplyID, type: rawType } = await context.params;
    const supplyID = Number(rawSupplyID);
    if (!Number.isSafeInteger(supplyID) || !isDocumentType(rawType)) {
      return NextResponse.json({ error: "Некорректный документ поставки" }, { status: 400 });
    }

    const saved = await getSupplyReportDocumentFilePg(supplyID, rawType);
    const file = saved || await downloadAndStoreSupplyReportDocumentPg(supplyID, rawType);
    const buffer = fs.readFileSync(file.path);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
