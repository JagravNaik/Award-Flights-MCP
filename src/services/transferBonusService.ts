import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TransferBonus } from "../domain/types.js";

export interface TransferBonusFilter {
  bank?: string;
  program?: string;
  activeOn?: string;
}

export class TransferBonusService {
  private readonly path?: string;

  constructor(path?: string) {
    this.path = path ? resolve(path) : undefined;
  }

  list(filter: TransferBonusFilter = {}): { transferBonuses: TransferBonus[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!this.path) {
      return {
        transferBonuses: [],
        warnings: ["No transfer bonus feed is configured. Set TRANSFER_BONUSES_PATH to a JSON file before relying on current bonus data."]
      };
    }

    const bonuses = this.read(warnings).filter((bonus) => {
      const bankOk = filter.bank ? includes(bonus.bank, filter.bank) : true;
      const programOk = filter.program ? includes(bonus.program, filter.program) : true;
      const dateOk = filter.activeOn ? activeOn(bonus, filter.activeOn) : true;
      return bankOk && programOk && dateOk;
    });

    return { transferBonuses: bonuses, warnings };
  }

  private read(warnings: string[]): TransferBonus[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path ?? "", "utf8"));
      return Array.isArray(parsed) ? (parsed as TransferBonus[]) : [];
    } catch (error) {
      warnings.push(`Failed to read transfer bonus feed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

function activeOn(bonus: TransferBonus, date: string): boolean {
  if (bonus.startDate && bonus.startDate > date) {
    return false;
  }
  if (bonus.endDate && bonus.endDate < date) {
    return false;
  }
  return true;
}

function includes(value: string, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function normalize(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
