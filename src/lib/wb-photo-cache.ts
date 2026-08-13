import crypto from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOrganizationDataDir } from "@/lib/organization-paths";
import { requireActiveOrganizationId } from "@/lib/organization-context";
import { getWbApiKey } from "@/lib/wb-api-key";

const CONTENT_API_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";
const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PHOTO_REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type PhotoCatalogFile = {
  fetchedAt: string;
  photos: Record<string, string>;
};

type MemoryCatalog = PhotoCatalogFile & { loadedAt: number };

export type CachedWbPhoto = {
  bytes: Uint8Array;
  cacheState: "HIT" | "MISS" | "STALE";
};

const memoryCatalogs = new Map<number, MemoryCatalog>();
const catalogRefreshes = new Map<number, Promise<PhotoCatalogFile>>();
const photoRefreshes = new Map<string, Promise<Uint8Array | null>>();

function cacheDirectory(organizationId: number): string {
  return path.join(getOrganizationDataDir(organizationId), "wb-photo-cache");
}

function photoPath(organizationId: number, nmId: number): string {
  return path.join(cacheDirectory(organizationId), `${nmId}-1-c246x328.webp`);
}

function catalogPath(organizationId: number): string {
  return path.join(cacheDirectory(organizationId), "catalog.json");
}

function isFresh(fetchedAt: string): boolean {
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < CATALOG_MAX_AGE_MS;
}

function validPhotoUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".wbbasket.ru")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

async function atomicWrite(filePath: string, data: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readCatalog(organizationId: number): Promise<PhotoCatalogFile | null> {
  const memory = memoryCatalogs.get(organizationId);
  if (memory && Date.now() - memory.loadedAt < CATALOG_MAX_AGE_MS) return memory;
  try {
    const parsed = JSON.parse(await readFile(catalogPath(organizationId), "utf8")) as PhotoCatalogFile;
    if (!parsed || typeof parsed.fetchedAt !== "string" || typeof parsed.photos !== "object") return null;
    const catalog = { fetchedAt: parsed.fetchedAt, photos: parsed.photos, loadedAt: Date.now() };
    memoryCatalogs.set(organizationId, catalog);
    return catalog;
  } catch {
    return null;
  }
}

async function fetchCatalogPage(
  apiKey: string,
  cursor: { limit: number; updatedAt?: string; nmID?: number },
): Promise<{
  cards: Array<{ nmID?: number; photos?: Array<{ c246x328?: string; c516x688?: string; big?: string }> }>;
  cursor?: { updatedAt?: string; nmID?: number };
}> {
  const response = await fetch(CONTENT_API_URL, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "User-Agent": "MpHub-WB-Photo-Cache/1.0",
    },
    body: JSON.stringify({
      settings: {
        sort: { ascending: false },
        cursor,
        filter: { withPhoto: -1 },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`WB Content API returned HTTP ${response.status}`);
  }
  return response.json();
}

async function refreshCatalog(organizationId: number): Promise<PhotoCatalogFile> {
  const current = catalogRefreshes.get(organizationId);
  if (current) return current;

  const refresh = (async () => {
    const apiKey = getWbApiKey();
    if (!apiKey) throw new Error("WB API key is not configured");

    // Keep every previously known good URL. If WB temporarily omits a card or
    // its photos array, a successful but incomplete catalog response must not
    // erase our last-known-good source.
    const previous = await readCatalog(organizationId);
    const photos: Record<string, string> = { ...(previous?.photos || {}) };
    let cursor: { limit: number; updatedAt?: string; nmID?: number } = { limit: 100 };
    for (let page = 0; page < 100; page += 1) {
      const payload = await fetchCatalogPage(apiKey, cursor);
      const cards = Array.isArray(payload.cards) ? payload.cards : [];
      for (const card of cards) {
        const nmId = Number(card.nmID);
        if (!Number.isSafeInteger(nmId) || nmId <= 0) continue;
        const photo = card.photos?.[0];
        const url = validPhotoUrl(photo?.c246x328 || photo?.c516x688 || photo?.big);
        if (url) photos[String(nmId)] = url;
      }
      const nextUpdatedAt = payload.cursor?.updatedAt;
      const nextNmId = Number(payload.cursor?.nmID || 0);
      if (cards.length < 100 || !nextUpdatedAt || !nextNmId) break;
      cursor = { limit: 100, updatedAt: nextUpdatedAt, nmID: nextNmId };
      await new Promise((resolve) => setTimeout(resolve, 650));
    }

    const result: PhotoCatalogFile = { fetchedAt: new Date().toISOString(), photos };
    await atomicWrite(catalogPath(organizationId), JSON.stringify(result));
    memoryCatalogs.set(organizationId, { ...result, loadedAt: Date.now() });
    return result;
  })();

  catalogRefreshes.set(organizationId, refresh);
  try {
    return await refresh;
  } finally {
    catalogRefreshes.delete(organizationId);
  }
}

async function resolvePhotoUrl(organizationId: number, nmId: number, forceRefresh = false): Promise<string> {
  const cached = await readCatalog(organizationId);
  if (!forceRefresh && cached && isFresh(cached.fetchedAt)) return validPhotoUrl(cached.photos[String(nmId)]);
  try {
    const refreshed = await refreshCatalog(organizationId);
    return validPhotoUrl(refreshed.photos[String(nmId)]);
  } catch {
    return validPhotoUrl(cached?.photos[String(nmId)]);
  }
}

async function downloadPhoto(url: string): Promise<Uint8Array | null> {
  const safeUrl = validPhotoUrl(url);
  if (!safeUrl) return null;
  try {
    const response = await fetch(safeUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "MpHub-WB-Photo-Cache/1.0" },
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !isWebp(bytes)) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function refreshPhoto(organizationId: number, nmId: number): Promise<Uint8Array | null> {
  const key = `${organizationId}:${nmId}`;
  const current = photoRefreshes.get(key);
  if (current) return current;

  const refresh = (async () => {
    let url = await resolvePhotoUrl(organizationId, nmId);
    let bytes = await downloadPhoto(url);
    if (!bytes) {
      url = await resolvePhotoUrl(organizationId, nmId, true);
      bytes = await downloadPhoto(url);
    }
    if (!bytes) return null;
    await atomicWrite(photoPath(organizationId, nmId), bytes);
    return bytes;
  })();

  photoRefreshes.set(key, refresh);
  try {
    return await refresh;
  } finally {
    photoRefreshes.delete(key);
  }
}

export async function getCachedWbPhoto(nmId: number): Promise<CachedWbPhoto | null> {
  if (!Number.isSafeInteger(nmId) || nmId <= 0) return null;
  const organizationId = requireActiveOrganizationId();
  const filePath = photoPath(organizationId, nmId);
  try {
    const details = await stat(filePath);
    const bytes = new Uint8Array(await readFile(filePath));
    if (details.isFile() && bytes.length > 0 && isWebp(bytes)) {
      if (Date.now() - details.mtimeMs > PHOTO_REFRESH_AGE_MS) void refreshPhoto(organizationId, nmId);
      return { bytes, cacheState: "HIT" };
    }
  } catch {
    // First request for this product: resolve it through the official WB API.
  }

  const bytes = await refreshPhoto(organizationId, nmId);
  if (bytes) return { bytes, cacheState: "MISS" };

  // A concurrent or interrupted refresh may have completed after our first read.
  try {
    const stale = new Uint8Array(await readFile(filePath));
    if (stale.length > 0 && isWebp(stale)) return { bytes: stale, cacheState: "STALE" };
  } catch {
    // No last-known-good image exists for this product.
  }
  return null;
}
