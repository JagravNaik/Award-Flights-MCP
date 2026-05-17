import { describe, expect, it } from "vitest";
import { eachDateInclusive } from "./dates.js";

describe("eachDateInclusive", () => {
  it("expands an inclusive date range", () => {
    expect(eachDateInclusive("2026-05-17", "2026-05-19")).toEqual(["2026-05-17", "2026-05-18", "2026-05-19"]);
  });

  it("rejects inverted ranges", () => {
    expect(() => eachDateInclusive("2026-05-19", "2026-05-17")).toThrow(/startDate/);
  });
});
