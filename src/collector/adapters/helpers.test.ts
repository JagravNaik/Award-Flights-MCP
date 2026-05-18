import { describe, expect, it } from "vitest";
import { normalizeVisibleMileageText } from "./helpers.js";

describe("normalizeVisibleMileageText", () => {
  it("extracts mileage-like award prices from rendered airline pages", () => {
    const results = normalizeVisibleMileageText({
      source: "example-program",
      route: {
        origin: "JFK",
        destination: "DBV",
        startDate: "2026-09-13",
        endDate: "2026-09-13",
        cabins: ["economy"],
        passengers: 1
      },
      program: "Example Miles",
      airline: "Example Air",
      bookingUrl: "https://example.com/search",
      text: "Economy 35K miles + $12. Business 80,000 miles.",
      warning: "Verify this award."
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: "example-program",
      program: "Example Miles",
      airline: "Example Air",
      origin: "JFK",
      destination: "DBV",
      date: "2026-09-13",
      cabin: "economy",
      miles: 35000
    });
  });
});
