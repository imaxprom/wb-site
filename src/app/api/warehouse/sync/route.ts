import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const readonlyError = localReadonlyGuard("Warehouse Google sync");
  if (readonlyError) return readonlyError;

  try {
    const startedAt = new Date().toISOString();
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/warehouse-google-sync.js"],
      {
        cwd: process.cwd(),
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
