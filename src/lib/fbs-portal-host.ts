export const FBS_PORTAL_HOST = process.env.FBS_PORTAL_HOST || "fbs.imaxprom.site";

export function normalizedHostname(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().split(":")[0];
}

export function isFbsPortalHostname(value: string | null | undefined): boolean {
  const hostname = normalizedHostname(value);
  return hostname === FBS_PORTAL_HOST;
}
