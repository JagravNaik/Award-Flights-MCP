import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AppConfig } from "./config.js";
import { createAdapters } from "./adapters/index.js";
import {
  bookingLinksInputSchema,
  bookingPlanInputSchema,
  calendarAwardsInputSchema,
  cashPointsCompareInputSchema,
  createAlertInputSchema,
  createHotelAlertInputSchema,
  deleteAlertInputSchema,
  deletePointsBalanceInputSchema,
  dealDigestInputSchema,
  exploreAwardsInputSchema,
  fareClassInputSchema,
  hotelSearchInputSchema,
  listAlertsInputSchema,
  listHotelAlertsInputSchema,
  listPointsBalancesInputSchema,
  multiCityAwardsInputSchema,
  priceHistoryInputSchema,
  roundTripAwardsInputSchema,
  runAlertsInputSchema,
  runHotelAlertsInputSchema,
  searchAwardsInputSchema,
  seatMapInputSchema,
  transferBonusInputSchema,
  routeStatsInputSchema,
  upsertPointsBalanceInputSchema,
  verifyAwardInputSchema
} from "./domain/schemas.js";
import type {
  AwardResult,
  AwardResultFilters,
  AwardSearchInput,
  AwardSearchResponse,
  MultiCitySearchInput,
  RoundTripSearchInput
} from "./domain/types.js";
import { TRANSFER_PARTNERS } from "./data/transferPartners.js";
import { AwardSearchService } from "./services/awardSearchService.js";
import { AlertStore } from "./services/alertStore.js";
import { buildAwardCalendar, buildBookingPlan, compareCashPoints, summarizeDeals } from "./services/awardInsights.js";
import { getBookingLinks } from "./services/bookingLinks.js";
import { FlightIntelService } from "./services/flightIntelService.js";
import { HistoryStore } from "./services/historyStore.js";
import { HotelAlertStore, HotelSearchService } from "./services/hotelSearchService.js";
import { buildMultiCityItineraries, buildRoundTripItineraries } from "./services/itineraryBuilder.js";
import { PointsWalletStore } from "./services/pointsWalletStore.js";
import { TransferBonusService } from "./services/transferBonusService.js";

