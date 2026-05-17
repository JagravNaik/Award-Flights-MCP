import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollectorConfig, CollectorRoute } from "./types.js";

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return {
    adapters: readList(env.COLLECTOR_ADAPTERS, ["ba-reward-flight-finder", "virgin-reward-seat-checker"]),
    routes: readRoutes(env),
    headless: readBool(env.COLLECTOR_HEADLESS, true),
    intervalMinutes: readInt(env.COLLECTOR_INTERVAL_MINUTES, 0),
    profileDir: resolve(env.COLLECTOR_PROFILE_DIR ?? "./data/browser-profile"),
    outputPath: resolve(env.COLLECTOR_OUTPUT_PATH ?? "./data/collector-awards.json"),
    debugDir: env.COLLECTOR_DEBUG_DIR ? resolve(env.COLLECTOR_DEBUG_DIR) : resolve("./data/collector-debug"),
    navigationTimeoutMs: readInt(env.COLLECTOR_NAVIGATION_TIMEOUT_MS, 45000),
    actionDelayMs: readInt(env.COLLECTOR_ACTION_DELAY_MS, 1500),
    maxCapturedJsonResponses: readInt(env.COLLECTOR_MAX_CAPTURED_JSON_RESPONSES, 80)
  };
}

function readRoutes(env: NodeJS.ProcessEnv): CollectorRoute[] {
  const rawJson = env.COLLECTOR_ROUTES_JSON?.trim();
  if (rawJson) {
    return normalizeRoutes(JSON.parse(rawJson));
  }

  const path = env.COLLECTOR_ROUTES_PATH?.trim();
  if (path) {
    return normalizeRoutes(JSON.parse(readFileSync(resolve(path), "utf8")));
  }

  const origin = env.COLLECTOR_ORIGIN?.trim();
  const destination = env.COLLECTOR_DESTINATION?.trim();
  const startDate = env.COLLECTOR_START_DATE?.trim();
  const endDate = env.COLLECTOR_END_DATE?.trim() ?? startDate;
  if (origin && destination && startDate && endDate) {
    return normalizeRoutes([
      {
        origin,
        destination,
        startDate,
        endDate,
        cabins: readList(env.COLLECTOR_CABINS, []),
        passengers: readInt(env.COLLECTOR_PASSENGERS, 1)
      }
    ]);
  }

  return [];
}

function normalizeRoutes(value: unknown): CollectorRoute[] {
  if (!Array.isArray(value)) {
    throw new Error("Collector routes must be a JSON array.");
  }

  return value.map((item) => {
    const route = asRecord(item);
    const origin = readIata(route.origin, "origin");
    const destination = readIata(route.destination, "destination");
    const startDate = readDate(route.startDate, "startDate");
    const endDate = readDate(route.endDate ?? route.startDate, "endDate");
    if (startDate > endDate) {
      throw new Error(`Collector route ${origin}-${destination} has startDate after endDate.`);
    }
    return {
      origin,
      destination,
      startDate,
      endDate,
      cabins: Array.isArray(route.cabins) ? route.cabins.map((cabin) => String(cabin).toLowerCase()) as CollectorRoute["cabins"] : undefined,
      passengers: Number.isInteger(route.passengers) ? Number(route.passengers) : 1,
      programs: Array.isArray(route.programs) ? route.programs.map(String) : undefined
    };
  });
}

function readIata(value: unknown, field: string): string {
  const text = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) {
    throw new Error(`Collector route ${field} must be a 3-letter IATA code.`);
  }
  return text;
}

function readDate(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Collector route ${field} must be YYYY-MM-DD.`);
  }
  return text;
}

function readList(value: string | undefined, fallback: string[]): string[] {
  const cleaned = value?.trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.split(",").map((item) => item.trim()).filter(Boolean);
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
