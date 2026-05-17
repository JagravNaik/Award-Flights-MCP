import type { PublicJsonAdapterConfig } from "../config.js";
import type { AwardSearchInput, SourceStatus } from "../domain/types.js";
import { asArray, getPath } from "../utils/jsonPath.js";
import { normalizeGenericJsonResult } from "./normalizers.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "./types.js";

export class PublicJsonAdapter implements AwardSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind = "public_json" as const;
  readonly supportsBatch = false;
  readonly supportsExplore = false;
  readonly rateLimitMs: number;

  constructor(private readonly config: PublicJsonAdapterConfig) {
    this.id = config.id;
    this.name = config.name;
    this.rateLimitMs = config.rateLimitMs;
  }

  status(): SourceStatus {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      health: this.config.enabled ? "ready" : "disabled",
      message: this.config.enabled
        ? "Configured public JSON adapter. It only performs plain HTTP requests against the configured endpoint."
        : "Disabled in public JSON adapter config.",
      supportsLive: false,
      supportsCached: false,
      supportsBatch: false,
      supportsExplore: false,
      rateLimitMs: this.rateLimitMs
    };
  }

  async search(input: AwardSearchInput): Promise<AdapterSearchResponse> {
    if (!this.config.enabled) {
      return { results: [], warnings: [`${this.id} skipped because it is disabled.`] };
    }

    const origin = input.origins[0];
    const destination = input.destinations[0];
    const date = input.startDate;
    const cabin = input.cabins?.[0];
    const url = new URL(this.config.baseUrl);
    const replacements = {
      origin,
      destination,
      date,
      startDate: input.startDate,
      endDate: input.endDate,
      cabin: cabin ?? "",
      passengers: String(input.passengers),
      programs: input.programs?.join(",") ?? ""
    };

    for (const [key, template] of Object.entries(this.config.query)) {
      url.searchParams.set(key, renderTemplate(template, replacements));
    }

    const response = await fetch(url, {
      method: this.config.method,
      headers: renderHeaders(this.config.headers, replacements),
      body: this.config.method === "POST" ? JSON.stringify(renderObject(this.config.body, replacements)) : undefined
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${this.id} HTTP error ${response.status}: ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as unknown;
    const items = asArray(getPath(payload, this.config.resultsPath));
    const foundAt = new Date().toISOString();

    return {
      results: items.map((item) =>
        normalizeGenericJsonResult(item, this.config.fieldMap, {
          source: this.id,
          sourceKind: this.kind,
          foundAt,
          defaultOrigin: origin,
          defaultDestination: destination,
          defaultDate: date,
          defaultCabin: cabin,
          confidence: "low"
        })
      ),
      warnings: []
    };
  }
}

function renderHeaders(headers: Record<string, string>, replacements: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, renderTemplate(value, replacements)]));
}

function renderObject(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === "string") {
    return renderTemplate(value, replacements);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderObject(item, replacements));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderObject(item, replacements)]));
  }
  return value;
}

function renderTemplate(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? "");
}
