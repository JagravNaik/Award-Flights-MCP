import type { AppConfig } from "../config.js";
import { AerobaseAdapter } from "./aerobase.js";
import { ApifyFlightAwardAdapter } from "./apifyFlightAward.js";
import { AwardFlightDailyAdapter } from "./awardFlightDaily.js";
import { AwardTravelFinderAdapter } from "./awardTravelFinder.js";
import { LocalAwardFeedAdapter } from "./localAwardFeed.js";
import { PublicJsonAdapter } from "./publicJson.js";
import { SeatsAeroAdapter } from "./seatsAero.js";
import type { AwardSourceAdapter } from "./types.js";

export function createAdapters(config: AppConfig): AwardSourceAdapter[] {
  return [
    new LocalAwardFeedAdapter(config),
    new SeatsAeroAdapter(config.seatsAeroApiKey, config.seatsAeroEnabled),
    new AerobaseAdapter(config),
    new AwardFlightDailyAdapter(config),
    new AwardTravelFinderAdapter(config),
    new ApifyFlightAwardAdapter(config),
    ...config.publicJsonAdapters.map((adapterConfig) => new PublicJsonAdapter(adapterConfig))
  ];
}
