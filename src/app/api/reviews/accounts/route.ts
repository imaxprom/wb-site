import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getReviewAccounts, createReviewAccount, ensureDefaultAccount, getDefaultAccountApiKey } from "@/lib/reviews-db";

const WB_TOKEN_PATH = "/Users/octopus/.openclaw/agents/prince/agent/.wb_token";

function ensureAccount() {
  const fromDb = getDefaultAccountApiKey();
  if (fromDb) {
    ensureDefaultAccount(fromDb);
    return;
  }
  const tokenPath = path.resolve(WB_TOKEN_PATH);
  const token = fs.readFileSync(tokenPath, "utf-8").trim();
  ensureDefaultAccount(token);
}

export async function GET() {
  try {
    ensureAccount();
    const accounts = getReviewAccounts();
    return NextResponse.json(accounts);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.api_key) {
      return NextResponse.json({ error: "name and api_key are required" }, { status: 400 });
    }
    const id = createReviewAccount(body);
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
