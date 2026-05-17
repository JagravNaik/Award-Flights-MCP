import { afterEach, describe, expect, it, vi } from "vitest";
import { AerobaseAdapter } from "./aerobase.js";
import type { AwardSearchInput } from "../domain/types.js";

const input: AwardSearchInput = {
  origins: ["JFK"],
  destinations: ["LHR"],
  startDate: "2026-06-10",
  endDate: "2026-06-10",
  cabins: ["business"],
  passengers: 1,
  maxResults: 3,
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

describe("AerobaseAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports missing credentials without requiring a Seats.aero key", () => {
    const adapter = new AerobaseAdapter({
      aerobaseEnabled: true,
      aerobaseBaseUrl: "https://aerobase.app/api"
    });

    const status = adapter.status();

    expect(status.health).toBe("missing_credentials");
    expect(status.message).toContain("AEROBASE_API_KEY");
    expect(status.message).toContain("non-Seats");
  });

  it("calls Aerobase awards search and normalizes award results", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({
        authorization: "Bearer test-key",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init.body))).toMatchObject({
        from: "JFK",
        to: "LHR",
        date: "2026-06-10",
        cabin: "business",
        limit: 3
      });

      return new Response(
        JSON.stringify({
          data: [
            {
              origin: "JFK",
              destination: "LHR",
              date: "2026-06-10",
              cabin: "business",
              miles: 57500,
              seats_remaining: 2,
              program: "american",
              departure_time: "2026-06-10T18:00:00-04:00",
              arrival_time: "2026-06-11T06:20:00+01:00"
            }
          ],
          meta: { tier: "free", calls_remaining: 4 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new AerobaseAdapter({
      aerobaseEnabled: true,
      aerobaseApiKey: "test-key",
      aerobaseBaseUrl: "https://aerobase.app/api"
    });

    const response = await adapter.search(input);

    expect(fetchMock).toHaveBeenCalledWith("https://aerobase.app/api/v1/awards/search", expect.any(Object));
    expect(response.warnings).toEqual([]);
    expect(response.results[0]).toMatchObject({
      source: "aerobase-awards",
      sourceKind: "partner_api",
      confidence: "medium",
      program: "american",
      origin: "JFK",
      destination: "LHR",
      date: "2026-06-10",
      cabin: "business",
      mileageCost: 57500,
      seats: 2,
      stops: 0
    });
    expect(response.results[0].segments[0]).toMatchObject({
      origin: "JFK",
      destination: "LHR",
      cabin: "business"
    });
  });
});
