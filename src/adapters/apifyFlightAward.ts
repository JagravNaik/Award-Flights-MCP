import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AwardResult, AwardSearchInput, AwardSegment, Cabin, SourceStatus } from "../domain/types.js";
import { asArray, asNumber, asString } from "../utils/jsonPath.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

type ApifyFlightAwardConfig = Pick<
  AppConfig,
  "apifyEnabled" | "apifyApiToken" | "apifyActorId" | "apifyBaseUrl" | "apifyMaxItems"
>;

export class ApifyFlightAwardAdapter implements AwardSourceAdapter {
  readonly id = "apify-flight-award-scraper";
  readonly name = "Apify Flight Award Scraper";
  readonly kind = "partner_api" as const;
  readonly supportsBatch = true;
  readonly supportsExplore = false;
  readonly rateLimitMs = 1000;

  constructor(private readonly config: ApifyFlightAwardConfig) {}

  status(): SourceStatus {
    const health = !this.config.apifyEnabled ? "disabled" : this.config.apifyApiToken ? "ready" : "missing_credentials";
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
    if (!this.config.apifyEnabled) {
      return { results: [], warnings: [`${this.id} skipped because APIFY_FLIGHT_AWARD_ENABLED=false.`] };
    }
    if (!this.config.apifyApiToken) {
      return { results: [], warnings: [`${this.id} skipped because APIFY_API_TOKEN is not configured.`] };
    }

    const url = `${trimRight(this.config.apifyBaseUrl)}/acts/${encodeActorId(this.config.apifyActorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(
      this.config.apifyApiToken
    )}`;
    const cabin = input.cabins?.length === 1 ? input.cabins[0] : undefined;
    const body = {
      maxItems: Math.min(this.config.apifyMaxItems, Math.max(1, input.maxResults)),
      origins: input.origins,
      destinations: input.destinations,
      startDate: input.startDate,
      endDate: input.endDate,
      cabin: cabin ?? "",
      issuers: input.programs ?? [],
      sortBy: cabin ?? ""
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "award-flights-mcp/0.1"
      },
      body: JSON.stringify(body)
    });
    const payload = await readJson(response);

    if (!response.ok) {
      return { results: [], warnings: [`${this.id} HTTP ${response.status}: ${formatError(payload)}`] };
    }

    const foundAt = new Date().toISOString();
    const items = Array.isArray(payload) ? payload : asArray(asRecord(payload).items ?? asRecord(payload).data);
    const results = items.flatMap((item) => normalizeApifyItem(item, { foundAt, source: this.id, cabins: input.cabins }));

    return {
      results,
      warnings: results.length ? [] : [`${this.id} returned no award availability for this query.`]
    };
  }

  private statusMessage(health: SourceStatus["health"]): string {
    if (health === "ready") {
      return `Configured. Runs Apify actor ${this.config.apifyActorId} and reads dataset JSON.`;
    }
    if (health === "disabled") {
      return "Disabled with APIFY_FLIGHT_AWARD_ENABLED=false.";
    }
    return "Set APIFY_API_TOKEN to enable Apify Flight Award Scraper searches.";
  }
}

function normalizeApifyItem(raw: unknown, context: { source: string; foundAt: string; cabins?: Cabin[] }): AwardResult[] {
  const item = asRecord(raw);
  const route = {
    origin: asString(item.origin) ?? "",
    destination: asString(item.destination) ?? "",
    date: asString(item.date) ?? "",
    program: asString(item.issuerName ?? item.issuer),
    raw
  };
  const itineraries = asArray(item.itineraries);

  if (itineraries.length > 0) {
    return itineraries.flatMap((itinerary) => normalizeApifyItinerary(itinerary, route, context));
  }

  return asArray(item.cabins).flatMap((cabinValue) => {
    const cabin = normalizeApifyCabin(cabinValue);
    if (!cabin || shouldSkipCabin(cabin.cabin, context.cabins)) {
      return [];
    }
    return [
      baseResult({
        source: context.source,
        foundAt: context.foundAt,
        origin: route.origin,
        destination: route.destination,
        date: route.date,
        program: route.program,
        cabin: cabin.cabin,
        mileageCost: cabin.mileageCost,
        taxes: cabin.taxes,
        seats: cabin.seats,
        stops: cabin.direct === false ? 1 : 0,
        raw
      })
    ];
  });
}

