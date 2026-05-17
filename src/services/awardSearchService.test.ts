import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { AwardSearchInput, SourceStatus } from "../domain/types.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "../adapters/types.js";
import { AwardSearchService } from "./awardSearchService.js";

class FakeAdapter implements AwardSourceAdapter {
  readonly id = "fake";
  readonly name = "Fake Adapter";
  readonly kind = "public_json" as const;
  readonly supportsBatch = false;
  readonly supportsExplore = false;
  readonly rateLimitMs = 0;
  calls = 0;

  status(): SourceStatus {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health: "ready",
      supportsLive: false,
      supportsCached: false,
      supportsBatch: this.supportsBatch,
      supportsExplore: this.supportsExplore,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    this.calls += 1;
    return {
      results: [
        {
          id: `${input.origins[0]}-${input.destinations[0]}-${input.startDate}`,
          source: this.id,
          sourceKind: this.kind,
          foundAt: "2026-05-17T00:00:00.000Z",
          confidence: "low",
          origin: input.origins[0],
          destination: input.destinations[0],
          date: input.startDate,
          cabin: input.cabins?.[0],
          mileageCost: 50000,
          segments: [],
          warnings: []
        }
      ],
      warnings: []
    };
  }
}

const config: AppConfig = {
  transport: "stdio",
  httpPort: 3000,
  localAwardFeedEnabled: false,
  localAwardFeedPath: "./config/sample-awards.json",
  seatsAeroEnabled: false,
  aerobaseEnabled: true,
  aerobaseBaseUrl: "https://aerobase.app/api",
  awardTravelFinderEnabled: true,
  awardTravelFinderBaseUrl: "https://awardtravelfinder.com/api/v1",
  awardTravelFinderAirlines: ["british_airways"],
  awardFlightDailyEnabled: false,
  awardFlightDailyMcpUrl: "https://awardflightdaily.com/mcp-server/mcp",
  apifyEnabled: true,
  apifyActorId: "igolaizola/flight-award-scraper",
  apifyBaseUrl: "https://api.apify.com/v2",
  apifyMaxItems: 100,
  cacheTtlSeconds: 900,
  defaultConcurrency: 2,
  defaultDelayMs: 0,
  maxBruteForceQueries: 10,
  alertsPath: "./data/test-alerts.json",
  historyPath: "./data/test-history.json",
  pointsWalletPath: "./data/test-points-wallet.json",
  hotelAlertsPath: "./data/test-hotel-alerts.json",
  publicJsonAdapters: []
};

const baseInput: AwardSearchInput = {
  origins: ["JFK", "EWR"],
  destinations: ["LHR"],
  startDate: "2026-06-01",
  endDate: "2026-06-02",
  cabins: ["business"],
  passengers: 1,
  maxResults: 50,
  includeTrips: true,
  onlyDirectFlights: false,
  strategy: "auto",
  bruteForce: {
    enabled: false,
    maxQueries: 10,
    concurrency: 2,
    delayMs: 0
  }
};

describe("AwardSearchService", () => {
  it("brute-forces non-batch adapters by route and date", async () => {
    const adapter = new FakeAdapter();
    const service = new AwardSearchService([adapter], config);

    const response = await service.search(baseInput);

    expect(adapter.calls).toBe(4);
    expect(response.results).toHaveLength(4);
    expect(response.diagnostics.attemptedQueries).toBe(4);
    expect(response.diagnostics.warnings[0]).toMatch(/brute-force/);
  });

  it("blocks brute-force searches above the configured cap", async () => {
    const adapter = new FakeAdapter();
    const service = new AwardSearchService([adapter], { ...config, maxBruteForceQueries: 1 });

    await expect(service.search({ ...baseInput, bruteForce: { ...baseInput.bruteForce, maxQueries: 10 } })).rejects.toThrow(
      /above the configured limit/
    );
  });
});
