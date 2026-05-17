import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AwardResult, AwardSearchInput, Cabin, SourceStatus } from "../domain/types.js";
import { asNumber, asString } from "../utils/jsonPath.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

interface AerobaseEnvelope {
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    upgrade_url?: string;
  };
  meta?: unknown;
}

export class AerobaseAdapter implements AwardSourceAdapter {
  readonly id = "aerobase-awards";
  readonly name = "Aerobase Awards API";
  readonly kind = "partner_api" as const;
  readonly supportsBatch = false;
  readonly supportsExplore = false;
  readonly rateLimitMs = 1000;

  constructor(private readonly config: Pick<AppConfig, "aerobaseEnabled" | "aerobaseApiKey" | "aerobaseBaseUrl">) {}

  status(): SourceStatus {
    const health = !this.config.aerobaseEnabled ? "disabled" : this.config.aerobaseApiKey ? "ready" : "missing_credentials";
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
    if (!this.config.aerobaseEnabled) {
      return { results: [], warnings: [`${this.id} skipped because AEROBASE_ENABLED=false.`] };
    }
    if (!this.config.aerobaseApiKey) {
      return {
        results: [],
        warnings: [`${this.id} skipped because AEROBASE_API_KEY is not configured. This does not require a Seats.aero key.`]
      };
    }

    const origin = input.origins[0];
    const destination = input.destinations[0];
    const cabin = input.cabins?.[0];
    const body: Record<string, unknown> = {
      from: origin,
      to: destination,
      limit: Math.min(100, Math.max(1, input.maxResults))
    };

    if (cabin) {
      body.cabin = toAerobaseCabin(cabin);
    }
    if (input.startDate === input.endDate) {
      body.date = input.startDate;
    } else {
      body.date_from = input.startDate;
      body.date_to = input.endDate;
    }

    const response = await fetch(`${trimRight(this.config.aerobaseBaseUrl)}/v1/awards/search`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${this.config.aerobaseApiKey}`,
        "content-type": "application/json",
        "user-agent": "award-flights-mcp/0.1"
      },
      body: JSON.stringify(body)
    });

    const payload = await readEnvelope(response);
    if (!response.ok) {
      return {
        results: [],
        warnings: [`${this.id} HTTP ${response.status}: ${formatAerobaseError(payload)}`]
      };
    }

    const items = Array.isArray(payload.data) ? payload.data : [];
    const foundAt = new Date().toISOString();
    const results = items.map((item) => normalizeAerobaseAward(item, { origin, destination, cabin, foundAt }));

    return {
      results,
      warnings: results.length
        ? []
        : [`${this.id} returned no award availability for ${origin}-${destination} ${input.startDate} to ${input.endDate}.`]
    };
  }

  private statusMessage(health: SourceStatus["health"]): string {
    if (health === "ready") {
      return "Configured. Searches Aerobase cached award availability without using Seats.aero credentials.";
    }
    if (health === "disabled") {
      return "Disabled with AEROBASE_ENABLED=false.";
    }
    return "Set AEROBASE_API_KEY to enable non-Seats award searches. Free/basic keys are available from https://aerobase.app/connect.";
  }
}

function normalizeAerobaseAward(raw: unknown, context: { origin: string; destination: string; cabin?: Cabin; foundAt: string }): AwardResult {
  const item = asRecord(raw);
  const origin = asString(item.origin) ?? context.origin;
  const destination = asString(item.destination) ?? context.destination;
  const date = asString(item.date) ?? "";
  const cabin = asString(item.cabin) ?? context.cabin;
  const departsAt = asString(item.departure_time ?? item.departureTime);
  const arrivesAt = asString(item.arrival_time ?? item.arrivalTime);
  const durationMinutes = computeDurationMinutes(departsAt, arrivesAt);

  return {
    id: stableId(["aerobase-awards", origin, destination, date, cabin, asString(item.program), asNumber(item.miles)]),
    source: "aerobase-awards",
    sourceKind: "partner_api",
    foundAt: context.foundAt,
    confidence: "medium",
    program: asString(item.program),
    origin,
    destination,
    date,
    cabin,
    seats: asNumber(item.seats_remaining ?? item.remainingSeats ?? item.seats),
    mileageCost: asNumber(item.miles ?? item.mileageCost ?? item.points),
    durationMinutes,
    stops: 0,
    segments: departsAt || arrivesAt
      ? [
          {
            origin,
            destination,
            cabin,
            departsAt,
            arrivesAt,
            durationMinutes
          }
        ]
      : [],
    warnings: ["Cached award result from Aerobase. Verify availability on the loyalty program website before transferring points."],
    raw
  };
}

async function readEnvelope(response: Response): Promise<AerobaseEnvelope> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as AerobaseEnvelope;
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

function formatAerobaseError(payload: AerobaseEnvelope): string {
  const message = payload.error?.message ?? "Request failed.";
  const code = payload.error?.code ? `${payload.error.code}: ` : "";
  const upgrade = payload.error?.upgrade_url ? ` Upgrade: ${payload.error.upgrade_url}` : "";
  return `${code}${message}${upgrade}`;
}

function toAerobaseCabin(cabin: Cabin): string {
  return cabin;
}

function computeDurationMinutes(departsAt: string | undefined, arrivesAt: string | undefined): number | undefined {
  if (!departsAt || !arrivesAt) {
    return undefined;
  }
  const departMs = Date.parse(departsAt);
  const arriveMs = Date.parse(arrivesAt);
  if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs) || arriveMs <= departMs) {
    return undefined;
  }
  return Math.round((arriveMs - departMs) / 60000);
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
