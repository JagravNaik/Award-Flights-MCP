import type { AwardExploreInput, AwardResult, AwardSearchInput, AwardVerifyInput, SourceStatus } from "../domain/types.js";
import { extractCursor, extractResultItems, normalizeSeatsAeroItem } from "./normalizers.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

const BASE_URL = "https://seats.aero/partnerapi";

export class SeatsAeroAdapter implements AwardSourceAdapter {
  readonly id = "seats-aero";
  readonly name = "Seats.aero Partner API";
  readonly kind = "partner_api" as const;
  readonly supportsBatch = true;
  readonly supportsExplore = true;
  readonly rateLimitMs = 100;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly enabled = Boolean(apiKey)
  ) {}

  status(): SourceStatus {
    const health = !this.enabled ? "disabled" : this.apiKey ? "ready" : "missing_credentials";
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health,
      message: this.statusMessage(health),
      supportsLive: false,
      supportsCached: true,
      supportsBatch: true,
      supportsExplore: true,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    if (!this.enabled) {
      return { results: [], warnings: ["Seats.aero adapter skipped because SEATS_AERO_ENABLED=false."] };
    }
    if (!this.apiKey) {
      return { results: [], warnings: ["Seats.aero adapter skipped because SEATS_AERO_API_KEY is not configured."] };
    }

    const warnings: string[] = [];
    const params = new URLSearchParams({
      origin_airport: input.origins.join(","),
      destination_airport: input.destinations.join(","),
      start_date: input.startDate,
      end_date: input.endDate,
      take: String(Math.min(1000, Math.max(10, input.maxResults))),
      include_trips: String(input.includeTrips),
      only_direct_flights: String(input.onlyDirectFlights)
    });

    if (input.cabins?.length) {
      params.set("cabins", input.cabins.join(","));
    }
    if (input.programs?.length) {
      params.set("sources", input.programs.join(","));
    }

    const payload = await this.getJson(`${BASE_URL}/search?${params.toString()}`);
    const foundAt = new Date().toISOString();
    const items = extractResultItems(payload);
    const results = items.flatMap((item) =>
      normalizeSeatsAeroItem(item, {
        source: this.id,
        sourceKind: this.kind,
        foundAt,
        defaultOrigin: input.origins.length === 1 ? input.origins[0] : undefined,
        defaultDestination: input.destinations.length === 1 ? input.destinations[0] : undefined,
        defaultDate: input.startDate === input.endDate ? input.startDate : undefined,
        defaultCabin: input.cabins?.length === 1 ? input.cabins[0] : undefined
      })
    );

    if (results.length === 0) {
      warnings.push("Seats.aero returned no normalized results for this query.");
    }

    return { results, warnings };
  }

  async explore(input: AwardExploreInput): Promise<AdapterSearchResponse> {
    if (!this.enabled) {
      return { results: [], warnings: ["Seats.aero adapter skipped because SEATS_AERO_ENABLED=false."] };
    }
    if (!this.apiKey) {
      return { results: [], warnings: ["Seats.aero adapter skipped because SEATS_AERO_API_KEY is not configured."] };
    }

    const warnings: string[] = [];
    const programs = input.programs?.length ? input.programs : ["aeroplan", "united", "lifemiles", "virginatlantic"];
    const cabins = input.cabins?.length ? input.cabins : [undefined];
    const perProgramTake = Math.min(1000, Math.max(10, Math.ceil(input.maxResults / programs.length)));
    const foundAt = new Date().toISOString();
    const results: AwardResult[] = [];

    for (const program of programs) {
      for (const cabin of cabins) {
        const params = new URLSearchParams({
          source: program,
          start_date: input.startDate,
          end_date: input.endDate,
          take: String(perProgramTake)
        });

        if (cabin) {
          params.set("cabin", cabin);
        }
        if (input.originRegion) {
          params.set("origin_region", input.originRegion);
        }
        if (input.destinationRegion) {
          params.set("destination_region", input.destinationRegion);
        }

        const payload = await this.getJson(`${BASE_URL}/availability?${params.toString()}`);
        const items = extractResultItems(payload);
        results.push(
          ...items.flatMap((item) =>
            normalizeSeatsAeroItem(item, {
              source: this.id,
              sourceKind: this.kind,
              foundAt,
              defaultCabin: cabin
            })
          )
        );

        const cursor = extractCursor(payload);
        if (cursor !== undefined && results.length >= input.maxResults) {
          warnings.push("Explore stopped after reaching maxResults; more paginated results may be available.");
        }
      }
    }

    return { results: results.slice(0, input.maxResults), warnings };
  }

  async verify(input: AwardVerifyInput): Promise<AdapterSearchResponse> {
    const searchInput: AwardSearchInput = {
      origins: [input.origin],
      destinations: [input.destination],
      startDate: input.date,
      endDate: input.date,
      cabins: input.cabin ? [input.cabin] : undefined,
      passengers: input.passengers,
      programs: input.program ? [input.program] : undefined,
      maxResults: 50,
      includeTrips: true,
      onlyDirectFlights: false,
      strategy: "direct",
      bruteForce: {
        enabled: false,
        maxQueries: 1,
        concurrency: 1,
        delayMs: this.rateLimitMs
      }
    };

    const response = await this.search(searchInput);
    const flightNumber = input.flightNumber;
    const filtered = flightNumber
      ? response.results.filter((result) => result.flightNumbers?.some((flight) => sameFlight(flight, flightNumber)))
      : response.results;

    return {
      results: filtered.map((result) => ({
        ...result,
        confidence: "medium",
        warnings: [...result.warnings, "Verify this on the loyalty program website before transferring points."]
      })),
      warnings: response.warnings
    };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        "Partner-Authorization": this.apiKey ?? "",
        "accept": "application/json",
        "user-agent": "award-flights-mcp/0.1"
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Seats.aero API error ${response.status}: ${body.slice(0, 200)}`);
    }

    return response.json() as Promise<unknown>;
  }

  private statusMessage(health: SourceStatus["health"]): string {
    if (health === "ready") {
      return "Configured. Uses Seats.aero cached API; live search requires commercial Seats.aero access and is not used here.";
    }
    if (health === "disabled") {
      return "Disabled by default. Set SEATS_AERO_ENABLED=true and SEATS_AERO_API_KEY to enable cached Seats.aero searches.";
    }
    return "SEATS_AERO_ENABLED=true but SEATS_AERO_API_KEY is not configured.";
  }
}

function sameFlight(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return normalize(left) === normalize(right);
}
