import crypto from "node:crypto";

export const ORGANIZATION_COOKIE_NAME = "mphub-org";
export const ORGANIZATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const value = process.env.JWT_SECRET || "";
  if (!value) throw new Error("JWT_SECRET is required for organization cookies");
  return value;
}

function signature(organizationId: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`organization:${organizationId}`)
    .digest("base64url");
}

export function createOrganizationCookie(organizationId: number): string {
  return `${organizationId}.${signature(organizationId)}`;
}

export function verifyOrganizationCookie(value: string | undefined): number | null {
  if (!value) return null;
  const [idRaw, suppliedSignature, extra] = value.split(".");
  if (extra !== undefined || !idRaw || !suppliedSignature) return null;
  const organizationId = Number(idRaw);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null;
  const expected = signature(organizationId);
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return organizationId;
}
