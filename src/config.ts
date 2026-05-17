import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as z from "zod/v4";

const publicJsonAdapterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  baseUrl: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  rateLimitMs: z.number().int().min(0).default(1000),
  query: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.unknown().optional(),
  resultsPath: z.string().default("results"),
  fieldMap: z.record(z.string(), z.string()).default({})
});

const publicJsonConfigSchema = z.object({
  adapters: z.array(publicJsonAdapterSchema).default([])
});

export type PublicJsonAdapterConfig = z.infer<typeof publicJsonAdapterSchema>;

export interface AppConfig {
  transport: "stdio" | "http";
  httpPort: number;
  localAwardFeedEnabled: boolean;
  localAwardFeedPath: string;
  seatsAeroEnabled: boolean;
  seatsAeroApiKey?: string;
  aerobaseEnabled: boolean;
  aerobaseApiKey?: string;
  aerobaseBaseUrl: string;
  awardTravelFinderEnabled: boolean;
  awardTravelFinderApiKey?: string;
  awardTravelFinderBaseUrl: string;
  awardTravelFinderAirlines: string[];
  awardFlightDailyEnabled: boolean;
  awardFlightDailyApiKey?: string;
  awardFlightDailyMcpUrl: string;
  apifyEnabled: boolean;
  apifyApiToken?: string;
  apifyActorId: string;
  apifyBaseUrl: string;
  apifyMaxItems: number;
  cacheTtlSeconds: number;
  defaultConcurrency: number;
  defaultDelayMs: number;
  maxBruteForceQueries: number;
  alertsPath: string;
  historyPath: string;
  pointsWalletPath: string;
  hotelResultsPath?: string;
  hotelAlertsPath: string;
  transferBonusesPath?: string;
  seatMapsPath?: string;
  fareClassesPath?: string;
  publicJsonAdapters: PublicJsonAdapterConfig[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const seatsAeroApiKey = clean(env.SEATS_AERO_API_KEY);
  const aerobaseApiKey = clean(env.AEROBASE_API_KEY);
  const awardTravelFinderApiKey = clean(env.AWARD_TRAVEL_FINDER_API_KEY);
  const apifyApiToken = clean(env.APIFY_API_TOKEN);

  return {
    transport: env.MCP_TRANSPORT === "http" ? "http" : "stdio",
    httpPort: readInt(env.MCP_HTTP_PORT, 3000),
    localAwardFeedEnabled: readBool(env.LOCAL_AWARD_FEED_ENABLED, true),
    localAwardFeedPath: clean(env.LOCAL_AWARD_FEED_PATH) ?? "./config/sample-awards.json",
    seatsAeroEnabled: readBool(env.SEATS_AERO_ENABLED, Boolean(seatsAeroApiKey)),
    seatsAeroApiKey,
    aerobaseEnabled: readBool(env.AEROBASE_ENABLED, Boolean(aerobaseApiKey)),
    aerobaseApiKey,
    aerobaseBaseUrl: clean(env.AEROBASE_API_BASE_URL) ?? "https://aerobase.app/api",
    awardTravelFinderEnabled: readBool(env.AWARD_TRAVEL_FINDER_ENABLED, Boolean(awardTravelFinderApiKey)),
    awardTravelFinderApiKey,
    awardTravelFinderBaseUrl: clean(env.AWARD_TRAVEL_FINDER_API_BASE_URL) ?? "https://awardtravelfinder.com/api/v1",
    awardTravelFinderAirlines: readList(env.AWARD_TRAVEL_FINDER_AIRLINES, ["british_airways", "qatar", "cathay_pacific", "virgin_atlantic"]),
    awardFlightDailyEnabled: readBool(env.AWARD_FLIGHT_DAILY_ENABLED, true),
    awardFlightDailyApiKey: clean(env.AWARD_FLIGHT_DAILY_API_KEY),
    awardFlightDailyMcpUrl: clean(env.AWARD_FLIGHT_DAILY_MCP_URL) ?? "https://awardflightdaily.com/mcp-server/mcp",
    apifyEnabled: readBool(env.APIFY_FLIGHT_AWARD_ENABLED, Boolean(apifyApiToken)),
    apifyApiToken,
    apifyActorId: clean(env.APIFY_FLIGHT_AWARD_ACTOR_ID) ?? "igolaizola/flight-award-scraper",
    apifyBaseUrl: clean(env.APIFY_API_BASE_URL) ?? "https://api.apify.com/v2",
    apifyMaxItems: readInt(env.APIFY_FLIGHT_AWARD_MAX_ITEMS, 100),
    cacheTtlSeconds: readInt(env.AWARD_CACHE_TTL_SECONDS, 900),
    defaultConcurrency: readInt(env.AWARD_DEFAULT_CONCURRENCY, 2),
    defaultDelayMs: readInt(env.AWARD_DEFAULT_DELAY_MS, 250),
    maxBruteForceQueries: readInt(env.AWARD_MAX_BRUTE_FORCE_QUERIES, 250),
    alertsPath: env.AWARD_ALERTS_PATH ?? "./data/alerts.json",
    historyPath: env.AWARD_HISTORY_PATH ?? "./data/history.json",
    pointsWalletPath: env.AWARD_POINTS_WALLET_PATH ?? "./data/points-wallet.json",
    hotelResultsPath: clean(env.HOTEL_RESULTS_PATH) ?? "./config/hotel-results.example.json",
    hotelAlertsPath: env.HOTEL_ALERTS_PATH ?? "./data/hotel-alerts.json",
    transferBonusesPath: clean(env.TRANSFER_BONUSES_PATH) ?? "./config/transfer-bonuses.json",
    seatMapsPath: clean(env.SEAT_MAPS_PATH) ?? "./config/seat-maps.example.json",
    fareClassesPath: clean(env.FARE_CLASSES_PATH) ?? "./config/fare-classes.example.json",
    publicJsonAdapters: loadPublicJsonAdapters(env.PUBLIC_JSON_ADAPTER_CONFIG)
  };
}

function loadPublicJsonAdapters(path: string | undefined): PublicJsonAdapterConfig[] {
  if (!path) {
    return [];
  }

  try {
    const absolutePath = resolve(path);
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
    return publicJsonConfigSchema.parse(parsed).adapters;
  } catch (error) {
    console.error(`Failed to load PUBLIC_JSON_ADAPTER_CONFIG: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readList(value: string | undefined, fallback: string[]): string[] {
  const cleaned = clean(value);
  if (!cleaned) {
    return fallback;
  }
  return cleaned
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
