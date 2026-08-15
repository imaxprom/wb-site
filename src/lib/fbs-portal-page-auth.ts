import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { FBS_PORTAL_COOKIE_NAME, getFbsPortalSessionFromToken, type FbsPortalModule } from "@/lib/fbs-portal-auth";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { verifyOrganizationCookie } from "@/lib/organization-cookie";
import { enterOrganizationContext } from "@/lib/organization-context";
import { getFbsKizArchiveEnabled } from "@/lib/fbs-kiz-archive-access";

export async function requireFbsPortalPageAccess(module: FbsPortalModule): Promise<void> {
  const requestHeaders = await headers();
  if (!isFbsPortalHostname(requestHeaders.get("host"))) return;
  const cookieStore = await cookies();
  const organizationId = verifyOrganizationCookie(cookieStore.get("mphub-org")?.value);
  const session = await getFbsPortalSessionFromToken(
    cookieStore.get(FBS_PORTAL_COOKIE_NAME)?.value || "",
    organizationId,
  );
  if (!session) redirect("/login");
  const allowed = module === "assembly" ? session.organization.can_assembly : session.organization.can_stock;
  if (!allowed) {
    const fallback = session.organization.can_assembly ? "/fbs" : session.organization.can_stock ? "/fbs-stock" : "/login";
    redirect(fallback);
  }
}

export async function requireFbsPortalAdminPage(): Promise<void> {
  const requestHeaders = await headers();
  if (!isFbsPortalHostname(requestHeaders.get("host"))) redirect("/fbs");
  const cookieStore = await cookies();
  const organizationId = verifyOrganizationCookie(cookieStore.get("mphub-org")?.value);
  const session = await getFbsPortalSessionFromToken(
    cookieStore.get(FBS_PORTAL_COOKIE_NAME)?.value || "",
    organizationId,
  );
  if (!session) redirect("/login");
  if (!session.user.is_admin) redirect(session.organization.can_assembly ? "/fbs" : "/fbs-stock");
}

export async function requireFbsKizArchivePageAccess(): Promise<void> {
  const requestHeaders = await headers();
  if (!isFbsPortalHostname(requestHeaders.get("host"))) return;
  const cookieStore = await cookies();
  const organizationId = verifyOrganizationCookie(cookieStore.get("mphub-org")?.value);
  const session = await getFbsPortalSessionFromToken(
    cookieStore.get(FBS_PORTAL_COOKIE_NAME)?.value || "",
    organizationId,
  );
  if (!session) redirect("/login");
  if (!session.organization.can_assembly) redirect(session.organization.can_stock ? "/fbs-stock" : "/login");
  enterOrganizationContext({
    organizationId: session.organization.id,
    userId: session.user.id,
    organizationRole: session.user.is_admin ? "admin" : "member",
    source: "request",
  });
  if (!await getFbsKizArchiveEnabled()) redirect("/fbs");
}
