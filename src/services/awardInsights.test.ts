import { describe, expect, it } from "vitest";
import { buildAwardCalendar, compareCashPoints, summarizeDeals } from "./awardInsights.js";

describe("awardInsights", () => {
  it("groups award results into calendar buckets", () => {
    const calendar = buildAwardCalendar(
      [
        {
          id: "deal-1",
          source: "test",
          sourceKind: "manual",
          foundAt: "2026-05-17T00:00:00.000Z",
          confidence: "medium",
          program: "Flying Blue",
          origin: "JFK",
          destination: "CDG",
          date: "2026-09-01",
          cabin: "business",
          seats: 2,
          mileageCost: 48500,
          taxes: 220,
          segments: [],
          warnings: []
        }
      ],
      ["date", "program", "cabin"]
    );

    expect(calendar[0]?.cheapestMileageCost).toBe(48500);
    expect(calendar[0]?.maxSeats).toBe(2);
  });

  it("adjusts transferable points needed for transfer bonuses", () => {
    const comparison = compareCashPoints({
      cashPrice: 3000,
      mileageCost: 60000,
      taxes: 300,
      transferBonusPercent: 20,
      currency: "USD"
    });

    expect(comparison.effectiveTransferablePointsNeeded).toBe(50000);
    expect(comparison.centsPerPoint).toBeCloseTo(5.4);
  });

  it("ranks deals with cash value and cabin signal", () => {
    const deals = summarizeDeals(
      [
        {
          id: "deal-1",
          source: "test",
          sourceKind: "manual",
          foundAt: "2026-05-17T00:00:00.000Z",
          confidence: "medium",
          origin: "JFK",
          destination: "CDG",
          date: "2026-09-01",
          cabin: "business",
          seats: 2,
          mileageCost: 50000,
          taxes: 100,
          cashPrice: 3000,
          segments: [],
          warnings: []
        }
      ],
      10
    );

    expect(deals[0]?.id).toBe("deal-1");
    expect(deals[0]?.centsPerPoint).toBeCloseTo(5.8);
  });
});
