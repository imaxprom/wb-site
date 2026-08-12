/** Dedicated Marketplace token used only by the FBS stock manager. */
import fs from "node:fs";
import { writeSecretFileSync } from "@/lib/secure-file";
import { getActiveOrganizationId } from "@/lib/organization-context";
import { getOrganizationDataPath } from "@/lib/organization-paths";

const FILE_NAME = "wb-fbs-api-key.txt";

function tokenPath(): string {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) throw new Error("Organization context is required for FBS API token");
  return getOrganizationDataPath(FILE_NAME, organizationId);
}

export function getWbFbsApiKey(): string | null {
  try {
    const filePath = tokenPath();
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function setWbFbsApiKey(value: string): void {
  const token = value.trim();
  if (!token) throw new Error("FBS API-токен не может быть пустым");
  writeSecretFileSync(tokenPath(), token);
}

export function deleteWbFbsApiKey(): void {
  const filePath = tokenPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
