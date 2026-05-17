import { describe, expect, it } from "vitest";
import { normalizeVirginCalendarRows } from "./virginRewardSeatChecker.js";

describe("normalizeVirginCalendarRows", () => {
  it("normalizes rendered Virgin calendar cards into award feed rows", () => {
    const results = normalizeVirginCalendarRows(
      [
        {
          title: "Sat 20",
          cabins: [
            { key: "economy", text: "Economy53,000pts" },
            { key: "premium", text: "Premium125,000pts" },
            { key: "upper-class", text: "Upper Class350,000pts" }
          ]
        }
      ],
      {
        origin: "JFK",
        destination: "LHR",
        startDate: "2026-06-20",
        endDate: "2026-06-20",
        cabins: ["business"],
        passengers: 1
      },
      "virgin-reward-seat-checker",
      "https://www.virginatlantic.com/reward-flight-finder/results/month?origin=JFK&destination=LHR&month=06&year=2026"
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: "virgin-reward-seat-checker",
      program: "Virgin Atlantic Flying Club",
      airline: "Virgin Atlantic",
      origin: "JFK",
      destination: "LHR",
      date: "2026-06-20",
      cabin: "business",
      miles: 350000
    });
  });
});
