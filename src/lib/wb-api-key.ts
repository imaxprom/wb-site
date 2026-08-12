/**
 * Single source of truth for WB API key.
 * All server-side code must use these functions instead of reading files directly.
 */
import fs from "fs";
import path from "path";
import { writeSecretFileSync } from "./secure-file";
import { getActiveOrganizationId } from "./organization-context";
import { getOrganizationDataPath } from "./organization-paths";

const KEY_PATH = path.join(process.cwd(), "data", "wb-api-key.txt");

function activeKeyPath(): string {
  const organizationId = getActiveOrganizationId();
  return organizationId ? getOrganizationDataPath("wb-api-key.txt", organizationId) : KEY_PATH;
}

/** Read WB API key. Returns null if not configured. */
export function getWbApiKey(): string | null {
  try {
    const organizationId = getActiveOrganizationId();
    const scopedPath = activeKeyPath();
    const candidatePaths = [scopedPath];
    // Backward-compatible bridge for the existing legal entity. New entities
    // never fall back to the global credential.
    if (organizationId === 1 && scopedPath !== KEY_PATH) candidatePaths.push(KEY_PATH);
    for (const candidatePath of candidatePaths) {
      if (!fs.existsSync(candidatePath)) continue;
      const key = fs.readFileSync(candidatePath, "utf-8").trim();
      return key || null;
    }
  } catch { /* ignore */ }
  return null;
}

/** Resolve WB API key for proxy routes: explicit request header wins, then stored server key. */
export function getWbApiKeyFromRequest(
  headers: { get(name: string): string | null },
  headerName = "x-wb-api-key"
): string | null {
  return headers.get(headerName) || getWbApiKey();
}

/** Save WB API key. */
export function setWbApiKey(key: string): void {
  const organizationId = getActiveOrganizationId();
  writeSecretFileSync(activeKeyPath(), key.trim());
  if (organizationId === 1) writeSecretFileSync(KEY_PATH, key.trim());
}

/** Delete WB API key. */
export function deleteWbApiKey(): void {
  try {
    const organizationId = getActiveOrganizationId();
    const scopedPath = activeKeyPath();
    if (fs.existsSync(scopedPath)) fs.unlinkSync(scopedPath);
    if (organizationId === 1 && fs.existsSync(KEY_PATH)) fs.unlinkSync(KEY_PATH);
  } catch { /* ignore */ }
}

/** Check if key is configured (without reading it). */
export function hasWbApiKey(): boolean {
  return getWbApiKey() !== null;
}
