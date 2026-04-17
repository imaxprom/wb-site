import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const API_KEY_PATH = path.join(process.cwd(), "data", "wb-api-key.txt");

/**
 * POST /api/monitor/auth-set-key — сохранить новый WB API-ключ.
 * Body: { key: string }
 * Проверяет ключ через реальный запрос к WB перед записью в файл.
 */
export async function POST(req: NextRequest) {
  try {
    const { key } = (await req.json()) as { key?: string };
    const trimmed = (key || "").trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: "Пустой ключ" }, { status: 400 });
    }

    // Быстрая валидация: JWT из 3 частей
    if (trimmed.split(".").length !== 3) {
      return NextResponse.json({ ok: false, error: "Неверный формат ключа (ожидается JWT)" }, { status: 400 });
    }

    // Проверяем запросом к WB
    const dateNow = new Date().toISOString().slice(0, 19);
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${dateNow}`,
      { headers: { Authorization: trimmed }, signal: AbortSignal.timeout(15000) }
    );

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, error: `Ключ отклонён WB (HTTP ${res.status}). Проверь что скопирован правильно и не истёк.` }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: `WB вернул HTTP ${res.status}` }, { status: 400 });
    }

    // Сохраняем
    fs.mkdirSync(path.dirname(API_KEY_PATH), { recursive: true });
    fs.writeFileSync(API_KEY_PATH, trimmed);
    return NextResponse.json({ ok: true, message: "Ключ сохранён и проверен" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
