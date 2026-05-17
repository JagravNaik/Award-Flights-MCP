import { describe, expect, it } from "vitest";
import type { AwardResult } from "../domain/types.js";
import { buildMultiCityItineraries, buildRoundTripItineraries } from "./itineraryBuilder.js";

const baseResult: AwardResult = {
  id: "base",
  source: "test",
  sourceKind: "manual",
  foundAt: "2026-05-17T00:00:00.000Z",
  confidence: "medium",
  origin: "JFK",
  destination: "LHR",
  date: "2026-09-01",
  cabin: "business",
  seats: 2,
  mileageCost: 50000,
  taxes: 100,
  taxesCurrency: "USD",
  segments: [],
  warnings: []
};

describe("itineraryBuilder", () => {
  it("pairs round-trip legs within stay constraints", () => {
    const itineraries = buildRoundTripItineraries({
      outbound: [baseResult],
      inbound: [
        {
          ...baseResult,
          id: "return",
          origin: "LHR",
          destination: "JFK",
          date: "2026-09-10",
          mileageCost: 55000,
          taxes: 120
        }
      ],
      minStayDays: 5,
      maxStayDays: 12,
      maxResults: 10
    });

    expect(itineraries).toHaveLength(1);
    expect(itineraries[0]?.totalMileageCost).toBe(105000);
    expect(itineraries[0]?.totalTaxes).toBe(220);
  });

  it("combines multi-city legs and keeps the cheapest candidate first", () => {
    const itineraries = buildMultiCityItineraries(
      [
        [baseResult],
        [
          {
            ...baseResult,
            id: "second",
            origin: "LHR",
            destination: "CDG",
            date: "2026-09-05",
            mileageCost: 10000,
            taxes: 40
          }
        ]
      ],
      5
    );

    expect(itineraries).toHaveLength(1);
    expect(itineraries[0]?.legs.map((leg) => leg.id)).toEqual(["base", "second"]);
  });
});
