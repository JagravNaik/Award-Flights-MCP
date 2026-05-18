import type { BrowserContext } from "playwright";
import type { CollectedAward, CollectorConfig, CollectorRoute } from "../types.js";

export interface BrowserCollectorAdapter {
  id: string;
  name: string;
  programs?: string[];
  airlines?: string[];
  alliances?: string[];
  requiresLogin?: "no" | "optional" | "sometimes";
  coverageNotes?: string;
  collect(input: BrowserCollectInput): Promise<BrowserCollectOutput>;
}

export interface BrowserCollectInput {
  context: BrowserContext;
  route: CollectorRoute;
  config: CollectorConfig;
}

export interface BrowserCollectOutput {
  results: CollectedAward[];
  warnings: string[];
  debugArtifacts?: string[];
}
