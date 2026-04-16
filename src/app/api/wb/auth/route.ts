import { NextRequest, NextResponse } from "next/server";
import { playwrightSendPhone, playwrightCheckSession, playwrightLogout } from "@/lib/wb-auth-playwright";
import fs from "fs";
import path from "path";

const TOKENS_PATH = path.join(process.cwd(), "data", "wb-tokens.json");

/**
 * POST /api/wb/auth — Start auth: send phone number (Playwright on VPS)
 * GET /api/wb/auth — Check if session is active + return session info
 * DELETE /api/wb/auth — Logout
 */

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите номер телефона" }, { status: 400 });
    }
    const result = await playwrightSendPhone(phone);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await playwrightCheckSession();

    // Enrich with session info from tokens
    if (result.ok) {
      let supplier = "";
      let phone = "";
      try {
        if (fs.existsSync(TOKENS_PATH)) {
          const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));

          // Get supplier name from wbSellerLk JWT
          if (tokens.wbSellerLk) {
            try {
              const payload = JSON.parse(Buffer.from(tokens.wbSellerLk.split(".")[1], "base64").toString());
              const sd = payload.data || {};
              const sfid = sd["Z-Sfid"] || sd["Z-Soid"] || "";
              supplier = sfid ? `ИП (ID: ${sfid})` : "";
            } catch {}
          }

          // Try reading supplier name from last auth log
          try {
            const log = fs.readFileSync("/tmp/wb_auth_log.txt", "utf-8");
            const match = log.match(/supplier":\s*"([^"]+)"/);
            if (match) supplier = match[1];
          } catch {}

          // Get phone from saved tokens
          if (tokens.savedAt) {
            try {
              const log = fs.readFileSync("/tmp/wb_auth_log.txt", "utf-8");
              const match = log.match(/phone":\s*"(\d+)"/);
              if (match) {
                const d = match[1];
                phone = `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8,10)}`;
              }
            } catch {}
          }

          if (!supplier && tokens.supplierId) {
            supplier = `Кабинет ${tokens.supplierId}`;
          }
        }
      } catch {}

      return NextResponse.json({ ...result, supplier, phone });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    playwrightLogout();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