export function createAwardFlightsServer(config: AppConfig): McpServer {
  const service = new AwardSearchService(createAdapters(config), config);
  const history = new HistoryStore(config.historyPath);
  const hotelSearch = new HotelSearchService(config.hotelResultsPath);
  const flightIntel = new FlightIntelService({ seatMapsPath: config.seatMapsPath, fareClassesPath: config.fareClassesPath });
  const transferBonuses = new TransferBonusService(config.transferBonusesPath);
  const wallet = new PointsWalletStore(config.pointsWalletPath);
  const server = new McpServer(
    {
      name: "award-flights-mcp",
      version: "0.1.0"
    },
    {
      instructions:
        "Search award flight leads across configured adapters. Cached or third-party results must be verified on the loyalty program website before points are transferred."
    }
  );
  const alerts = new AlertStore(config.alertsPath);
  const hotelAlerts = new HotelAlertStore(config.hotelAlertsPath);
  const record = (response: AwardSearchResponse) => {
    history.record(response.results);
    return response;
  };

  server.registerTool(
    "search_awards",
    {
      title: "Search Award Flights",
      description:
        "Search award flight availability. Supports controlled brute-force route/date enumeration via strategy=brute_force or bruteForce.enabled=true.",
      inputSchema: searchAwardsInputSchema
    },
    async (input) => asToolResult(record(await service.search(input)))
  );

  server.registerTool(
    "explore_awards",
    {
      title: "Explore Cached Award Space",
      description: "Explore broad cached award availability by region, date range, program, and cabin where adapters support it.",
      inputSchema: exploreAwardsInputSchema
    },
    async (input) => asToolResult(record(await service.explore(input)))
  );

  server.registerTool(
    "verify_award",
    {
      title: "Verify Award Lead",
      description:
        "Re-run a narrow route/date/cabin search for a single award lead. This is a fresh lead check, not a booking guarantee.",
      inputSchema: verifyAwardInputSchema
    },
    async (input) => asToolResult(record(await service.verify(input)))
  );

  server.registerTool(
    "refresh_route",
    {
      title: "Refresh Award Route",
      description: "Re-run a route/date search immediately, useful for route-refresh workflows from cached discovery results.",
      inputSchema: searchAwardsInputSchema
    },
    async (input) => asToolResult(record(await service.search(input)))
  );

  server.registerTool(
    "search_round_trip_awards",
    {
      title: "Search Round Trip Award Flights",
      description: "Search outbound and return award space, then combine compatible results into priced round-trip itineraries.",
      inputSchema: roundTripAwardsInputSchema
    },
    async (input) => {
      const outbound = record(await service.search(toRoundTripLegSearch(input, "outbound")));
      const inbound = record(await service.search(toRoundTripLegSearch(input, "inbound")));
      const itineraries = buildRoundTripItineraries({
        outbound: outbound.results,
        inbound: inbound.results,
        minStayDays: input.minStayDays,
        maxStayDays: input.maxStayDays,
        maxResults: input.maxResults
      });
      return asToolResult({ itineraries, outboundDiagnostics: outbound.diagnostics, inboundDiagnostics: inbound.diagnostics });
    }
  );

  server.registerTool(
    "search_multi_city_awards",
    {
      title: "Search Multi-City Award Flights",
      description: "Search each leg of a multi-city award trip and combine leg results into candidate itineraries.",
      inputSchema: multiCityAwardsInputSchema
    },
    async (input) => {
      const legResponses = [];
      for (const leg of input.legs) {
        legResponses.push(record(await service.search(toMultiCityLegSearch(input, leg))));
      }
      const itineraries = buildMultiCityItineraries(
        legResponses.map((response) => response.results.slice(0, input.legMaxResults)),
        input.maxResults
      );
      return asToolResult({ itineraries, diagnosticsByLeg: legResponses.map((response) => response.diagnostics) });
    }
  );

  server.registerTool(
    "calendar_awards",
    {
      title: "Award Calendar",
      description: "Search awards and return a calendar-style grouping with cheapest mileage, taxes, seats, and result ids.",
      inputSchema: calendarAwardsInputSchema
    },
    async (input) => {
      const response = record(await service.search(input));
      return asToolResult({
        calendar: buildAwardCalendar(response.results, input.groupBy),
        results: response.results,
        diagnostics: response.diagnostics
      });
    }
  );

  server.registerTool(
    "search_deals",
    {
      title: "Search Award Deals",
      description:
        "Rank cached/discovery award results by deal quality. Uses explore_awards when a search is supplied, otherwise ranks local history.",
      inputSchema: dealDigestInputSchema
    },
    async (input) => {
      const response = input.search ? record(await service.explore(input.search)) : undefined;
      const sourceResults = response?.results ?? history.list({ maxEntries: 1000 }).map((entry) => entry.result);
      const filtered = sourceResults.filter((result) => dealFilter(result, input));
      return asToolResult({
        deals: summarizeDeals(filtered, input.limit),
        diagnostics: response?.diagnostics,
        warnings: response ? [] : ["No search was supplied, so deals were ranked from local result history."]
      });
    }
  );

  server.registerTool(
    "generate_deal_digest",
    {
      title: "Generate Deal Digest",
      description: "Return a concise ranked digest of notable award leads from an explore search or local history.",
      inputSchema: dealDigestInputSchema
    },
    async (input) => {
      const response = input.search ? record(await service.explore(input.search)) : undefined;
      const sourceResults = response?.results ?? history.list({ maxEntries: 1000 }).map((entry) => entry.result);
      const deals = summarizeDeals(sourceResults.filter((result) => dealFilter(result, input)), input.limit);
      return asToolResult({
        generatedAt: new Date().toISOString(),
        dealCount: deals.length,
        deals,
        diagnostics: response?.diagnostics,
        warnings: response ? [] : ["No search was supplied, so the digest used local result history."]
      });
    }
  );

  server.registerTool(
    "source_status",
    {
      title: "Award Source Status",
      description: "Show configured data adapters, credential status, capabilities, and cache stats.",
      inputSchema: {}
    },
    async () =>
      asToolResult({
        sources: service.statuses(),
        cache: service.cacheStats(),
        feeds: {
          historyPath: config.historyPath,
          pointsWalletPath: config.pointsWalletPath,
          hotelResultsConfigured: Boolean(config.hotelResultsPath),
          hotelAlertsPath: config.hotelAlertsPath,
          transferBonusesConfigured: Boolean(config.transferBonusesPath),
          seatMapsConfigured: Boolean(config.seatMapsPath),
          fareClassesConfigured: Boolean(config.fareClassesPath)
        }
      })
  );

  server.registerTool(
    "get_transfer_partners",
    {
      title: "Get Transfer Partners",
      description: "Return built-in credit-card transfer partner metadata for common US transferable currencies.",
      inputSchema: {
        bank: z.string().optional(),
        program: z.string().optional()
      }
    },
    async ({ bank, program }) => {
      const filtered = TRANSFER_PARTNERS.filter((partner) => {
        const bankOk = bank ? partner.bank.toLowerCase().includes(bank.toLowerCase()) : true;
        const programOk = program ? partner.program.toLowerCase().includes(program.toLowerCase()) : true;
        return bankOk && programOk;
      });
      return asToolResult({ transferPartners: filtered });
    }
  );

  server.registerTool(
    "get_booking_links",
    {
      title: "Get Booking Links",
      description: "Return direct loyalty-program booking links and verification instructions for a route/date.",
      inputSchema: bookingLinksInputSchema
    },
    async (input) => asToolResult({ bookingLinks: getBookingLinks(input) })
  );

  server.registerTool(
    "build_booking_plan",
    {
      title: "Build Booking Plan",
      description: "Create point.me-style transfer and booking steps for a selected award lead.",
      inputSchema: bookingPlanInputSchema
    },
    async (input) => {
      const bonusResponse = transferBonuses.list({ bank: input.bank, program: input.program, activeOn: input.date });
      return asToolResult({
        bookingPlan: buildBookingPlan(input, TRANSFER_PARTNERS, bonusResponse.transferBonuses),
        warnings: bonusResponse.warnings
      });
    }
  );

  server.registerTool(
    "compare_cash_points",
    {
      title: "Compare Cash vs Points",
      description: "Calculate cents-per-point, transfer-bonus-adjusted point cost, and portal-vs-transfer recommendation.",
      inputSchema: cashPointsCompareInputSchema
    },
    async (input) => asToolResult({ comparison: compareCashPoints(input) })
  );

  server.registerTool(
    "get_transfer_bonuses",
    {
      title: "Get Transfer Bonuses",
      description: "Return configured current transfer bonuses from TRANSFER_BONUSES_PATH.",
      inputSchema: transferBonusInputSchema
    },
    async (input) => asToolResult(transferBonuses.list(input))
  );

  server.registerTool(
    "upsert_points_balance",
    {
      title: "Add or Update Points Balance",
      description: "Maintain a local wallet of transferable points and loyalty balances for planning.",
      inputSchema: upsertPointsBalanceInputSchema
    },
    async (input) => asToolResult({ balance: wallet.upsert(input) })
  );

  server.registerTool(
    "list_points_balances",
    {
      title: "List Points Balances",
      description: "List locally stored bank and loyalty-program point balances.",
      inputSchema: listPointsBalancesInputSchema
    },
    async (input) => asToolResult({ balances: wallet.list(input) })
  );

  server.registerTool(
    "delete_points_balance",
    {
      title: "Delete Points Balance",
      description: "Delete a locally stored points balance by id.",
      inputSchema: deletePointsBalanceInputSchema
    },
    async ({ id }) => asToolResult(wallet.delete(id))
  );

  server.registerTool(
    "search_hotels",
    {
      title: "Search Hotel Awards",
      description: "Search configured hotel award result feeds by hotel, location, program, dates, points, cash rate, and CPP.",
      inputSchema: hotelSearchInputSchema
    },
    async (input) => asToolResult(hotelSearch.search(input))
  );

  server.registerTool(
    "create_hotel_alert",
    {
      title: "Create Hotel Award Alert",
      description: "Persist a hotel award search alert definition.",
      inputSchema: createHotelAlertInputSchema
    },
    async (input) => asToolResult({ alert: hotelAlerts.create(input) })
  );

  server.registerTool(
    "list_hotel_alerts",
    {
      title: "List Hotel Award Alerts",
      description: "List saved hotel award alerts.",
      inputSchema: listHotelAlertsInputSchema
    },
    async ({ enabledOnly }) => asToolResult({ alerts: hotelAlerts.list(enabledOnly) })
  );

  server.registerTool(
    "delete_hotel_alert",
    {
      title: "Delete Hotel Award Alert",
      description: "Delete a saved hotel award alert by id.",
      inputSchema: deleteAlertInputSchema
    },
    async ({ id }) => asToolResult(hotelAlerts.delete(id))
  );

  server.registerTool(
    "run_hotel_alerts",
    {
      title: "Run Hotel Award Alerts",
      description: "Run saved hotel alerts now and return matching hotel award leads.",
      inputSchema: runHotelAlertsInputSchema
    },
    async ({ ids, enabledOnly, maxAlerts }) => {
      const selected = hotelAlerts
        .list(enabledOnly)
        .filter((alert) => (ids?.length ? ids.includes(alert.id) : true))
        .slice(0, maxAlerts);

      const runs = selected.map((alert) => {
        const response = hotelSearch.search(alert.search);
        const updatedAlert = hotelAlerts.markRun(alert.id, response.results.length);
        return {
          alert: updatedAlert ?? alert,
          matches: response.results,
          warnings: response.warnings
        };
      });

      return asToolResult({ runs });
    }
  );

  server.registerTool(
    "get_seat_map",
    {
      title: "Get Seat Map",
      description: "Return configured seat-map data or links for a flight.",
      inputSchema: seatMapInputSchema
    },
    async (input) => asToolResult(flightIntel.seatMaps(input))
  );

  server.registerTool(
    "get_fare_classes",
    {
      title: "Get Fare Classes",
      description: "Return configured fare-class or award-bucket data for a flight.",
      inputSchema: fareClassInputSchema
    },
    async (input) => asToolResult(flightIntel.fareClasses(input))
  );

  server.registerTool(
    "get_price_history",
    {
      title: "Get Award Price History",
      description: "Return locally observed historical award results captured by searches, verifies, alerts, and explores.",
      inputSchema: priceHistoryInputSchema
    },
    async (input) => asToolResult({ history: history.list(input) })
  );

  server.registerTool(
    "get_route_stats",
    {
      title: "Get Award Route Stats",
      description: "Summarize locally observed availability, cheapest mileage, taxes, programs, cabins, and first/last seen dates.",
      inputSchema: routeStatsInputSchema
    },
    async (input) => asToolResult({ stats: history.stats(input) })
  );

  server.registerTool(
    "create_alert",
    {
      title: "Create Award Alert",
      description:
        "Persist an award search alert definition. Use run_alerts to execute saved alerts and return current matches.",
      inputSchema: createAlertInputSchema
    },
    async (input) => asToolResult({ alert: alerts.create(input) })
  );

  server.registerTool(
    "list_alerts",
    {
      title: "List Award Alerts",
      description: "List saved award alerts from the file-backed alert store.",
      inputSchema: listAlertsInputSchema
    },
    async ({ enabledOnly }) => asToolResult({ alerts: alerts.list(enabledOnly) })
  );

  server.registerTool(
    "delete_alert",
    {
      title: "Delete Award Alert",
      description: "Delete a saved award alert by id.",
      inputSchema: deleteAlertInputSchema
    },
    async ({ id }) => asToolResult(alerts.delete(id))
  );

  server.registerTool(
    "run_alerts",
    {
      title: "Run Award Alerts",
      description: "Run saved alerts now and return matching award leads.",
      inputSchema: runAlertsInputSchema
    },
    async ({ ids, enabledOnly, maxAlerts }) => {
      const selected = alerts
        .list(enabledOnly)
        .filter((alert) => (ids?.length ? ids.includes(alert.id) : true))
        .slice(0, maxAlerts);

      const runs = [];
      for (const alert of selected) {
        const response = record(await service.search(alert.search));
        const matches = alerts.filterMatches(alert, response.results);
        const updatedAlert = alerts.markRun(alert.id, matches.length);
        runs.push({
          alert: updatedAlert ?? alert,
          matches,
          diagnostics: response.diagnostics
        });
      }

      return asToolResult({ runs });
    }
  );

  return server;
}

