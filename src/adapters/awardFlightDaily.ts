import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AppConfig } from "../config.js";
import type { AwardResult, AwardSearchInput, Cabin, SourceStatus } from "../domain/types.js";
import { asArray, asNumber, asString } from "../utils/jsonPath.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

type AwardFlightDailyConfig = Pick<AppConfig, "awardFlightDailyEnabled" | "awardFlightDailyApiKey" | "awardFlightDailyMcpUrl">;

export class AwardFlightDailyAdapter implements AwardSourceAdapter {
  readonly id = "award-flight-daily";
  readonly name = "Award Flight Daily MCP";
  readonly kind = "partner_api" as const;
  readonly supportsBatch = false;
  readonly supportsExplore = false;
  readonly rateLimitMs = 1000;

  constructor(private readonly config: AwardFlightDailyConfig) {}

  status(): SourceStatus {
    const health = this.config.awardFlightDailyEnabled ? "ready" : "disabled";
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health,
      message: this.config.awardFlightDailyEnabled
        ? this.config.awardFlightDailyApiKey
          ? "Configured with API key. Calls the remote Award Flight Daily MCP server."
          : "Configured for Award Flight Daily free tier. No API key is required for limited daily searches."
        : "Disabled with AWARD_FLIGHT_DAILY_ENABLED=false.",
      supportsLive: false,
      supportsCached: true,
      supportsBatch: this.supportsBatch,
      supportsExplore: this.supportsExplore,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    if (!this.config.awardFlightDailyEnabled) {
      return { results: [], warnings: [`${this.id} skipped because AWARD_FLIGHT_DAILY_ENABLED=false.`] };
    }

    const origin = input.origins[0];
    const destination = input.destinations[0];
    const cabin = input.cabins?.[0];
    const args: Record<string, unknown> = {
      origin,
      destination,
      date_from: input.startDate,
      date_to: input.endDate,
      cabin: cabin ? toAfdCabin(cabin) : undefined,
      source: input.programs?.join(","),
      direct_only: input.onlyDirectFlights,
      max_miles: input.maxMileageCost,
      min_seats: input.minSeats ?? 1,
      limit: Math.min(200, Math.max(1, input.maxResults)),
      offset: 0,
      response_format: "json"
    };

    const payload = await this.callTool("afd_search_award_flights", { params: compact(args) });
    const foundAt = new Date().toISOString();
    const items = extractAfdItems(payload);
    const results = items.map((item) =>
      normalizeAfdItem(item, {
        source: this.id,
        foundAt,
        origin,
        destination,
        date: input.startDate,
        cabin
      })
    );

    return {
      results,
      warnings: results.length ? [] : [`${this.id} returned no normalized award availability for this query. ${summarizePayload(payload)}`.trim()]
    };
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      "user-agent": "award-flights-mcp/0.1"
    };
    if (this.config.awardFlightDailyApiKey) {
      headers.authorization = `Bearer ${this.config.awardFlightDailyApiKey}`;
      headers["x-api-key"] = this.config.awardFlightDailyApiKey;
    }

    const client = new Client({ name: "award-flights-mcp", version: "0.1.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.config.awardFlightDailyMcpUrl), {
      requestInit: { headers }
    });

    try {
      await client.connect(transport);
      const response = await client.callTool({ name, arguments: args });
      return extractMcpPayload(response);
    } finally {
      await client.close().catch(() => {});
    }
  }
}

