import type { BrowserCollectorAdapter } from "./types.js";
import { baRewardFlightFinderAdapter } from "./baRewardFlightFinder.js";
import {
  airCanadaAeroplanAdapter,
  alaskaMileagePlanAdapter,
  americanAadvantageAdapter,
  deltaSkyMilesAdapter,
  emiratesSkywardsAdapter,
  flyingBlueAdapter,
  qantasFrequentFlyerAdapter,
  unitedMileagePlusAdapter
} from "./officialProgramSearch.js";
import { virginRewardSeatCheckerAdapter } from "./virginRewardSeatChecker.js";

const ADAPTERS = [
  baRewardFlightFinderAdapter,
  virginRewardSeatCheckerAdapter,
  unitedMileagePlusAdapter,
  americanAadvantageAdapter,
  deltaSkyMilesAdapter,
  airCanadaAeroplanAdapter,
  flyingBlueAdapter,
  alaskaMileagePlanAdapter,
  qantasFrequentFlyerAdapter,
  emiratesSkywardsAdapter
];

export function listCollectorAdapters(): BrowserCollectorAdapter[] {
  return ADAPTERS;
}

export function selectCollectorAdapters(ids: string[]): BrowserCollectorAdapter[] {
  const normalizedIds = ids.map((id) => id.trim()).filter(Boolean);
  if (!normalizedIds.length || normalizedIds.includes("all")) {
    return ADAPTERS;
  }

  const selected = ADAPTERS.filter((adapter) => normalizedIds.includes(adapter.id) || adapter.programs?.some((program) => normalizedIds.includes(program)));
  const missing = normalizedIds.filter((id) => !ADAPTERS.some((adapter) => adapter.id === id || adapter.programs?.includes(id)));
  if (missing.length) {
    throw new Error(`Unknown collector adapters: ${missing.join(", ")}. Available adapters: ${ADAPTERS.map((adapter) => adapter.id).join(", ")}, all`);
  }
  return selected;
}
