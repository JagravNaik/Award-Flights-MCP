import * as z from "zod/v4";
import { CABINS } from "./types.js";

const iataCode = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((value) => value.toUpperCase())
  .describe("IATA airport code, for example JFK or LHR.");

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date in YYYY-MM-DD format.");

const cabin = z.enum(CABINS);

const airlineCodeOrName = z.string().trim().min(1).max(80);

export const awardResultFilterSchema = {
  maxMileageCost: z.number().int().min(0).optional(),
  minMileageCost: z.number().int().min(0).optional(),
  maxTaxes: z.number().min(0).optional(),
  minSeats: z.number().int().min(1).max(9).optional(),
  maxStops: z.number().int().min(0).max(6).optional(),
  marketingAirlines: z.array(airlineCodeOrName).max(50).optional(),
  operatingAirlines: z.array(airlineCodeOrName).max(50).optional(),
  aircraft: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  flightNumbers: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  maxDurationMinutes: z.number().int().min(1).max(10080).optional(),
  minPremiumCabinPercent: z.number().min(0).max(100).optional(),
  minCpp: z.number().min(0).optional(),
  sortBy: z.enum(["date", "mileage", "taxes", "duration", "stops", "seats", "cpp", "found_at"]).default("date"),
  sortDirection: z.enum(["asc", "desc"]).default("asc")
};

export const bruteForceOptionsSchema = {
  enabled: z.boolean().default(false).describe("Force one route/date query at a time."),
  maxQueries: z.number().int().min(1).max(2000).default(100),
  concurrency: z.number().int().min(1).max(10).default(2),
  delayMs: z.number().int().min(0).max(60000).default(250)
};

export const searchAwardsInputSchema = {
  origins: z.array(iataCode).min(1).max(25),
  destinations: z.array(iataCode).min(1).max(25),
  startDate: dateString,
  endDate: dateString,
  cabins: z.array(cabin).min(1).max(4).optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  programs: z.array(z.string().trim().min(1)).max(50).optional(),
  maxResults: z.number().int().min(1).max(1000).default(50),
  includeTrips: z.boolean().default(true),
  onlyDirectFlights: z.boolean().default(false),
  strategy: z.enum(["auto", "direct", "brute_force"]).default("auto"),
  ...awardResultFilterSchema,
  bruteForce: z.object(bruteForceOptionsSchema).default({
    enabled: false,
    maxQueries: 100,
    concurrency: 2,
    delayMs: 250
  })
};

export const exploreAwardsInputSchema = {
  startDate: dateString,
  endDate: dateString,
  originRegion: z.string().trim().min(1).optional(),
  destinationRegion: z.string().trim().min(1).optional(),
  origins: z.array(iataCode).min(1).max(25).optional(),
  destinations: z.array(iataCode).min(1).max(25).optional(),
  cabins: z.array(cabin).min(1).max(4).optional(),
  programs: z.array(z.string().trim().min(1)).max(50).optional(),
  maxResults: z.number().int().min(1).max(1000).default(100),
  ...awardResultFilterSchema
};

export const calendarAwardsInputSchema = {
  ...searchAwardsInputSchema,
  groupBy: z.array(z.enum(["date", "program", "cabin", "origin", "destination"])).min(1).max(5).default(["date", "program", "cabin"])
};

export const roundTripAwardsInputSchema = {
  origins: z.array(iataCode).min(1).max(25),
  destinations: z.array(iataCode).min(1).max(25),
  outboundStartDate: dateString,
  outboundEndDate: dateString,
  returnStartDate: dateString,
  returnEndDate: dateString,
  minStayDays: z.number().int().min(0).max(365).optional(),
  maxStayDays: z.number().int().min(0).max(365).optional(),
  cabins: z.array(cabin).min(1).max(4).optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  programs: z.array(z.string().trim().min(1)).max(50).optional(),
  maxResults: z.number().int().min(1).max(500).default(50),
  legMaxResults: z.number().int().min(1).max(200).default(40),
  includeTrips: z.boolean().default(true),
  onlyDirectFlights: z.boolean().default(false),
  strategy: z.enum(["auto", "direct", "brute_force"]).default("auto"),
  ...awardResultFilterSchema,
  bruteForce: z.object(bruteForceOptionsSchema).default({
    enabled: false,
    maxQueries: 100,
    concurrency: 2,
    delayMs: 250
  })
};

export const multiCityLegInputSchema = {
  origins: z.array(iataCode).min(1).max(25),
  destinations: z.array(iataCode).min(1).max(25),
  startDate: dateString,
  endDate: dateString
};

export const multiCityAwardsInputSchema = {
  legs: z.array(z.object(multiCityLegInputSchema)).min(2).max(8),
  cabins: z.array(cabin).min(1).max(4).optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  programs: z.array(z.string().trim().min(1)).max(50).optional(),
  maxResults: z.number().int().min(1).max(500).default(50),
  legMaxResults: z.number().int().min(1).max(100).default(25),
  includeTrips: z.boolean().default(true),
  onlyDirectFlights: z.boolean().default(false),
  strategy: z.enum(["auto", "direct", "brute_force"]).default("auto"),
  ...awardResultFilterSchema,
  bruteForce: z.object(bruteForceOptionsSchema).default({
    enabled: false,
    maxQueries: 100,
    concurrency: 2,
    delayMs: 250
  })
};

