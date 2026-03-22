/**
 * Construct WB CDN image URL from nmID (article number).
 * No API call needed — URL is deterministic.
 */

function getBasketNumber(vol: number): string {
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
