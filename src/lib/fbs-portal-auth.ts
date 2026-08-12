import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { verifyOrganizationCookie } from "@/lib/organization-cookie";
import { pgGet, pgRows, withPgTransaction } from "@/lib/postgres";

export const FBS_PORTAL_COOKIE_NAME = "fbs-portal-token";
export const FBS_PORTAL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

type PortalTokenPayload = {
  portalUserId: number;
  sessionVersion: number;
  scope: "fbs-portal";
  iat: number;
  exp: number;
};

export type FbsPortalModule = "assembly" | "stock";

export type FbsPortalOrganizationAccess = {
  id: number;
  slug: string;
  display_name: string;
  legal_name: string;
  inn: string | null;
  status: string;
  is_default: boolean;
  can_assembly: boolean;
  can_stock: boolean;
};

export type FbsPortalSession = {
  user: {
    id: number;
    email: string;
    name: string;
    is_admin: boolean;
    session_version: number;
  };
  organization: FbsPortalOrganizationAccess;
  organizations: FbsPortalOrganizationAccess[];
};

type PortalUserRow = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  status: string;
  is_admin: boolean;
  session_version: number;
};

function secret(): string {
  const value = process.env.FBS_PORTAL_JWT_SECRET || (process.env.NODE_ENV !== "production" ? "fbs-portal-dev-secret-2026" : "");
  if (!value) throw new Error("FBS_PORTAL_JWT_SECRET is required");
  return value;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function createFbsPortalToken(userId: number, sessionVersion: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({
    portalUserId: userId,
    sessionVersion,
    scope: "fbs-portal",
    iat: now,
    exp: now + FBS_PORTAL_COOKIE_MAX_AGE,
  } satisfies PortalTokenPayload));
  const signature = crypto.createHmac("sha256", secret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyFbsPortalToken(token: string): PortalTokenPayload | null {
  try {
    const [header, body, signature, extra] = token.split(".");
    if (extra !== undefined || !header || !body || !signature) return null;
    const expected = crypto.createHmac("sha256", secret()).update(`${header}.${body}`).digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PortalTokenPayload;
    if (payload.scope !== "fbs-portal" || !Number.isSafeInteger(payload.portalUserId) || payload.portalUserId < 1) return null;
    if (!Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 1) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getFbsPortalUserByEmail(email: string): Promise<PortalUserRow | undefined> {
  return pgGet<PortalUserRow>(`
    SELECT id,email,password_hash,name,status,is_admin,session_version
    FROM public.fbs_portal_users
    WHERE LOWER(email)=LOWER(?)
    LIMIT 1
  `, [email]);
}

export async function getFbsPortalOrganizations(userId: number): Promise<FbsPortalOrganizationAccess[]> {
  return pgRows<FbsPortalOrganizationAccess>(`
    SELECT o.id,o.slug,o.display_name,o.legal_name,o.inn,o.status,o.is_default,
      p.can_assembly,p.can_stock
    FROM public.fbs_portal_permissions p
    JOIN public.organizations o ON o.id=p.organization_id
    WHERE p.user_id=? AND o.status IN ('active','setup')
      AND (p.can_assembly=TRUE OR p.can_stock=TRUE)
    ORDER BY o.is_default DESC,o.display_name,o.id
  `, [userId]);
}

export async function getFbsPortalSessionFromToken(token: string, requestedOrganizationId: number | null = null): Promise<FbsPortalSession | null> {
  const payload = verifyFbsPortalToken(token);
  if (!payload) return null;
  const user = await pgGet<PortalUserRow>(`
    SELECT id,email,password_hash,name,status,is_admin,session_version
    FROM public.fbs_portal_users WHERE id=? LIMIT 1
  `, [payload.portalUserId]);
  if (!user || user.status !== "active" || user.session_version !== payload.sessionVersion) return null;
  const organizations = await getFbsPortalOrganizations(user.id);
  if (!organizations.length) return null;
  const organization = organizations.find((row) => row.id === requestedOrganizationId) || organizations[0];
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      session_version: user.session_version,
    },
    organization,
    organizations,
  };
}

export async function getFbsPortalSession(request: NextRequest): Promise<FbsPortalSession | null> {
  const organizationId = verifyOrganizationCookie(request.cookies.get("mphub-org")?.value);
  return getFbsPortalSessionFromToken(request.cookies.get(FBS_PORTAL_COOKIE_NAME)?.value || "", organizationId);
}

export function sessionCanAccess(session: FbsPortalSession, module: FbsPortalModule): boolean {
  return module === "assembly" ? session.organization.can_assembly : session.organization.can_stock;
}

export async function authenticateFbsPortalLogin(email: string, password: string): Promise<PortalUserRow | null> {
  const user = await getFbsPortalUserByEmail(email);
  if (!user || user.status !== "active" || !verifyPassword(password, user.password_hash)) return null;
  const organizations = await getFbsPortalOrganizations(user.id);
  if (!organizations.length) return null;
  await pgGet(`UPDATE public.fbs_portal_users SET last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id`, [user.id]);
  return user;
}

export function generateFbsPortalPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const random = crypto.randomBytes(18);
  const body = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
  return `Sk!${body.slice(0, 6)}-${body.slice(6, 12)}-${body.slice(12)}`;
}

export async function createFbsPortalUser(input: {
  actorUserId: number;
  email: string;
  name: string;
  isAdmin: boolean;
  permissions: Array<{ organizationId: number; canAssembly: boolean; canStock: boolean }>;
}): Promise<{ id: number; temporaryPassword: string }> {
  const temporaryPassword = generateFbsPortalPassword();
  const passwordHash = hashPassword(temporaryPassword);
  const result = await withPgTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(`
      INSERT INTO public.fbs_portal_users (email,password_hash,name,is_admin,created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING id
    `, [input.email, passwordHash, input.name, input.isAdmin, input.actorUserId]);
    const userId = Number(inserted.rows[0].id);
    for (const permission of input.permissions) {
      await client.query(`
        INSERT INTO public.fbs_portal_permissions (user_id,organization_id,can_assembly,can_stock)
        VALUES ($1,$2,$3,$4)
      `, [userId, permission.organizationId, permission.canAssembly, permission.canStock]);
    }
    await client.query(`
      INSERT INTO public.fbs_portal_audit (actor_user_id,target_user_id,action,details_json)
      VALUES ($1,$2,'user_created',$3::jsonb)
    `, [input.actorUserId, userId, JSON.stringify({ email: input.email, isAdmin: input.isAdmin, permissions: input.permissions })]);
    return userId;
  });
  return { id: result, temporaryPassword };
}

