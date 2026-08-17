import { pgGet, pgRows } from "@/lib/postgres";

export interface OrganizationCapabilities {
  fbo: boolean;
  reviews: boolean;
}

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

export async function getOrganizationCapabilities(): Promise<OrganizationCapabilities> {
  const [settings, reviewAccount] = await Promise.all([
    pgRows<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key IN (?, ?)",
      ["monitor_fbo_enabled", "monitor_reviews_enabled"],
    ),
    pgGet<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM review_accounts WHERE COALESCE(api_key, '') <> ''",
    ),
  ]);
  const values = new Map(settings.map((row) => [row.key, row.value]));
  return {
    fbo: parseFlag(values.get("monitor_fbo_enabled"), true),
    reviews: parseFlag(values.get("monitor_reviews_enabled"), Number(reviewAccount?.cnt || 0) > 0),
  };
}
