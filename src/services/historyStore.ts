import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AwardResult } from "../domain/types.js";

export interface HistoryFilter {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  program?: string;
  cabin?: string;
  maxEntries?: number;
}

export interface HistoryRecord {
  observedAt: string;
  result: AwardResult;
}

export class HistoryStore {
  private readonly path: string;
  private readonly maxRecords: number;

  constructor(path: string, maxRecords = 10000) {
    this.path = resolve(path);
    this.maxRecords = maxRecords;
  }

  record(results: AwardResult[]): void {
    if (results.length === 0) {
      return;
    }
    const observedAt = new Date().toISOString();
    const records = this.read();
    records.push(...results.map((result) => ({ observedAt, result })));
    this.write(records.slice(-this.maxRecords));
  }

  list(filter: HistoryFilter = {}): HistoryRecord[] {
    const entries = this.read().filter((entry) => matchesHistory(entry.result, filter));
    return entries.slice(-(filter.maxEntries ?? 500));
  }

  stats(filter: HistoryFilter = {}) {
    const entries = this.list({ ...filter, maxEntries: filter.maxEntries ?? this.maxRecords });
    const mileages = entries.map((entry) => entry.result.mileageCost).filter((value): value is number => typeof value === "number");
    const taxes = entries.map((entry) => entry.result.taxes).filter((value): value is number => typeof value === "number");
    const uniqueKeys = new Set(entries.map((entry) => resultKey(entry.result)));
    const programs = unique(entries.map((entry) => entry.result.program));
    const cabins = unique(entries.map((entry) => entry.result.cabin?.toString()));
    const observedTimes = entries.map((entry) => entry.observedAt).sort();

    return {
      observations: entries.length,
      uniqueResults: uniqueKeys.size,
      cheapestMileageCost: mileages.length ? Math.min(...mileages) : undefined,
      averageMileageCost: mileages.length ? Math.round(mileages.reduce((sum, value) => sum + value, 0) / mileages.length) : undefined,
      lowestTaxes: taxes.length ? Math.min(...taxes) : undefined,
      programs,
      cabins,
      firstSeenAt: observedTimes[0],
      lastSeenAt: observedTimes.at(-1)
    };
  }

  private read(): HistoryRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? (parsed as HistoryRecord[]) : [];
    } catch {
      return [];
    }
  }

  private write(records: HistoryRecord[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(records, null, 2));
  }
}

function matchesHistory(result: AwardResult, filter: HistoryFilter): boolean {
  if (filter.origin && result.origin !== filter.origin) {
    return false;
  }
  if (filter.destination && result.destination !== filter.destination) {
    return false;
  }
  if (filter.startDate && result.date < filter.startDate) {
    return false;
  }
  if (filter.endDate && result.date > filter.endDate) {
    return false;
  }
  if (filter.program && normalize(result.program) !== normalize(filter.program)) {
    return false;
  }
  if (filter.cabin && normalize(result.cabin?.toString()) !== normalize(filter.cabin)) {
    return false;
  }
  return true;
}

function resultKey(result: AwardResult): string {
  return [result.source, result.program, result.origin, result.destination, result.date, result.cabin, result.flightNumbers?.join(","), result.mileageCost].join("|");
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function normalize(value: string | undefined): string {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
}
