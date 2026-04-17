import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const STATUS_PATH = path.join(process.cwd(), "public", "data", "monitor", "auth-status.json");

/**
 * GET /api/monitor/auth-status — возвращает последнее состояние проверки (auth-check.js).
 */
export async function GET() {
  try {
    if (!fs.existsSync(STATUS_PATH)) {
      return NextResponse.json({
        api: null,
        lk: null,
        checkedAt: null,
        message: "Проверка ещё не запускалась (ждём первого cron в 22:00 МСК)",
      });
    }
    const data = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
