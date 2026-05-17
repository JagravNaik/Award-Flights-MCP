import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AwardSearchInput } from "../domain/types.js";
import { LocalAwardFeedAdapter } from "./localAwardFeed.js";

const input: AwardSearchInput = {
  origins: ["JFK"],
  destinations: ["LHR"],
  startDate: "2026-06-10",
  endDate: "2026-06-12",
  cabins: ["business"],
  passengers: 2,
  maxResults: 10,
  includeTrips: true,
  onlyDirectFlights: false,
  strategy: "auto",
  bruteForce: {
    enabled: false,
    maxQueries: 10,
    concurrency: 1,
    delayMs: 0
  }
};

describe("LocalAwardFeedAdapter", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop() ?? "", { recursive: true, force: true });
    }
  });

  it("searches a credential-free local JSON feed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "award-feed-"));
    dirs.push(dir);
    const path = join(dir, "awards.json");
    writeFileSync(
      path,
      JSON.stringify({
        results: [
          {
            id: "hit",
            origin: "JFK",
            destination: "LHR",
            date: "2026-06-10",
            cabin: "business",
            seats: 2,
            miles: 57500,
            taxes: { amount: 5.6, currency: "USD" },
            program: "American AAdvantage"
          },
          {
            id: "wrong-cabin",
            origin: "JFK",
            destination: "LHR",
            date: "2026-06-10",
            cabin: "economy",
            seats: 9
          },
          {
            id: "not-enough-seats",
            origin: "JFK",
            destination: "LHR",
            date: "2026-06-11",
            cabin: "business",
            seats: 1
          }
        ]
      })
    );

    const adapter = new LocalAwardFeedAdapter({ localAwardFeedEnabled: true, localAwardFeedPath: path });
    const response = await adapter.search(input);

    expect(adapter.status().health).toBe("ready");
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      id: "hit",
      source: "local-award-feed",
      sourceKind: "manual",
      origin: "JFK",
      destination: "LHR",
      date: "2026-06-10",
      cabin: "business",
      seats: 2,
      mileageCost: 57500,
      taxes: 5.6,
      taxesCurrency: "USD"
    });
    expect(response.warnings[0]).toContain("local feed leads");
  });

  it("reports disabled without warning about missing credentials", () => {
    const adapter = new LocalAwardFeedAdapter({ localAwardFeedEnabled: false, localAwardFeedPath: "./missing.json" });

    const status = adapter.status();

    expect(status.health).toBe("disabled");
    expect(status.message).not.toContain("credential");
  });
});
