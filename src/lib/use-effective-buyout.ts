import { useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { calcBuyoutByArticle } from "@/lib/calculation-engine";

/**
 * Returns effective buyout rate for a given article.
 * In manual mode — returns global setting.
 * In auto mode — returns per-article rate from real orders.
 */
export function useEffectiveBuyout(): (articleWB: string) => number {
  const { settings, orders } = useData();
  const mode = settings.buyoutMode || "manual";

  const buyoutMap = useMemo(() => {
    if (mode === "manual" || orders.length === 0) return null;
    return calcBuyoutByArticle(orders, settings.buyoutRate, 30);
  }, [mode, orders, settings.buyoutRate]);

  return (articleWB: string) => {
    if (!buyoutMap) return settings.buyoutRate;
    return buyoutMap.get(articleWB) ?? settings.buyoutRate;
  };
}
