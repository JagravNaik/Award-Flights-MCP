import { describe, expect, it } from "vitest";
import { listCollectorAdapters, selectCollectorAdapters } from "./index.js";

describe("collector adapter selection", () => {
  it("expands all to broad program coverage", () => {
    const selected = selectCollectorAdapters(["all"]).map((adapter) => adapter.id);

    expect(selected).toContain("virgin-reward-seat-checker");
    expect(selected).toContain("united-mileageplus");
    expect(selected).toContain("american-aadvantage");
    expect(selected).toContain("delta-skymiles");
    expect(selected.length).toBe(listCollectorAdapters().length);
  });
});
