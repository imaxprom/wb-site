import { NextResponse } from "next/server";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

export function localReadonlyGuard(action: string) {
  if (!isPostgresReadonlyConnection()) return null;

  return NextResponse.json(
    { error: `${action} is disabled in local PostgreSQL readonly mode. Localhost reads production-saved data through the SSH tunnel only.` },
    { status: 403 },
  );
}
