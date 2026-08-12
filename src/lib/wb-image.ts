/**
 * Construct WB CDN image URL from nmID (article number).
 * No API call needed — URL is deterministic.
 */

function getBasketNumber(vol: number): string {
  // WB moved the newest 1.26–1.27B nmID ranges to a compact CDN layout that
  // no longer follows the older arithmetic progression below. Verified
  // against live product images on the user site on 2026-07-31.
  if (vol >= 12600 && vol <= 12699) return "44";
  if (vol >= 12700 && vol <= 12799) return "45";
  if (vol <= 143) return "01";
  if (vol <= 287) return "02";
  if (vol <= 431) return "03";
  if (vol <= 719) return "04";
  if (vol <= 1007) return "05";
  if (vol <= 1061) return "06";
  if (vol <= 1115) return "07";
  if (vol <= 1169) return "08";
  if (vol <= 1313) return "09";
  if (vol <= 1601) return "10";
  if (vol <= 1655) return "11";
  if (vol <= 1919) return "12";
  if (vol <= 2045) return "13";
  if (vol <= 2189) return "14";
  if (vol <= 2405) return "15";
  if (vol <= 2621) return "16";
  if (vol <= 2837) return "17";
  if (vol <= 3053) return "18";
  if (vol <= 3269) return "19";
  if (vol <= 3485) return "20";
  if (vol <= 3701) return "21";
  if (vol <= 3917) return "22";
  if (vol <= 4133) return "23";
  if (vol <= 4349) return "24";
  // After vol 4349, each basket covers 324 vols
  const basket = 25 + Math.floor((vol - 4350) / 324);
  return String(Math.min(99, basket)).padStart(2, "0");
}

export function getWbImageUrl(nmId: string | number, size: "small" | "medium" = "small"): string {
  const id = typeof nmId === "string" ? parseInt(nmId, 10) : nmId;
  if (isNaN(id) || id <= 0) return "";

  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const basket = getBasketNumber(vol);
  const dimensions = size === "small" ? "c246x328" : "c516x688";

  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/${dimensions}/1.webp`;
}

/**
 * Upgrade a URL already returned by WB without recalculating its basket.
 * Newer nmID ranges no longer follow one stable basket arithmetic rule, while
 * the URL stored with an order already contains the authoritative host/path.
 */
export function getWbImageUrlFromKnownSource(source: string, size: "small" | "medium" = "small"): string {
  const value = source.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith(".wbbasket.ru")) return "";
    const dimensions = size === "small" ? "c246x328" : "c516x688";
    const nextPath = url.pathname.replace(/\/images\/[^/]+\//, `/images/${dimensions}/`);
    if (nextPath === url.pathname && !url.pathname.includes(`/images/${dimensions}/`)) return "";
    url.pathname = nextPath;
    return url.toString();
  } catch {
    return "";
  }
}

export function getWbImageUrlCandidates(nmId: string | number, size: "small" | "medium" = "small"): string[] {
  const id = typeof nmId === "string" ? parseInt(nmId, 10) : nmId;
  if (isNaN(id) || id <= 0) return [];

  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const basket = Number(getBasketNumber(vol));
  const dimensions = size === "small" ? "c246x328" : "c516x688";
  const baskets = [basket, basket + 1, basket - 1, basket + 2, basket - 2]
    .filter((value) => value >= 1 && value <= 99);

  return Array.from(new Set(baskets)).map((value) =>
    `https://basket-${String(value).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${id}/images/${dimensions}/1.webp`
  );
}
