import { AsyncLocalStorage } from "node:async_hooks";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export interface OrganizationContext {
  organizationId: number;
  userId: number | null;
  organizationRole: OrganizationRole;
  source: "request" | "job" | "legacy";
}

const organizationStorage = new AsyncLocalStorage<OrganizationContext>();

export function enterOrganizationContext(context: OrganizationContext): void {
  organizationStorage.enterWith(context);
}

export function runWithOrganizationContext<T>(
  context: OrganizationContext,
  fn: () => T,
): T {
  return organizationStorage.run(context, fn);
}

export function getOrganizationContext(): OrganizationContext | null {
  return organizationStorage.getStore() || null;
}

export function getActiveOrganizationId(): number | null {
  const fromRequest = organizationStorage.getStore()?.organizationId;
  if (Number.isSafeInteger(fromRequest) && Number(fromRequest) > 0) {
    return Number(fromRequest);
  }

  const fromJob = Number(process.env.MPHUB_ORGANIZATION_ID || "");
  if (Number.isSafeInteger(fromJob) && fromJob > 0) return fromJob;

  return null;
}

export function requireActiveOrganizationId(): number {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) {
    throw new Error("Organization context is required");
  }
  return organizationId;
}

export function getOrganizationSchemaName(organizationId = requireActiveOrganizationId()): string {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Invalid organization id for database schema");
  }
  return organizationId === 1 ? "public" : `organization_${organizationId}`;
}