function extractMcpPayload(response: unknown): unknown {
  const record = asRecord(response);
  if (record.structuredContent) {
    const structuredResult = unwrapResult(asRecord(record.structuredContent));
    if (structuredResult !== undefined) {
      return structuredResult;
    }
    return record.structuredContent;
  }

  const result = unwrapResult(record);
  if (result !== undefined) {
    return result;
  }

  for (const content of asArray(record.content)) {
    const item = asRecord(content);
    if (item.type === "text") {
      const text = asString(item.text);
      if (!text) {
        continue;
      }
      const parsed = parseJsonText(text);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return response;
}

function unwrapResult(record: Record<string, unknown>): unknown | undefined {
  if (typeof record.result === "string") {
    const parsed = parseJsonText(record.result);
    return parsed !== undefined ? parsed : { result: record.result };
  }
  return record.result;
}

function extractAfdItems(payload: unknown): unknown[] {
  const record = asRecord(payload);
  for (const key of ["results", "flights", "data", "items"]) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function summarizePayload(payload: unknown): string {
  const record = asRecord(payload);
  const message = asString(record.error ?? record.message ?? record.detail);
  if (message) {
    return `Upstream message: ${message.slice(0, 250)}`;
  }
  const text = JSON.stringify(payload);
  return text && text !== "{}" ? `Upstream payload: ${text.slice(0, 250)}` : "";
}

function normalizeAfdItem(raw: unknown, context: { source: string; foundAt: string; origin: string; destination: string; date: string; cabin?: Cabin }): AwardResult {
  const item = asRecord(raw);
  const origin = asString(item.origin) ?? asString(item.from) ?? context.origin;
  const destination = asString(item.destination) ?? asString(item.to) ?? context.destination;
  const date = asString(item.date ?? item.departure_date)?.slice(0, 10) ?? context.date;
  const cabin = fromAfdCabin(asString(item.cabin ?? item.cabin_class)) ?? context.cabin;
  const flightNumbers = splitFlightNumbers(asString(item.flight_number ?? item.flightNumbers ?? item.flight_numbers));

  return {
    id: stableId([context.source, asString(item.program ?? item.source), origin, destination, date, cabin, asNumber(item.award_cost ?? item.miles ?? item.mileage)]),
    source: context.source,
    sourceKind: "partner_api",
    sourceUpdatedAt: asString(item.updated_at ?? item.updatedAt),
    foundAt: context.foundAt,
    confidence: "medium",
    program: asString(item.program_name ?? item.program ?? item.source ?? item.loyalty_program),
    origin,
    destination,
    date,
    cabin,
    seats: asNumber(item.seats ?? item.remaining_seats ?? item.availability_count),
    mileageCost: asNumber(item.award_cost ?? item.miles ?? item.mileage ?? item.mileage_cost),
    taxes: asNumber(item.taxes ?? item.fees),
    taxesCurrency: asString(item.taxes_currency ?? item.currency),
    durationMinutes: asNumber(item.duration_minutes ?? item.duration),
    stops: asNumber(item.stops) ?? inferStops(item.direct),
    marketingAirline: asString(item.airline_name ?? item.airline ?? item.airlines ?? item.marketing_airline),
    operatingAirline: asString(item.operating_airline),
    flightNumbers,
    aircraft: asString(item.equipment ?? item.aircraft),
    segments: [],
    warnings: ["Cached Award Flight Daily result. Verify availability on the loyalty program website before transferring points."],
    raw
  };
}

function inferStops(value: unknown): number | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }
  return value ? 0 : 1;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  for (const candidate of [trimmed, trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1]]) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function toAfdCabin(cabin: Cabin): string {
  return { economy: "Y", premium: "W", business: "J", first: "F" }[cabin];
}

function fromAfdCabin(value: string | undefined): Cabin | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "Y" || normalized === "ECONOMY") {
    return "economy";
  }
  if (normalized === "W" || normalized === "PREMIUM" || normalized === "PREMIUM_ECONOMY") {
    return "premium";
  }
  if (normalized === "J" || normalized === "BUSINESS") {
    return "business";
  }
  if (normalized === "F" || normalized === "FIRST") {
    return "first";
  }
  return undefined;
}

function splitFlightNumbers(value: string | undefined): string[] {
  return value?.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean) ?? [];
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function stableId(parts: Array<string | number | undefined>): string {
  return createHash("sha1").update(parts.filter((part) => part !== undefined && part !== "").join("|")).digest("hex").slice(0, 20);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