function normalizeApifyItinerary(
  raw: unknown,
  route: { origin: string; destination: string; date: string; program?: string; raw: unknown },
  context: { source: string; foundAt: string; cabins?: Cabin[] }
): AwardResult[] {
  const item = asRecord(raw);
  const segments = normalizeSegments(item.segments);
  const origin = asString(item.origin) ?? route.origin;
  const destination = asString(item.destination) ?? route.destination;
  const date = asString(item.departure)?.slice(0, 10) ?? route.date;
  const flightNumbers = asArray(item.flightNumbers).map(asString).filter(Boolean) as string[];
  const aircraft = asArray(item.aircrafts).map(asString).filter(Boolean).join(", ") || undefined;

  return asArray(item.cabins).flatMap((cabinValue) => {
    const cabin = normalizeApifyCabin(cabinValue);
    if (!cabin || shouldSkipCabin(cabin.cabin, context.cabins)) {
      return [];
    }

    return [
      baseResult({
        source: context.source,
        foundAt: context.foundAt,
        origin,
        destination,
        date,
        program: route.program,
        cabin: cabin.cabin,
        mileageCost: cabin.mileageCost,
        taxes: cabin.taxes,
        seats: cabin.seats,
        durationMinutes: asNumber(item.totalDuration),
        stops: asNumber(item.stops),
        flightNumbers,
        aircraft,
        segments,
        raw
      })
    ];
  });
}

function baseResult(input: {
  source: string;
  foundAt: string;
  origin: string;
  destination: string;
  date: string;
  program?: string;
  cabin: Cabin;
  mileageCost?: number;
  taxes?: number;
  seats?: number;
  durationMinutes?: number;
  stops?: number;
  flightNumbers?: string[];
  aircraft?: string;
  segments?: AwardSegment[];
  raw: unknown;
}): AwardResult {
  return {
    id: stableId([input.source, input.program, input.origin, input.destination, input.date, input.cabin, input.mileageCost, input.flightNumbers?.join(",")]),
    source: input.source,
    sourceKind: "partner_api",
    foundAt: input.foundAt,
    confidence: "medium",
    program: input.program,
    origin: input.origin,
    destination: input.destination,
    date: input.date,
    cabin: input.cabin,
    seats: input.seats,
    mileageCost: input.mileageCost,
    taxes: minorToMajor(input.taxes),
    durationMinutes: input.durationMinutes,
    stops: input.stops,
    flightNumbers: input.flightNumbers ?? [],
    aircraft: input.aircraft,
    segments: input.segments ?? [],
    warnings: ["Apify scraper result. Verify availability on the loyalty program website before transferring points."],
    raw: input.raw
  };
}

function normalizeApifyCabin(value: unknown): { cabin: Cabin; mileageCost?: number; taxes?: number; seats?: number; direct?: boolean } | undefined {
  const item = asRecord(value);
  const cabin = normalizeCabin(asString(item.name ?? item.cabin));
  if (!cabin || item.available === false) {
    return undefined;
  }
  return {
    cabin,
    mileageCost: asNumber(item.mileageCost ?? item.mileage ?? item.points),
    taxes: asNumber(item.totalTaxes ?? item.taxes),
    seats: asNumber(item.remainingSeats ?? item.seats),
    direct: typeof item.direct === "boolean" ? item.direct : undefined
  };
}

function normalizeSegments(value: unknown): AwardSegment[] {
  return asArray(value).map((segment) => {
    const item = asRecord(segment);
    return {
      origin: asString(item.origin),
      destination: asString(item.destination),
      flightNumber: asString(item.flightNumber ?? item.flight_number),
      distanceMiles: asNumber(item.distance),
      durationMinutes: asNumber(item.duration),
      fareClass: asString(item.fareClass),
      aircraft: asString(item.aircraftName ?? item.aircraftCode),
      departsAt: asString(item.departure),
      arrivesAt: asString(item.arrival),
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

function shouldSkipCabin(cabin: Cabin, allowed: Cabin[] | undefined): boolean {
  return Boolean(allowed?.length && !allowed.includes(cabin));
}

function normalizeCabin(value: string | undefined): Cabin | undefined {
  if (value === "premium_economy") {
    return "premium";
  }
  if (value === "economy" || value === "premium" || value === "business" || value === "first") {
    return value;
  }
  return undefined;
}

function minorToMajor(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value > 1000 ? Math.round(value) / 100 : value;
}

function encodeActorId(value: string): string {
  return value.includes("~") ? value : value.replace("/", "~");
}

function formatError(payload: unknown): string {
  const record = asRecord(payload);
  return asString(record.error) ?? asString(record.message) ?? JSON.stringify(payload).slice(0, 300);
}

function stableId(parts: Array<string | number | undefined>): string {
  return createHash("sha1").update(parts.filter((part) => part !== undefined && part !== "").join("|")).digest("hex").slice(0, 20);
}

function trimRight(value: string): string {
  return value.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
