import { NextRequest, NextResponse } from "next/server";
import {
  createFbsPortalUser,
  getFbsPortalSession,
  resetFbsPortalPassword,
  updateFbsPortalUser,
} from "@/lib/fbs-portal-auth";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { pgGet, pgRows } from "@/lib/postgres";

type PermissionInput = { organizationId?: unknown; canAssembly?: unknown; canStock?: unknown };

function parsePermissions(value: unknown, allowedOrganizationIds: Set<number>) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap((raw) => {
    const row = raw as PermissionInput;
    const organizationId = Number(row.organizationId);
    if (!allowedOrganizationIds.has(organizationId) || seen.has(organizationId)) return [];
    seen.add(organizationId);
    return [{ organizationId, canAssembly: row.canAssembly === true, canStock: row.canStock === true }];
  }).filter((row) => row.canAssembly || row.canStock);
}

async function adminSession(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return null;
  const session = await getFbsPortalSession(request);
  return session?.user.is_admin ? session : null;
}

export async function GET(request: NextRequest) {
  const session = await adminSession(request);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const organizationIds = session.organizations.map((row) => row.id);
  const users = await pgRows<{
    id: number; email: string; name: string; status: string; is_admin: boolean;
    last_login_at: string | null; created_at: string;
  }>(`
    SELECT DISTINCT u.id,u.email,u.name,u.status,u.is_admin,u.last_login_at,u.created_at
    FROM public.fbs_portal_users u
    JOIN public.fbs_portal_permissions p ON p.user_id=u.id
    WHERE p.organization_id=ANY(?::bigint[])
    ORDER BY u.is_admin DESC,u.name,u.email
  `, [organizationIds]);
  const permissions = await pgRows<{
    user_id: number; organization_id: number; can_assembly: boolean; can_stock: boolean;
  }>(`
    SELECT user_id,organization_id,can_assembly,can_stock
    FROM public.fbs_portal_permissions
    WHERE organization_id=ANY(?::bigint[])
    ORDER BY user_id,organization_id
  `, [organizationIds]);
  return NextResponse.json({
    currentUserId: session.user.id,
    organizations: session.organizations.map((row) => ({ id: row.id, displayName: row.display_name })),
    users: users.map((user) => ({
      ...user,
      permissions: permissions.filter((permission) => permission.user_id === user.id).map((permission) => ({
        organizationId: permission.organization_id,
        canAssembly: permission.can_assembly,
        canStock: permission.can_stock,
      })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await adminSession(request);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "create");
  const allowedOrganizationIds = new Set(session.organizations.map((row) => row.id));

  try {
    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase().slice(0, 240);
      const name = String(body.name || "").trim().slice(0, 160);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
      if (!name) return NextResponse.json({ error: "Укажите имя сотрудника" }, { status: 400 });
      const permissions = parsePermissions(body.permissions, allowedOrganizationIds);
      if (!permissions.length) return NextResponse.json({ error: "Выдайте доступ хотя бы к одному разделу" }, { status: 400 });
      const existing = await pgGet<{ id: number }>(`SELECT id FROM public.fbs_portal_users WHERE LOWER(email)=LOWER(?)`, [email]);
      if (existing) return NextResponse.json({ error: "Пользователь с таким email уже существует" }, { status: 409 });
      const created = await createFbsPortalUser({
        actorUserId: session.user.id,
        email,
        name,
        isAdmin: body.isAdmin === true,
        permissions,
      });
      return NextResponse.json({ ok: true, ...created }, { status: 201 });
    }

    const userId = Number(body.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) return NextResponse.json({ error: "Некорректный пользователь" }, { status: 400 });
    if (userId === session.user.id) return NextResponse.json({ error: "Собственные права изменяются только другим администратором" }, { status: 400 });
    const manageable = await pgGet<{ id: number }>(`
      SELECT DISTINCT u.id FROM public.fbs_portal_users u
      JOIN public.fbs_portal_permissions p ON p.user_id=u.id
      WHERE u.id=? AND p.organization_id=ANY(?::bigint[])
    `, [userId, Array.from(allowedOrganizationIds)]);
    if (!manageable) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

    if (action === "reset_password") {
      const temporaryPassword = await resetFbsPortalPassword(session.user.id, userId);
      return NextResponse.json({ ok: true, temporaryPassword });
    }
    if (action === "update") {
      const name = String(body.name || "").trim().slice(0, 160);
      const status = body.status === "disabled" ? "disabled" : "active";
      const permissions = parsePermissions(body.permissions, allowedOrganizationIds);
      if (status === "active" && !permissions.length) return NextResponse.json({ error: "Активному сотруднику нужен хотя бы один раздел" }, { status: 400 });
      await updateFbsPortalUser({
        actorUserId: session.user.id,
        userId,
        name,
        status,
        isAdmin: body.isAdmin === true,
        permissions,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить пользователя";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
