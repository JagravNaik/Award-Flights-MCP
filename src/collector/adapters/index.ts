import type { BrowserCollectorAdapter } from "./types.js";
import { baRewardFlightFinderAdapter } from "./baRewardFlightFinder.js";
import { virginRewardSeatCheckerAdapter } from "./virginRewardSeatChecker.js";

const ADAPTERS = [baRewardFlightFinderAdapter, virginRewardSeatCheckerAdapter];

export function selectCollectorAdapters(ids: string[]): BrowserCollectorAdapter[] {
  const selected = ADAPTERS.filter((adapter) => ids.includes(adapter.id));
  const missing = ids.filter((id) => !ADAPTERS.some((adapter) => adapter.id === id));
  if (missing.length) {
    throw new Error(`Unknown collector adapters: ${missing.join(", ")}`);
  }
  return selected;
}
