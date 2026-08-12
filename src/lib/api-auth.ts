import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUserByIdPg, initShipmentTablesPg } from "@/lib/shipment-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";
import { verifyOrganizationCookie, ORGANIZATION_COOKIE_NAME } from "@/lib/organization-cookie";
import { resolveUserOrganization, isOrganizationAdmin } from "@/lib/organization-db";
import { enterOrganizationContext, type OrganizationRole } from "@/lib/organization-context";
import {
  getFbsPortalSession,
  sessionCanAccess,
  type FbsPortalModule,
} from "@/lib/fbs-portal-auth";

type CachedAdminUser = {
  role: string;
  name: string | null;
  email: string;
  expiresAt: number;
};

export interface AuthenticatedRequestContext {
  userId: number;
  userRole: string;
  userName: string | null;
  userEmail: string;
  organizationId: number;
  organizationRole: OrganizationRole;
}

const ADMIN_USER_CACHE_TTL_MS = 30_000;
const DEV_READONLY_ADMIN_ID = 7218;
const adminUserCache = new Map<number, CachedAdminUser>();
const adminUserInflight = new Map<number, Promise<CachedAdminUser | null>>();
const requestContextCache = new WeakMap<NextRequest, AuthenticatedRequestContext>();

/**
 * Re-enter the verified organization context from the route handler itself.
 *
 * AsyncLocalStorage state entered inside an awaited authentication helper does
 * not flow back into the caller's already-created continuation. Keeping the
 * verified result on the request lets every handler activate it immediately
 * after authentication, before it touches organization-scoped DB/files.
 */
export function activateAuthenticatedRequestContext(req: NextRequest): void {
  const context = requestContextCache.get(req);
  if (!context) {
    throw new Error("Authenticated organization context is unavailable");
  }
  enterOrganizationContext({
    organizationId: context.organizationId,
    userId: context.userId,
    organizationRole: context.organizationRole,
    source: "request",
  });
}

async function loadAdminUser(userId: number): Promise<CachedAdminUser | null> {
  const cached = adminUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const inflight = adminUserInflight.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
    await initShipmentTablesPg();
    const user = await getUserByIdPg(userId);

    if (!user) return null;
    const value = {
      role: user.role,
      name: user.name,
      email: user.email,
      expiresAt: Date.now() + ADMIN_USER_CACHE_TTL_MS,
    };
    adminUserCache.set(userId, value);
    return value;
  })();

  adminUserInflight.set(userId, promise);
  try {
    return await promise;
  } finally {
    adminUserInflight.delete(userId);
  }
}

export async function getAuthenticatedRequestContext(
  req: NextRequest,
): Promise<AuthenticatedRequestContext | null> {
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  if (
    process.env.NODE_ENV !== "production" &&
    isPostgresReadonlyConnection() &&
    payload.userId === DEV_READONLY_ADMIN_ID
  ) {
    const context: AuthenticatedRequestContext = {
      userId: payload.userId,
      userRole: "admin",
      userName: "Максим",
      userEmail: "admin",
      organizationId: 1,
      organizationRole: "owner",
    };
    requestContextCache.set(req, context);
    enterOrganizationContext({
      organizationId: 1,
      userId: payload.userId,
      organizationRole: "owner",
      source: "legacy",
    });
    return context;
  }

  const user = await loadAdminUser(payload.userId);
  if (!user) return null;

  const requestedOrganizationId = verifyOrganizationCookie(
    req.cookies.get(ORGANIZATION_COOKIE_NAME)?.value,
  );
  const organization = await resolveUserOrganization(payload.userId, requestedOrganizationId);
  if (!organization) return null;

  const context: AuthenticatedRequestContext = {
    userId: payload.userId,
    userRole: user.role,
    userName: user.name,
    userEmail: user.email,
    organizationId: organization.id,
    organizationRole: organization.role,
  };
  requestContextCache.set(req, context);
  enterOrganizationContext({
    organizationId: organization.id,
    userId: payload.userId,
    organizationRole: organization.role,
    source: "request",
  });

  return context;
}

/**
 * Historical name kept to avoid a risky all-routes rename. For business APIs
 * this now means "authenticated member of the active organization".
 */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function requireOrganizationAdmin(req: NextRequest): Promise<NextResponse | null> {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isOrganizationAdmin(context.organizationRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function requireSystemAdmin(req: NextRequest): Promise<NextResponse | null> {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (context.userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

/**
 * FBS endpoints accept either the normal MpHub organization session or the
 * isolated warehouse-portal session. No other business API accepts the latter.
 */
export async function requireFbsAccess(
  req: NextRequest,
  module: FbsPortalModule,
  options: { mutation?: boolean } = {},
): Promise<NextResponse | null> {
  const mphubContext = await getAuthenticatedRequestContext(req);
  if (mphubContext) {
    if (options.mutation && !isOrganizationAdmin(mphubContext.organizationRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
  }

  const portalSession = await getFbsPortalSession(req);
  if (!portalSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionCanAccess(portalSession, module)) {
    return NextResponse.json({ error: "Нет доступа к этому складскому разделу" }, { status: 403 });
  }

  const context: AuthenticatedRequestContext = {
    userId: portalSession.user.id,
    userRole: portalSession.user.is_admin ? "fbs_admin" : "fbs_user",
    userName: portalSession.user.name,
    userEmail: portalSession.user.email,
    organizationId: portalSession.organization.id,
    organizationRole: options.mutation ? "admin" : "member",
  };
  requestContextCache.set(req, context);
  enterOrganizationContext({
    organizationId: context.organizationId,
    userId: context.userId,
    organizationRole: context.organizationRole,
    source: "request",
  });
  return null;
}

export async function requireFbsSettingsAccess(
  req: NextRequest,
  options: { mutation?: boolean } = {},
): Promise<NextResponse | null> {
  const mphubContext = await getAuthenticatedRequestContext(req);
  if (mphubContext) {
    if (options.mutation && !isOrganizationAdmin(mphubContext.organizationRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
  }

  const portalSession = await getFbsPortalSession(req);
  if (!portalSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!portalSession.user.is_admin) {
    return NextResponse.json({ error: "Настройки доступны только администратору склада" }, { status: 403 });
  }
  const context: AuthenticatedRequestContext = {
    userId: portalSession.user.id,
    userRole: "fbs_admin",
    userName: portalSession.user.name,
    userEmail: portalSession.user.email,
    organizationId: portalSession.organization.id,
    organizationRole: "admin",
  };
  requestContextCache.set(req, context);
  enterOrganizationContext({
    organizationId: context.organizationId,
    userId: context.userId,
    organizationRole: context.organizationRole,
    source: "request",
  });
  return null;
}
