import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getOrganizationDataPath } from "@/lib/organization-paths";

/**
 * GET /api/monitor/auth-status — возвращает последнее состояние проверки (auth-check.js).
 *
 * Строка автопроверки показывается на /settings, поэтому этот read-only endpoint
 * должен быть доступен обычной странице настроек, а не только monitor-admin.
 * Ответ не содержит токены или ключи, только ok/dead и текст ошибки.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const statusPath = getOrganizationDataPath("auth-status.json");

  try {
    if (!fs.existsSync(statusPath)) {
      return NextResponse.json({
        api: null,
        lk: null,
        checkedAt: null,
        message: "Проверка ещё не запускалась (ждём первого cron в 22:00 МСК)",
      });
    }
    const data = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
