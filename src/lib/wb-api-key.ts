/**
 * Single source of truth for WB API key.
 * All server-side code must use these functions instead of reading files directly.
 */
import fs from "fs";
import path from "path";
import { writeSecretFileSync } from "./secure-file";

const KEY_PATH = path.join(process.cwd(), "data", "wb-api-key.txt");

/** Read WB API key. Returns null if not configured. */
export function getWbApiKey(): string | null {
  try {
    if (fs.existsSync(KEY_PATH)) {
      const key = fs.readFileSync(KEY_PATH, "utf-8").trim();
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
  writeSecretFileSync(KEY_PATH, key.trim());
}

/** Delete WB API key. */
export function deleteWbApiKey(): void {
  try {
    if (fs.existsSync(KEY_PATH)) fs.unlinkSync(KEY_PATH);
  } catch { /* ignore */ }
}

/** Check if key is configured (without reading it). */
export function hasWbApiKey(): boolean {
  return getWbApiKey() !== null;
}