export const verifyAwardInputSchema = {
  origin: iataCode,
  destination: iataCode,
  date: dateString,
  cabin: cabin.optional(),
  program: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  flightNumber: z.string().trim().min(1).optional(),
  passengers: z.number().int().min(1).max(9).default(1)
};

export const bookingLinksInputSchema = {
  origin: iataCode,
  destination: iataCode,
  date: dateString,
  programs: z.array(z.string().trim().min(1)).max(25).optional()
};

export const bookingPlanInputSchema = {
  origin: iataCode,
  destination: iataCode,
  date: dateString,
  program: z.string().trim().min(1).optional(),
  cabin: cabin.optional(),
  mileageCost: z.number().int().min(0).optional(),
  taxes: z.number().min(0).optional(),
  taxesCurrency: z.string().trim().min(1).max(3).default("USD"),
  passengers: z.number().int().min(1).max(9).default(1),
  bank: z.string().trim().min(1).optional(),
  flightNumbers: z.array(z.string().trim().min(1)).max(20).optional(),
  bookingUrl: z.string().url().optional()
};

export const cashPointsCompareInputSchema = {
  cashPrice: z.number().min(0),
  mileageCost: z.number().int().min(1),
  taxes: z.number().min(0).default(0),
  transferBonusPercent: z.number().min(0).max(500).default(0),
  portalPointsCost: z.number().int().min(1).optional(),
  currency: z.string().trim().min(1).max(3).default("USD")
};

export const createAlertInputSchema = {
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  search: z.object(searchAwardsInputSchema),
  maxMileageCost: z.number().int().min(0).optional(),
  maxTaxes: z.number().min(0).optional(),
  minSeats: z.number().int().min(1).optional()
};

export const listAlertsInputSchema = {
  enabledOnly: z.boolean().default(false)
};

export const deleteAlertInputSchema = {
  id: z.string().trim().min(1)
};

export const runAlertsInputSchema = {
  ids: z.array(z.string().trim().min(1)).optional(),
  enabledOnly: z.boolean().default(true),
  maxAlerts: z.number().int().min(1).max(100).default(25)
};

export const hotelSearchInputSchema = {
  location: z.string().trim().min(1).max(120).optional(),
  hotelName: z.string().trim().min(1).max(160).optional(),
  checkIn: dateString,
  checkOut: dateString,
  programs: z.array(z.string().trim().min(1)).max(50).optional(),
  maxPointsPerNight: z.number().int().min(0).optional(),
  maxCashRate: z.number().min(0).optional(),
  minCpp: z.number().min(0).optional(),
  maxResults: z.number().int().min(1).max(1000).default(50),
  sortBy: z.enum(["points", "cash", "cpp", "distance", "updated_at"]).default("points"),
  sortDirection: z.enum(["asc", "desc"]).default("asc")
};

export const createHotelAlertInputSchema = {
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  search: z.object(hotelSearchInputSchema)
};

export const listHotelAlertsInputSchema = {
  enabledOnly: z.boolean().default(false)
};

export const runHotelAlertsInputSchema = {
  ids: z.array(z.string().trim().min(1)).optional(),
  enabledOnly: z.boolean().default(true),
  maxAlerts: z.number().int().min(1).max(100).default(25)
};

export const seatMapInputSchema = {
  airline: z.string().trim().min(1).max(80).optional(),
  flightNumber: z.string().trim().min(1).max(20),
  date: dateString.optional(),
  origin: iataCode.optional(),
  destination: iataCode.optional(),
  cabin: cabin.optional(),
  aircraft: z.string().trim().min(1).max(80).optional()
};

export const fareClassInputSchema = {
  airline: z.string().trim().min(1).max(80).optional(),
  flightNumber: z.string().trim().min(1).max(20),
  date: dateString.optional(),
  origin: iataCode.optional(),
  destination: iataCode.optional()
};

export const transferBonusInputSchema = {
  bank: z.string().trim().min(1).optional(),
  program: z.string().trim().min(1).optional(),
  activeOn: dateString.optional()
};

export const upsertPointsBalanceInputSchema = {
  id: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  bank: z.string().trim().min(1).max(120).optional(),
  program: z.string().trim().min(1).max(120),
  balance: z.number().int().min(0),
  transferableTo: z.array(z.string().trim().min(1)).max(100).optional(),
  notes: z.string().trim().max(500).optional()
};

export const listPointsBalancesInputSchema = {
  owner: z.string().trim().min(1).optional(),
  bank: z.string().trim().min(1).optional(),
  program: z.string().trim().min(1).optional()
};

export const deletePointsBalanceInputSchema = {
  id: z.string().trim().min(1)
};

export const priceHistoryInputSchema = {
  origin: iataCode.optional(),
  destination: iataCode.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  program: z.string().trim().min(1).optional(),
  cabin: cabin.optional(),
  maxEntries: z.number().int().min(1).max(5000).default(500)
};

export const routeStatsInputSchema = {
  origin: iataCode.optional(),
  destination: iataCode.optional(),
  program: z.string().trim().min(1).optional(),
  cabin: cabin.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional()
};

export const dealDigestInputSchema = {
  search: z.object(exploreAwardsInputSchema).optional(),
  minCpp: z.number().min(0).optional(),
  maxMileageCost: z.number().int().min(0).optional(),
  maxTaxes: z.number().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(25)
};
