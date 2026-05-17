import { afterEach, describe, expect, it, vi } from "vitest";
import type { AwardSearchInput } from "../domain/types.js";
import { ApifyFlightAwardAdapter } from "./apifyFlightAward.js";

const input: AwardSearchInput = {
  origins: ["JFK"],
  destinations: ["LHR"],
  startDate: "2026-06-10",
  endDate: "2026-06-12",
  cabins: ["economy"],
  passengers: 1,
  maxResults: 10,
  includeTrips: true,
  onlyDirectFlights: false,
  strategy: "auto",
  bruteForce: { enabled: false, maxQueries: 10, concurrency: 1, delayMs: 0 }
};

describe("ApifyFlightAwardAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the actor synchronously and normalizes dataset items", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        origins: ["JFK"],
        destinations: ["LHR"],
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        cabin: "economy",
        sortBy: "economy"
      });

      return new Response(
        JSON.stringify([
          {
            date: "2026-06-10",
            origin: "JFK",
            destination: "LHR",
            issuer: "flyingblue",
            issuerName: "Air France/KLM Flying Blue",
            itineraries: [
              {
                origin: "JFK",
                destination: "LHR",
                departure: "2026-06-10T17:45:00Z",
                arrival: "2026-06-11T09:00:00Z",
                stops: 1,
                flightNumbers: ["KL642", "KL1003"],
                cabins: [{ name: "economy", mileageCost: 18750, totalTaxes: 13440, remainingSeats: 9 }]
              }
            ]
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ApifyFlightAwardAdapter({
      apifyEnabled: true,
      apifyApiToken: "apify-token",
      apifyActorId: "igolaizola/flight-award-scraper",
      apifyBaseUrl: "https://api.apify.com/v2",
      apifyMaxItems: 100
    });

    const response = await adapter.search(input);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("igolaizola~flight-award-scraper/run-sync-get-dataset-items"), expect.any(Object));
    expect(response.results[0]).toMatchObject({
      source: "apify-flight-award-scraper",
      program: "Air France/KLM Flying Blue",
      origin: "JFK",
      destination: "LHR",
      date: "2026-06-10",
      cabin: "economy",
      mileageCost: 18750,
      taxes: 134.4,
      seats: 9,
      stops: 1,
      flightNumbers: ["KL642", "KL1003"]
    });
  });
});
