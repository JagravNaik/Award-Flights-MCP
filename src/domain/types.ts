export const CABINS = ["economy", "premium", "business", "first"] as const;
export type Cabin = (typeof CABINS)[number];

export type SourceKind = "partner_api" | "public_json" | "manual" | "cache";
export type SourceHealth = "ready" | "disabled" | "missing_credentials" | "rate_limited" | "error";
export type SearchStrategy = "auto" | "direct" | "brute_force";
export type AwardSortBy = "date" | "mileage" | "taxes" | "duration" | "stops" | "seats" | "cpp" | "found_at";
export type SortDirection = "asc" | "desc";

export interface SearchWindow {
  startDate: string;
  endDate: string;
}

export interface AwardResultFilters {
  maxMileageCost?: number;
  minMileageCost?: number;
  maxTaxes?: number;
  minSeats?: number;
  maxStops?: number;
  marketingAirlines?: string[];
  operatingAirlines?: string[];
  aircraft?: string[];
  flightNumbers?: string[];
  maxDurationMinutes?: number;
  minPremiumCabinPercent?: number;
  minCpp?: number;
  sortBy?: AwardSortBy;
  sortDirection?: SortDirection;
}

export interface AwardSearchInput extends SearchWindow, AwardResultFilters {
  origins: string[];
  destinations: string[];
  cabins?: Cabin[];
  passengers: number;
  programs?: string[];
  maxResults: number;
  includeTrips: boolean;
  onlyDirectFlights: boolean;
  strategy: SearchStrategy;
  bruteForce: BruteForceOptions;
}

export interface BruteForceOptions {
  enabled: boolean;
  maxQueries: number;
  concurrency: number;
  delayMs: number;
}

export interface AwardExploreInput extends SearchWindow, AwardResultFilters {
  originRegion?: string;
  destinationRegion?: string;
  origins?: string[];
  destinations?: string[];
  cabins?: Cabin[];
  programs?: string[];
  maxResults: number;
}

export interface AwardCalendarInput extends AwardSearchInput {
  groupBy?: Array<"date" | "program" | "cabin" | "origin" | "destination">;
}

export interface RoundTripSearchInput extends AwardResultFilters {
  origins: string[];
  destinations: string[];
  outboundStartDate: string;
  outboundEndDate: string;
  returnStartDate: string;
  returnEndDate: string;
  minStayDays?: number;
  maxStayDays?: number;
  cabins?: Cabin[];
  passengers: number;
  programs?: string[];
  maxResults: number;
  legMaxResults: number;
  includeTrips: boolean;
  onlyDirectFlights: boolean;
  strategy: SearchStrategy;
  bruteForce: BruteForceOptions;
}

export interface MultiCityLegInput extends SearchWindow {
  origins: string[];
  destinations: string[];
}

export interface MultiCitySearchInput extends AwardResultFilters {
  legs: MultiCityLegInput[];
  cabins?: Cabin[];
  passengers: number;
  programs?: string[];
  maxResults: number;
  legMaxResults: number;
  includeTrips: boolean;
  onlyDirectFlights: boolean;
  strategy: SearchStrategy;
  bruteForce: BruteForceOptions;
}

export interface AwardVerifyInput {
  origin: string;
  destination: string;
  date: string;
  cabin?: Cabin;
  program?: string;
  source?: string;
  flightNumber?: string;
  passengers: number;
}

export interface AwardSegment {
  origin?: string;
  destination?: string;
  marketingAirline?: string;
  operatingAirline?: string;
  flightNumber?: string;
  aircraft?: string;
  cabin?: Cabin | string;
  departsAt?: string;
  arrivesAt?: string;
  durationMinutes?: number;
  distanceMiles?: number;
  fareClass?: string;
}

