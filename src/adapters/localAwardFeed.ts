import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import type { AwardResult, AwardSearchInput, Cabin, SourceStatus } from "../domain/types.js";
import { extractResultItems, normalizeGenericJsonResult } from "./normalizers.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

type LocalAwardFeedConfig = Pick<AppConfig, "localAwardFeedEnabled" | "localAwardFeedPath">;

const FIELD_MAP: Record<string, string> = {
  id: "id",
  origin: "origin",
  destination: "destination",
  date: "date",
  program: "program",
  marketingAirline: "airline",
  operatingAirline: "operating_airline",
  flightNumbers: "flight_numbers",
  mileageCost: "miles",
  taxes: "taxes.amount",
  taxesCurrency: "taxes.currency",
  cashPrice: "cash_price.amount",
  cashCurrency: "cash_price.currency",
  centsPerPoint: "cpp",
  seats: "seats",
  cabin: "cabin",
  aircraft: "aircraft",
  fareClass: "fare_class",
  premiumCabinPercent: "premium_cabin_percent",
  departsAt: "departure",
  durationMinutes: "duration_minutes",
  stops: "stops",
  segments: "segments",
  bookingUrl: "booking_url",
  rawUrl: "raw_url"
};

export class LocalAwardFeedAdapter implements AwardSourceAdapter {
  readonly id = "local-award-feed";
  readonly name = "Local Award JSON Feed";
  readonly kind = "manual" as const;
  readonly supportsBatch = true;
  readonly supportsExplore = false;
  readonly rateLimitMs = 0;
  private readonly path: string;

  constructor(private readonly config: LocalAwardFeedConfig) {
    this.path = resolve(config.localAwardFeedPath);
  }

  status(): SourceStatus {
    const health = this.statusHealth();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health,
      message: this.statusMessage(health),
      supportsLive: false,
      supportsCached: true,
      supportsBatch: this.supportsBatch,
      supportsExplore: this.supportsExplore,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    if (!this.config.localAwardFeedEnabled) {
      return { results: [], warnings: [`${this.id} skipped because LOCAL_AWARD_FEED_ENABLED=false.`] };
    }
    if (!existsSync(this.path)) {
      return { results: [], warnings: [`${this.id} skipped because ${this.path} does not exist.`] };
    }

    const foundAt = new Date().toISOString();
    const payload = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
    const items = extractResultItems(payload);
    const results = items
      .map((item) =>
        normalizeGenericJsonResult(item, FIELD_MAP, {
          source: this.id,
          sourceKind: this.kind,
          foundAt,
          confidence: "low"
        })
      )
      .filter((result) => matchesSearch(result, input))
      .map((result) => ({
        ...result,
        warnings: [
          ...result.warnings,
          "Local JSON feed result. It is only as current as the feed file and must be verified on the loyalty program website."
        ]
      }));

    return {
      results: results.slice(0, input.maxResults),
      warnings: results.length
        ? [`${this.id} read ${this.path}. Results are local feed leads, not guaranteed live inventory.`]
        : [`${this.id} found no matching local feed results in ${this.path}.`]
    };
  }

  private statusHealth(): SourceStatus["health"] {
    if (!this.config.localAwardFeedEnabled) {
      return "disabled";
    }
    return existsSync(this.path) ? "ready" : "error";
  }

  private statusMessage(health: SourceStatus["health"]): string {
    if (health === "ready") {
      return `Ready. Reads credential-free award leads from ${this.path}.`;
    }
    if (health === "disabled") {
      return "Disabled with LOCAL_AWARD_FEED_ENABLED=false.";
    }
    return `LOCAL_AWARD_FEED_PATH does not exist: ${this.path}`;
  }
}

function matchesSearch(result: AwardResult, input: AwardSearchInput): boolean {
  return (
    matchesCode(input.origins, result.origin) &&
    matchesCode(input.destinations, result.destination) &&
    result.date >= input.startDate &&
    result.date <= input.endDate &&
    matchesCabin(input.cabins, result.cabin) &&
    (result.seats === undefined || result.seats >= input.passengers)
  );
}

function matchesCode(codes: string[], candidate: string): boolean {
  const normalized = candidate.trim().toUpperCase();
  return codes.some((code) => code.trim().toUpperCase() === normalized);
}

function matchesCabin(cabins: Cabin[] | undefined, candidate: string | undefined): boolean {
  if (!cabins?.length) {
    return true;
  }
  return candidate ? cabins.some((cabin) => cabin === candidate.toLowerCase()) : false;
}