export async function updateFbsPortalUser(input: {
  actorUserId: number;
  userId: number;
  name: string;
  status: "active" | "disabled";
  isAdmin: boolean;
  permissions: Array<{ organizationId: number; canAssembly: boolean; canStock: boolean }>;
}): Promise<void> {
  await withPgTransaction(async (client) => {
    const changed = await client.query(`
      UPDATE public.fbs_portal_users
      SET name=$2,status=$3,is_admin=$4,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [input.userId, input.name, input.status, input.isAdmin]);
    if (!changed.rowCount) throw new Error("Складской пользователь не найден");
    await client.query(`DELETE FROM public.fbs_portal_permissions WHERE user_id=$1`, [input.userId]);
    for (const permission of input.permissions) {
      await client.query(`
        INSERT INTO public.fbs_portal_permissions (user_id,organization_id,can_assembly,can_stock)
        VALUES ($1,$2,$3,$4)
      `, [input.userId, permission.organizationId, permission.canAssembly, permission.canStock]);
    }
    await client.query(`
      INSERT INTO public.fbs_portal_audit (actor_user_id,target_user_id,action,details_json)
      VALUES ($1,$2,'user_updated',$3::jsonb)
    `, [input.actorUserId, input.userId, JSON.stringify({ status: input.status, isAdmin: input.isAdmin, permissions: input.permissions })]);
  });
}

export async function resetFbsPortalPassword(actorUserId: number, userId: number): Promise<string> {
  const temporaryPassword = generateFbsPortalPassword();
  await withPgTransaction(async (client) => {
    const changed = await client.query(`
      UPDATE public.fbs_portal_users
      SET password_hash=$2,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [userId, hashPassword(temporaryPassword)]);
    if (!changed.rowCount) throw new Error("Складской пользователь не найден");
    await client.query(`
      INSERT INTO public.fbs_portal_audit (actor_user_id,target_user_id,action)
      VALUES ($1,$2,'password_reset')
    `, [actorUserId, userId]);
  });
  return temporaryPassword;
}