export interface AwardResult {
  id: string;
  source: string;
  sourceKind: SourceKind;
  sourceUpdatedAt?: string;
  foundAt: string;
  staleAfter?: string;
  confidence: "high" | "medium" | "low";
  program?: string;
  origin: string;
  destination: string;
  date: string;
  cabin?: Cabin | string;
  seats?: number;
  mileageCost?: number;
  taxes?: number;
  taxesCurrency?: string;
  cashPrice?: number;
  cashCurrency?: string;
  portalPointsCost?: number;
  centsPerPoint?: number;
  durationMinutes?: number;
  stops?: number;
  premiumCabinPercent?: number;
  marketingAirline?: string;
  operatingAirline?: string;
  flightNumbers?: string[];
  aircraft?: string;
  fareClass?: string;
  changeFee?: string;
  cancellationFee?: string;
  bookingUrl?: string;
  rawUrl?: string;
  segments: AwardSegment[];
  warnings: string[];
  raw?: unknown;
}

export interface AwardItinerary {
  id: string;
  type: "round_trip" | "multi_city";
  legs: AwardResult[];
  totalMileageCost?: number;
  totalTaxes?: number;
  taxesCurrency?: string;
  totalDurationMinutes?: number;
  totalStops?: number;
  minSeats?: number;
  programs: string[];
  warnings: string[];
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: SourceKind;
  health: SourceHealth;
  message?: string;
  supportsLive: boolean;
  supportsCached: boolean;
  supportsBatch: boolean;
  supportsExplore: boolean;
  rateLimitMs?: number;
}

export interface SearchDiagnostics {
  strategy: SearchStrategy;
  adaptersUsed: string[];
  adaptersSkipped: SourceStatus[];
  attemptedQueries: number;
  cacheHits: number;
  warnings: string[];
  elapsedMs: number;
}

export interface AwardSearchResponse {
  results: AwardResult[];
  diagnostics: SearchDiagnostics;
}

export interface TransferPartner {
  bank: string;
  program: string;
  transferRatio: string;
  typicalTransferTime?: string;
  notes?: string;
}

export interface TransferBonus {
  id: string;
  bank: string;
  program: string;
  bonusPercent: number;
  startDate?: string;
  endDate?: string;
  source?: string;
  notes?: string;
}

export interface AwardAlert {
  id: string;
  name: string;
  enabled: boolean;
  search: AwardSearchInput;
  maxMileageCost?: number;
  maxTaxes?: number;
  minSeats?: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastMatchCount?: number;
}

export interface PointsBalance {
  id: string;
  owner?: string;
  bank?: string;
  program: string;
  balance: number;
  transferableTo?: string[];
  notes?: string;
  updatedAt: string;
}

export interface HotelSearchInput {
  location?: string;
  hotelName?: string;
  checkIn: string;
  checkOut: string;
  programs?: string[];
  maxPointsPerNight?: number;
  maxCashRate?: number;
  minCpp?: number;
  maxResults: number;
  sortBy?: "points" | "cash" | "cpp" | "distance" | "updated_at";
  sortDirection?: SortDirection;
}

export interface HotelResult {
  id: string;
  source: string;
  foundAt: string;
  hotelName: string;
  location?: string;
  program?: string;
  checkIn: string;
  checkOut: string;
  pointsPerNight?: number;
  cashRate?: number;
  cashCurrency?: string;
  centsPerPoint?: number;
  distanceMiles?: number;
  roomName?: string;
  bookingUrl?: string;
  warnings: string[];
  raw?: unknown;
}

export interface HotelAlert {
  id: string;
  name: string;
  enabled: boolean;
  search: HotelSearchInput;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastMatchCount?: number;
}

export interface SeatMapInput {
  airline?: string;
  flightNumber: string;
  date?: string;
  origin?: string;
  destination?: string;
  cabin?: Cabin;
  aircraft?: string;
}

export interface SeatMapResult {
  id: string;
  source: string;
  airline?: string;
  flightNumber: string;
  date?: string;
  aircraft?: string;
  cabin?: string;
  seatMapUrl?: string;
  seats?: Array<{
    seat: string;
    status: "available" | "occupied" | "blocked" | "unknown";
    notes?: string;
  }>;
  warnings: string[];
}

export interface FareClassInput {
  airline?: string;
  flightNumber: string;
  date?: string;
  origin?: string;
  destination?: string;
}

export interface FareClassResult {
  id: string;
  source: string;
  airline?: string;
  flightNumber: string;
  date?: string;
  cabin?: string;
  fareClass: string;
  seats?: number;
  awardBucket?: boolean;
  notes?: string;
}
