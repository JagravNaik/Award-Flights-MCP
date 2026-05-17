import { describe, expect, it } from "vitest";
import { createAdapters } from "./adapters/index.js";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("starts with credential-free defaults and no missing-credential adapters", () => {
    const config = loadConfig({});
    const statuses = createAdapters(config).map((adapter) => adapter.status());

    expect(config.localAwardFeedEnabled).toBe(true);
    expect(config.seatsAeroEnabled).toBe(false);
    expect(config.aerobaseEnabled).toBe(false);
    expect(config.awardTravelFinderEnabled).toBe(false);
    expect(config.apifyEnabled).toBe(false);
    expect(statuses.some((status) => status.health === "ready")).toBe(true);
    expect(statuses.filter((status) => status.health === "missing_credentials")).toEqual([]);
  });

  it("auto-enables optional credentialed adapters when their key is supplied", () => {
    const config = loadConfig({
      SEATS_AERO_API_KEY: "seats",
      AEROBASE_API_KEY: "aerobase",
      AWARD_TRAVEL_FINDER_API_KEY: "atf",
      APIFY_API_TOKEN: "apify"
    });

    expect(config.seatsAeroEnabled).toBe(true);
    expect(config.aerobaseEnabled).toBe(true);
    expect(config.awardTravelFinderEnabled).toBe(true);
    expect(config.apifyEnabled).toBe(true);
  });
});
