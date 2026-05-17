import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { HotelAlert, HotelResult, HotelSearchInput } from "../domain/types.js";

export class HotelSearchService {
  private readonly resultsPath?: string;

  constructor(resultsPath?: string) {
    this.resultsPath = resultsPath ? resolve(resultsPath) : undefined;
  }

  search(input: HotelSearchInput): { results: HotelResult[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!this.resultsPath) {
      return {
        results: [],
        warnings: ["No hotel award feed is configured. Set HOTEL_RESULTS_PATH to a JSON file or add a hotel adapter."]
      };
    }

    const results = this.readResults(warnings)
      .filter((result) => matchesHotel(result, input))
      .sort((left, right) => compareHotels(left, right, input.sortBy ?? "points", input.sortDirection ?? "asc"))
      .slice(0, input.maxResults);

    return { results, warnings };
  }

  private readResults(warnings: string[]): HotelResult[] {
    try {
      const parsed = JSON.parse(readFileSync(this.resultsPath ?? "", "utf8"));
      return Array.isArray(parsed) ? (parsed as HotelResult[]) : [];
    } catch (error) {
      warnings.push(`Failed to read hotel results feed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

export class HotelAlertStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  list(enabledOnly = false): HotelAlert[] {
    const alerts = this.read();
    return enabledOnly ? alerts.filter((alert) => alert.enabled) : alerts;
  }

  create(input: { name: string; enabled: boolean; search: HotelSearchInput }): HotelAlert {
    const now = new Date().toISOString();
    const alert: HotelAlert = {
      id: randomUUID(),
      name: input.name,
      enabled: input.enabled,
      search: input.search,
      createdAt: now,
      updatedAt: now
    };
    const alerts = this.read();
    alerts.push(alert);
    this.write(alerts);
    return alert;
  }

  delete(id: string): { deleted: boolean; alert?: HotelAlert } {
    const alerts = this.read();
    const alert = alerts.find((candidate) => candidate.id === id);
    if (!alert) {
      return { deleted: false };
    }
    this.write(alerts.filter((candidate) => candidate.id !== id));
    return { deleted: true, alert };
  }

  markRun(id: string, matchCount: number): HotelAlert | undefined {
    const alerts = this.read();
    const alert = alerts.find((candidate) => candidate.id === id);
    if (!alert) {
      return undefined;
    }
    alert.lastRunAt = new Date().toISOString();
    alert.lastMatchCount = matchCount;
    alert.updatedAt = alert.lastRunAt;
    this.write(alerts);
    return alert;
  }

  private read(): HotelAlert[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? (parsed as HotelAlert[]) : [];
    } catch {
      return [];
    }
  }

  private write(alerts: HotelAlert[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(alerts, null, 2));
  }
}

function matchesHotel(result: HotelResult, input: HotelSearchInput): boolean {
  if (input.location && !includes(result.location, input.location)) {
    return false;
  }
  if (input.hotelName && !includes(result.hotelName, input.hotelName)) {
    return false;
  }
  if (input.programs?.length && !input.programs.some((program) => includes(result.program, program))) {
    return false;
  }
  if (result.checkIn !== input.checkIn || result.checkOut !== input.checkOut) {
    return false;
  }
  if (input.maxPointsPerNight !== undefined && (result.pointsPerNight ?? Number.MAX_SAFE_INTEGER) > input.maxPointsPerNight) {
    return false;
  }
  if (input.maxCashRate !== undefined && (result.cashRate ?? Number.MAX_SAFE_INTEGER) > input.maxCashRate) {
    return false;
  }
  if (input.minCpp !== undefined && (result.centsPerPoint ?? computeHotelCpp(result) ?? 0) < input.minCpp) {
    return false;
  }
  return true;
}

function compareHotels(left: HotelResult, right: HotelResult, sortBy: string, direction: string): number {
  const multiplier = direction === "desc" ? -1 : 1;
  switch (sortBy) {
    case "cash":
      return numberCompare(left.cashRate, right.cashRate) * multiplier;
    case "cpp":
      return numberCompare(left.centsPerPoint ?? computeHotelCpp(left), right.centsPerPoint ?? computeHotelCpp(right)) * multiplier;
    case "distance":
      return numberCompare(left.distanceMiles, right.distanceMiles) * multiplier;
    case "updated_at":
      return left.foundAt.localeCompare(right.foundAt) * multiplier;
    case "points":
    default:
      return numberCompare(left.pointsPerNight, right.pointsPerNight) * multiplier;
  }
}

function computeHotelCpp(result: HotelResult): number | undefined {
  if (!result.cashRate || !result.pointsPerNight) {
    return undefined;
  }
  return (result.cashRate / result.pointsPerNight) * 100;
}

function numberCompare(left: number | undefined, right: number | undefined): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function includes(value: string | undefined, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function normalize(value: string | undefined): string {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
}
