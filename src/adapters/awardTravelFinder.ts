import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AwardResult, AwardSearchInput, AwardSegment, Cabin, SourceStatus } from "../domain/types.js";
import { asArray, asNumber, asString } from "../utils/jsonPath.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

type AwardTravelFinderConfig = Pick<
  AppConfig,
  "awardTravelFinderEnabled" | "awardTravelFinderApiKey" | "awardTravelFinderBaseUrl" | "awardTravelFinderAirlines"
>;

export class AwardTravelFinderAdapter implements AwardSourceAdapter {
  readonly id = "award-travel-finder";
  readonly name = "Award Travel Finder REST API";
  readonly kind = "partner_api" as const;
  readonly supportsBatch = false;
  readonly supportsExplore = false;
  readonly rateLimitMs = 1000;

  constructor(private readonly config: AwardTravelFinderConfig) {}

  status(): SourceStatus {
    const health = !this.config.awardTravelFinderEnabled
      ? "disabled"
      : this.config.awardTravelFinderApiKey
        ? "ready"
        : "missing_credentials";

    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health,
      message: this.statusMessage(health),
      supportsLive: true,
      supportsCached: false,
      supportsBatch: this.supportsBatch,
      supportsExplore: this.supportsExplore,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    if (!this.config.awardTravelFinderEnabled) {
      return { results: [], warnings: [`${this.id} skipped because AWARD_TRAVEL_FINDER_ENABLED=false.`] };
    }
    if (!this.config.awardTravelFinderApiKey) {
      return { results: [], warnings: [`${this.id} skipped because AWARD_TRAVEL_FINDER_API_KEY is not configured.`] };
    }

    const origin = input.origins[0];
    const destination = input.destinations[0];
    const date = input.startDate;
    const foundAt = new Date().toISOString();
    const airlines = resolveAirlines(input, this.config.awardTravelFinderAirlines);
    const results: AwardResult[] = [];
    const warnings: string[] = [];

    for (const airline of airlines) {
      const url = new URL(`${trimRight(this.config.awardTravelFinderBaseUrl)}/${encodeURIComponent(airline)}/availability`);
      url.searchParams.set("departure_code", origin);
      url.searchParams.set("arrival_code", destination);
      url.searchParams.set("date", date);

      const response = await fetch(url, {
        headers: {
          "accept": "application/json",
          "user-agent": "award-flights-mcp/0.1",
          "x-api-key": this.config.awardTravelFinderApiKey
        }
      });
      const payload = await readJson(response);

      if (!response.ok) {
        warnings.push(`${this.id}/${airline} HTTP ${response.status}: ${formatError(payload)}`);
        continue;
      }

      results.push(
        ...normalizeAwardTravelFinderPayload(payload, {
          source: this.id,
          foundAt,
          airline,
          origin,
          destination,
          date,
          cabins: input.cabins
        })
      );
    }

    if (results.length === 0 && warnings.length === 0) {
      warnings.push(`${this.id} returned no award availability for ${origin}-${destination} on ${date}.`);
    }

    return { results, warnings };
  }

  private statusMessage(health: SourceStatus["health"]): string {
    if (health === "ready") {
      return `Configured. Searches ${this.config.awardTravelFinderAirlines.join(", ")} via Award Travel Finder REST JSON.`;
    }
    if (health === "disabled") {
      return "Disabled with AWARD_TRAVEL_FINDER_ENABLED=false.";
    }
    return "Set AWARD_TRAVEL_FINDER_API_KEY to enable Award Travel Finder REST JSON searches.";
  }
}

function normalizeAwardTravelFinderPayload(
  payload: unknown,
  context: { source: string; foundAt: string; airline: string; origin: string; destination: string; date: string; cabins?: Cabin[] }
): AwardResult[] {
  const root = asRecord(payload);
  const data = root.data ?? payload;
  const record = asRecord(data);

  if (Array.isArray(record.flights)) {
    return record.flights.flatMap((flight) => normalizeAtfFlight(flight, context));
  }

  if (record.availability) {
    return normalizeCabins(asRecord(record.availability).cabins ?? record.cabins, {
      ...context,
      date: asString(asRecord(record.availability).date) ?? context.date,
      raw: record.availability
    });
  }

  if (Array.isArray(record.availability)) {
    return record.availability.flatMap((item) =>
      normalizeCabins(asRecord(item).cabins, {
        ...context,
        date: asString(asRecord(item).date) ?? context.date,
        raw: item
      })
    );
  }

  if (record.cabins) {
    return normalizeCabins(record.cabins, { ...context, raw: data });
  }

  return [];
}

