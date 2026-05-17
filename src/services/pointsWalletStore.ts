import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { PointsBalance } from "../domain/types.js";

export interface PointsBalanceFilter {
  owner?: string;
  bank?: string;
  program?: string;
}

export class PointsWalletStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  list(filter: PointsBalanceFilter = {}): PointsBalance[] {
    return this.read().filter((balance) => {
      const ownerOk = filter.owner ? includes(balance.owner, filter.owner) : true;
      const bankOk = filter.bank ? includes(balance.bank, filter.bank) : true;
      const programOk = filter.program ? includes(balance.program, filter.program) : true;
      return ownerOk && bankOk && programOk;
    });
  }

  upsert(input: Omit<PointsBalance, "id" | "updatedAt"> & { id?: string }): PointsBalance {
    const balances = this.read();
    const now = new Date().toISOString();
    const existing = input.id ? balances.find((balance) => balance.id === input.id) : undefined;
    const balance: PointsBalance = {
      id: existing?.id ?? input.id ?? randomUUID(),
      owner: input.owner,
      bank: input.bank,
      program: input.program,
      balance: input.balance,
      transferableTo: input.transferableTo,
      notes: input.notes,
      updatedAt: now
    };

    const next = existing ? balances.map((candidate) => (candidate.id === existing.id ? balance : candidate)) : [...balances, balance];
    this.write(next);
    return balance;
  }

  delete(id: string): { deleted: boolean; balance?: PointsBalance } {
    const balances = this.read();
    const balance = balances.find((candidate) => candidate.id === id);
    if (!balance) {
      return { deleted: false };
    }
    this.write(balances.filter((candidate) => candidate.id !== id));
    return { deleted: true, balance };
  }

  private read(): PointsBalance[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? (parsed as PointsBalance[]) : [];
    } catch {
      return [];
    }
  }

  private write(balances: PointsBalance[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(balances, null, 2));
  }
}

function includes(value: string | undefined, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function normalize(value: string | undefined): string {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
}