function toRoundTripLegSearch(input: RoundTripSearchInput, leg: "outbound" | "inbound"): AwardSearchInput {
  return {
    origins: leg === "outbound" ? input.origins : input.destinations,
    destinations: leg === "outbound" ? input.destinations : input.origins,
    startDate: leg === "outbound" ? input.outboundStartDate : input.returnStartDate,
    endDate: leg === "outbound" ? input.outboundEndDate : input.returnEndDate,
    cabins: input.cabins,
    passengers: input.passengers,
    programs: input.programs,
    maxResults: input.legMaxResults,
    includeTrips: input.includeTrips,
    onlyDirectFlights: input.onlyDirectFlights,
    strategy: input.strategy,
    bruteForce: input.bruteForce,
    ...awardFilters(input)
  };
}

function toMultiCityLegSearch(input: MultiCitySearchInput, leg: MultiCitySearchInput["legs"][number]): AwardSearchInput {
  return {
    origins: leg.origins,
    destinations: leg.destinations,
    startDate: leg.startDate,
    endDate: leg.endDate,
    cabins: input.cabins,
    passengers: input.passengers,
    programs: input.programs,
    maxResults: input.legMaxResults,
    includeTrips: input.includeTrips,
    onlyDirectFlights: input.onlyDirectFlights,
    strategy: input.strategy,
    bruteForce: input.bruteForce,
    ...awardFilters(input)
  };
}