function normalizeAtfFlight(raw: unknown, context: { source: string; foundAt: string; airline: string; origin: string; destination: string; date: string; cabins?: Cabin[] }): AwardResult[] {
  const flight = asRecord(raw);
  const segments = normalizeSegments(flight.segments);
  const origin = asString(segments[0]?.origin) ?? context.origin;
  const destination = asString(segments[segments.length - 1]?.destination) ?? context.destination;
  const date = asString(segments[0]?.departsAt)?.slice(0, 10) ?? context.date;
  const durationMinutes = parseDurationMinutes(asString(flight.duration));

  return normalizeCabins(flight.cabins, {
    ...context,
    origin,
    destination,
    date,
    raw,
    segments,
    durationMinutes,
    flightNumbers: segments.map((segment) => segment.flightNumber).filter(Boolean) as string[]
  });
}

function normalizeCabins(
  cabinsValue: unknown,
  context: {
    source: string;
    foundAt: string;
    airline: string;
    origin: string;
    destination: string;
    date: string;
    cabins?: Cabin[];
    raw: unknown;
    segments?: AwardSegment[];
    durationMinutes?: number;
    flightNumbers?: string[];
  }
): AwardResult[] {
  const cabins = asRecord(cabinsValue);
  return Object.entries(cabins).flatMap(([rawCabin, value]) => {
    const cabin = normalizeCabin(rawCabin);
    if (context.cabins?.length && !context.cabins.includes(cabin)) {
      return [];
    }

    const item = asRecord(value);
    if (item.available === false || asNumber(item.seats) === 0) {
      return [];
    }

    return [
      {
        id: stableId([context.source, context.airline, context.origin, context.destination, context.date, cabin, asNumber(item.points)]),
        source: context.source,
        sourceKind: "partner_api" as const,
        foundAt: context.foundAt,
        confidence: "high" as const,
        program: humanizeSlug(context.airline),
        origin: context.origin,
        destination: context.destination,
        date: context.date,
        cabin,
        seats: asNumber(item.seats),
        mileageCost: asNumber(item.points ?? item.miles ?? item.mileage),
        taxes: asNumber(item.taxes),
        taxesCurrency: asString(item.taxes_currency ?? item.taxesCurrency),
        durationMinutes: context.durationMinutes,
        stops: context.segments?.length ? Math.max(0, context.segments.length - 1) : undefined,
        marketingAirline: context.airline,
        flightNumbers: context.flightNumbers ?? [],
        segments: context.segments ?? [],
        warnings: ["Live award result from Award Travel Finder. Verify on the loyalty program website before transferring points."],
        raw: context.raw
      }
    ];
  });
}

function normalizeSegments(value: unknown): AwardSegment[] {
  return asArray(value).map((segment) => {
    const item = asRecord(segment);
    return {
      origin: asString(item.from ?? item.origin),
      destination: asString(item.to ?? item.destination),
      marketingAirline: asString(item.airline ?? item.marketing_airline),
      operatingAirline: asString(item.operating_airline),
      flightNumber: asString(item.flight_number ?? item.flightNumber),
      aircraft: asString(item.aircraft),
      departsAt: asString(item.departure ?? item.departs_at),
      arrivesAt: asString(item.arrival ?? item.arrives_at),
      durationMinutes: parseDurationMinutes(asString(item.duration)),
      cabin: normalizeCabin(asString(item.cabin))
    };
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function resolveAirlines(input: AwardSearchInput, configured: string[]): string[] {
  const programs = input.programs?.map((program) => normalizeAirlineSlug(program)).filter(Boolean) ?? [];
  return programs.length ? programs : configured;
}

function normalizeAirlineSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeCabin(value: string | undefined): Cabin {
  if (value === "premium_economy") {
    return "premium";
  }
  if (value === "first" || value === "business" || value === "premium" || value === "economy") {
    return value;
  }
  return "economy";
}

function parseDurationMinutes(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const hours = /(\d+)\s*h/i.exec(value)?.[1];
  const minutes = /(\d+)\s*m/i.exec(value)?.[1];
  const total = Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return total > 0 ? total : asNumber(value);
}

function formatError(payload: unknown): string {
  const record = asRecord(payload);
  return asString(record.error) ?? asString(record.message) ?? JSON.stringify(payload).slice(0, 300);
}

function stableId(parts: Array<string | number | undefined>): string {
  return createHash("sha1").update(parts.filter((part) => part !== undefined && part !== "").join("|")).digest("hex").slice(0, 20);
}

function humanizeSlug(value: string): string {
  return value.replace(/_/g, " ");
}

function trimRight(value: string): string {
  return value.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
