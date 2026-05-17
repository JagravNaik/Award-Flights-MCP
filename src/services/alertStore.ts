import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AwardAlert, AwardResult, AwardSearchInput } from "../domain/types.js";

export interface CreateAlertInput {
  name: string;
  enabled: boolean;
  search: AwardSearchInput;
  maxMileageCost?: number;
  maxTaxes?: number;
  minSeats?: number;
}

export class AlertStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  list(enabledOnly = false): AwardAlert[] {
    const alerts = this.read();
    return enabledOnly ? alerts.filter((alert) => alert.enabled) : alerts;
  }

  create(input: CreateAlertInput): AwardAlert {
    const now = new Date().toISOString();
    const alert: AwardAlert = {
      id: randomUUID(),
      name: input.name,
      enabled: input.enabled,
      search: input.search,
      maxMileageCost: input.maxMileageCost,
      maxTaxes: input.maxTaxes,
      minSeats: input.minSeats,
      createdAt: now,
      updatedAt: now
    };
    const alerts = this.read();
    alerts.push(alert);
    this.write(alerts);
    return alert;
  }

  delete(id: string): { deleted: boolean; alert?: AwardAlert } {
    const alerts = this.read();
    const alert = alerts.find((candidate) => candidate.id === id);
    if (!alert) {
      return { deleted: false };
    }
    this.write(alerts.filter((candidate) => candidate.id !== id));
    return { deleted: true, alert };
  }

  markRun(id: string, matchCount: number): AwardAlert | undefined {
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

  filterMatches(alert: AwardAlert, results: AwardResult[]): AwardResult[] {
    return results.filter((result) => {
      const mileageOk = alert.maxMileageCost === undefined || (result.mileageCost ?? Number.MAX_SAFE_INTEGER) <= alert.maxMileageCost;
      const taxesOk = alert.maxTaxes === undefined || (result.taxes ?? Number.MAX_SAFE_INTEGER) <= alert.maxTaxes;
      const seatsOk = alert.minSeats === undefined || (result.seats ?? alert.minSeats) >= alert.minSeats;
      return mileageOk && taxesOk && seatsOk;
    });
  }

  private read(): AwardAlert[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? (parsed as AwardAlert[]) : [];
    } catch {
      return [];
    }
  }

  private write(alerts: AwardAlert[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(alerts, null, 2));
  }
}
