import { normalizeFbsScannerKeyboardText } from "@/lib/fbs-scanner-input";

type StickerSource = {
  sticker_barcode?: unknown;
  raw_json?: Record<string, unknown> | null;
};

function withoutScannerSuffix(value: string): string {
  return value.replace(/[\r\n]+$/g, "").trim();
}

function withoutAimPrefix(value: string): string {
  return value.replace(/^\](?:C[0123456]|d[0123456]|Q[0123456])/, "");
}

function addStickerVariants(target: Set<string>, value: string) {
  const clean = withoutAimPrefix(withoutScannerSuffix(value)).replace(/\s+/g, "");
  if (!clean) return;
  target.add(clean);
  if (clean.startsWith("*") && clean.endsWith("*") && clean.length > 2) target.add(clean.slice(1, -1));
  if (clean.startsWith("*") && clean.length > 1) target.add(clean.slice(1));
  if (clean.endsWith("*") && clean.length > 1) target.add(clean.slice(0, -1));
}

/**
 * Variants emitted by warehouse scanners. The physical WB label remains the
 * source of truth; these variants only repair scanner wrappers/AIM prefixes
 * and a Windows keyboard left in the Russian layout.
 */
export function fbsStickerScanVariants(rawValue: string): string[] {
  const exact = withoutScannerSuffix(rawValue);
  const keyboardFixed = normalizeFbsScannerKeyboardText(exact);
  const result = new Set<string>();
  addStickerVariants(result, exact);
  addStickerVariants(result, keyboardFixed);

  // Some scanners send the Russian-layout punctuation key as an extra dot or
  // slash (for example *ВЕР.ИьЦП -> *DTH.BmWG). Keep this as a last-resort
  // variant; the caller accepts it only when it identifies exactly one label
  // inside the current supply.
  for (const value of Array.from(result)) {
    if (/[./]/.test(value)) addStickerVariants(result, value.replace(/[./]/g, ""));
  }
  return Array.from(result).filter(Boolean);
}

export function fbsStoredStickerVariants(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const result = new Set<string>();
  addStickerVariants(result, value);
  return Array.from(result).filter(Boolean);
}

export function fbsStickerNumber(source: StickerSource): string {
  const value = source.raw_json?._mphubStickerNumber;
  return typeof value === "string" ? value.trim() : "";
}

export function fbsLabelText(source: StickerSource): string {
  const number = fbsStickerNumber(source);
  return number ? `этикетка ${number}` : "этикетка WB";
}
