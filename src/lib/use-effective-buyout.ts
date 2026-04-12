import { useMemo, useEffect, useState } from "react";
import { useData } from "@/components/DataProvider";

interface BuyoutRateRow {
  articleWB: string;
  sales: number;
  returns: number;
  buyoutRate: number;
}

/**
 * Returns effective buyout rate for a given article.
 * In manual mode — returns global setting.
 * In auto mode — returns per-article rate from realization (sales − returns).
 */
export function useEffectiveBuyout(): (articleWB: string) => number {
  const { settings } = useData();
  const mode = settings.buyoutMode || "manual";
  const [serverRates, setServerRates] = useState<BuyoutRateRow[]>([]);

  useEffect(() => {
    if (mode !== "auto") return;
    fetch("/api/data/buyout-rates")
      .then(r => r.ok ? r.json() as Promise<BuyoutRateRow[]> : Promise.resolve([]))
      .then(setServerRates)
      .catch(() => setServerRates([]));
  }, [mode]);

  const buyoutMap = useMemo(() => {
    if (mode === "manual" || serverRates.length === 0) return null;
    const map = new Map<string, number>();
    for (const r of serverRates) {
      map.set(r.articleWB, r.buyoutRate);
    }
    return map;
  }, [mode, serverRates]);

  return (articleWB: string) => {
    if (!buyoutMap) return settings.buyoutRate;
    return buyoutMap.get(articleWB) ?? settings.buyoutRate;
  };
}

/** Hook to get all buyout rates for display in settings */
export function useBuyoutRates(): BuyoutRateRow[] {
  const { settings } = useData();
  const mode = settings.buyoutMode || "manual";
  const [rates, setRates] = useState<BuyoutRateRow[]>([]);

  useEffect(() => {
    if (mode !== "auto") return;
    fetch("/api/data/buyout-rates")
      .then(r => r.ok ? r.json() as Promise<BuyoutRateRow[]> : Promise.resolve([]))
      .then(setRates)
      .catch(() => setRates([]));
  }, [mode]);

  return rates;
}
