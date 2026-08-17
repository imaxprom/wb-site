import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { requireActiveOrganizationId } from "@/lib/organization-context";
import { getOrganizationDataPath } from "@/lib/organization-paths";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function hasWarehouseSpreadsheetConfig(organizationId: number): boolean {
  // The first organization keeps the original workbook for backwards
  // compatibility. Every additional organization must opt in explicitly.
  if (organizationId === 1) return true;
  try {
    const runtimeEnv = fs.readFileSync(getOrganizationDataPath("runtime.env"), "utf-8");
    return runtimeEnv
      .split(/\r?\n/)
      .some((line) => /^\s*WAREHOUSE_SPREADSHEET_ID\s*=\s*[^#\s]+/.test(line));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("Warehouse Google sync");
  if (readonlyError) return readonlyError;

  try {
    const organizationId = requireActiveOrganizationId();
    if (!hasWarehouseSpreadsheetConfig(organizationId)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "warehouse_spreadsheet_not_configured",
      });
    }
    const startedAt = new Date().toISOString();
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/warehouse-google-sync.js"],
      {
        cwd: process.cwd(),
        env: { ...process.env, MPHUB_ORGANIZATION_ID: String(organizationId) },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout,
      stderr,
    });
  } catch (err) {
    return apiError(err);
  }
}
