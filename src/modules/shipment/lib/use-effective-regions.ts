import { useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { toRegionConfigs, getDefaultRegionGroups } from "@/modules/shipment/lib/engine";
import type { RegionConfig } from "@/types";

/**
 * Returns effective region configs — converts RegionGroup[] → RegionConfig[]
 * using manual percentages or auto-calculated from orders.
 * Use this in V1/V2/V3 instead of raw settings.regions.
 */
export function useEffectiveRegions(): RegionConfig[] {
  const { settings, orderAggregates } = useData();
  const mode = settings.regionMode || "manual";
  const groups = settings.regionGroups || getDefaultRegionGroups();
  return useMemo(() => toRegionConfigs(groups, mode, orderAggregates), [groups, mode, orderAggregates]);
}
