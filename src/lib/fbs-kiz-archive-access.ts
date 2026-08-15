import { pgGet, pgQuery } from "@/lib/postgres";

const FBS_KIZ_ARCHIVE_ENABLED_KEY = "fbs_kiz_archive_enabled";

function parseBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export async function getFbsKizArchiveEnabled(): Promise<boolean> {
  const row = await pgGet<{ value: string }>("SELECT value FROM settings WHERE key=?", [FBS_KIZ_ARCHIVE_ENABLED_KEY]);
  // Existing organizations keep the previously available module until an
  // administrator explicitly disables it for that legal entity.
  return parseBooleanSetting(row?.value, true);
}

export async function setFbsKizArchiveEnabled(enabled: boolean): Promise<boolean> {
  await pgQuery(`
    INSERT INTO settings (key,value) VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value
  `, [FBS_KIZ_ARCHIVE_ENABLED_KEY, enabled ? "true" : "false"]);
  return getFbsKizArchiveEnabled();
}
