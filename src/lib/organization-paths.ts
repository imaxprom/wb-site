import path from "node:path";
import { getActiveOrganizationId } from "@/lib/organization-context";

export const DATA_ROOT = path.join(process.cwd(), "data");

export function getOrganizationDataDir(organizationId = getActiveOrganizationId()): string {
  if (!organizationId) return DATA_ROOT;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Invalid organization id for data path");
  }
  return path.join(DATA_ROOT, "organizations", String(organizationId));
}

export function getOrganizationDataPath(
  fileName: string,
  organizationId = getActiveOrganizationId(),
): string {
  if (fileName !== path.basename(fileName)) throw new Error("Invalid organization data file name");
  return path.join(getOrganizationDataDir(organizationId), fileName);
}

export function getOrganizationTempPath(
  baseName: string,
  organizationId = getActiveOrganizationId(),
): string {
  if (baseName !== path.basename(baseName)) throw new Error("Invalid organization temp file name");
  if (!organizationId) return path.join("/tmp", baseName);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Invalid organization id for temp path");
  }
  return path.join("/tmp", `${baseName}-${organizationId}`);
}
