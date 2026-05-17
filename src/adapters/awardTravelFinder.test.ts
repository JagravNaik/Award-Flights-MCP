import { afterEach, describe, expect, it, vi } from "vitest";
import type { AwardSearchInput } from "../domain/types.js";
import { AwardTravelFinderAdapter } from "./awardTravelFinder.js";

const input: AwardSearchInput = {
  origins: ["LHR"],
  destinations: ["JFK"],
  startDate: "2026-06-15",
  endDate: "2026-06-15",
  cabins: ["business"],
  passengers: 1,
  maxResults: 5,
  includeTrips: true,
  onlyDirectFlights: false,
  strategy: "auto",
  bruteForce: { enabled: false, maxQueries: 10, concurrency: 1, delayMs: 0 }
};

describe("AwardTravelFinderAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes cabin-keyed flight responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              response_type: "flights",
              flights: [
                {
                  segments: [{ flight_number: "BA117", from: "LHR", to: "JFK", departure: "2026-06-15T08:20:00Z", arrival: "2026-06-15T11:05:00Z" }],
                  cabins: {
                    economy: { available: false, seats: 0, points: null },
                    business: { available: true, seats: 2, points: 50000, taxes: 350, taxes_currency: "GBP" }
                  },
                  duration: "7h 45m"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const adapter = new AwardTravelFinderAdapter({
      awardTravelFinderEnabled: true,
      awardTravelFinderApiKey: "atf-key",
      awardTravelFinderBaseUrl: "https://awardtravelfinder.com/api/v1",
      awardTravelFinderAirlines: ["british_airways"]
    });

    const response = await adapter.search(input);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      source: "award-travel-finder",
      program: "british airways",
      origin: "LHR",
      destination: "JFK",
      date: "2026-06-15",
      cabin: "business",
      seats: 2,
      mileageCost: 50000,
      taxes: 350,
      taxesCurrency: "GBP",
      durationMinutes: 465,
      flightNumbers: ["BA117"]
    });
  });
});