function awardFilters(input: AwardResultFilters): AwardResultFilters {
  return {
    maxMileageCost: input.maxMileageCost,
    minMileageCost: input.minMileageCost,
    maxTaxes: input.maxTaxes,
    minSeats: input.minSeats,
    maxStops: input.maxStops,
    marketingAirlines: input.marketingAirlines,
    operatingAirlines: input.operatingAirlines,
    aircraft: input.aircraft,
    flightNumbers: input.flightNumbers,
    maxDurationMinutes: input.maxDurationMinutes,
    minPremiumCabinPercent: input.minPremiumCabinPercent,
    minCpp: input.minCpp,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection
  };
}

function dealFilter(result: AwardResult, input: { minCpp?: number; maxMileageCost?: number; maxTaxes?: number }): boolean {
  if (input.maxMileageCost !== undefined && (result.mileageCost ?? Number.MAX_SAFE_INTEGER) > input.maxMileageCost) {
    return false;
  }
  if (input.maxTaxes !== undefined && (result.taxes ?? Number.MAX_SAFE_INTEGER) > input.maxTaxes) {
    return false;
  }
  if (input.minCpp !== undefined && (result.centsPerPoint ?? resultCpp(result) ?? 0) < input.minCpp) {
    return false;
  }
  return true;
}

function resultCpp(result: AwardResult): number | undefined {
  if (!result.cashPrice || !result.mileageCost) {
    return undefined;
  }
  return (Math.max(0, result.cashPrice - (result.taxes ?? 0)) / result.mileageCost) * 100;
}

function asToolResult(value: object) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value as Record<string, unknown>
  };
}
