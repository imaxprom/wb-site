import {
  DEFAULT_FBS_MARKING_POLICY,
  type FbsMarkingPolicy,
} from "@/lib/fbs-metadata";
import { pgGet, pgQuery } from "@/lib/postgres";

const FORCE_UNDERWEAR_SGTIN_KEY = "fbs_force_underwear_sgtin";

function parseBooleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export async function getFbsMarkingPolicy(): Promise<FbsMarkingPolicy> {
  const row = await pgGet<{ value: string }>("SELECT value FROM settings WHERE key=?", [FORCE_UNDERWEAR_SGTIN_KEY]);
  return {
    forceUnderwearSgtin: parseBooleanSetting(
      row?.value,
      DEFAULT_FBS_MARKING_POLICY.forceUnderwearSgtin,
    ),
  };
}

export async function setFbsMarkingPolicy(policy: FbsMarkingPolicy): Promise<FbsMarkingPolicy> {
  await pgQuery(`
    INSERT INTO settings (key,value) VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value
  `, [FORCE_UNDERWEAR_SGTIN_KEY, policy.forceUnderwearSgtin ? "true" : "false"]);
  return getFbsMarkingPolicy();
}
