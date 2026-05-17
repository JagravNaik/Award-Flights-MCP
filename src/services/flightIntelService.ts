import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FareClassInput, FareClassResult, SeatMapInput, SeatMapResult } from "../domain/types.js";

export class FlightIntelService {
  private readonly seatMapsPath?: string;
  private readonly fareClassesPath?: string;

  constructor(paths: { seatMapsPath?: string; fareClassesPath?: string }) {
    this.seatMapsPath = paths.seatMapsPath ? resolve(paths.seatMapsPath) : undefined;
    this.fareClassesPath = paths.fareClassesPath ? resolve(paths.fareClassesPath) : undefined;
  }

  seatMaps(input: SeatMapInput): { seatMaps: SeatMapResult[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!this.seatMapsPath) {
      return {
        seatMaps: [],
        warnings: ["No seat-map feed is configured. Set SEAT_MAPS_PATH to a JSON file or add a live seat-map adapter."]
      };
    }
    return {
      seatMaps: this.read<SeatMapResult>(this.seatMapsPath, warnings).filter((seatMap) => matchesSeatMap(seatMap, input)),
      warnings
    };
  }

  fareClasses(input: FareClassInput): { fareClasses: FareClassResult[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!this.fareClassesPath) {
      return {
        fareClasses: [],
        warnings: ["No fare-class feed is configured. Set FARE_CLASSES_PATH to a JSON file or add a live fare-class adapter."]
      };
    }
    return {
      fareClasses: this.read<FareClassResult>(this.fareClassesPath, warnings).filter((fareClass) => matchesFareClass(fareClass, input)),
      warnings
    };
  }

  private read<T>(path: string, warnings: string[]): T[] {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      warnings.push(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

function matchesSeatMap(result: SeatMapResult, input: SeatMapInput): boolean {
  if (!sameFlight(result.flightNumber, input.flightNumber)) {
    return false;
  }
  if (input.airline && !includes(result.airline, input.airline)) {
    return false;
  }
  if (input.date && result.date && result.date !== input.date) {
    return false;
  }
  if (input.cabin && result.cabin && normalize(result.cabin) !== normalize(input.cabin)) {
    return false;
  }
  if (input.aircraft && result.aircraft && !includes(result.aircraft, input.aircraft)) {
    return false;
  }
  return true;
}

function matchesFareClass(result: FareClassResult, input: FareClassInput): boolean {
  if (!sameFlight(result.flightNumber, input.flightNumber)) {
    return false;
  }
  if (input.airline && !includes(result.airline, input.airline)) {
    return false;
  }
  if (input.date && result.date && result.date !== input.date) {
    return false;
  }
  return true;
}

function sameFlight(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function includes(value: string | undefined, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function normalize(value: string | undefined): string {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
}
