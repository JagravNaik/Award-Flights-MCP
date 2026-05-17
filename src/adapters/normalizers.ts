import { randomUUID } from "node:crypto";
import type { AwardResult, AwardSegment, Cabin, SourceKind } from "../domain/types.js";
import { asArray, asNumber, asString, getPath } from "../utils/jsonPath.js";

export interface NormalizeContext {
  source: string;
  sourceKind: SourceKind;
  foundAt: string;
  defaultOrigin?: string;
  defaultDestination?: string;
  defaultDate?: string;
  defaultCabin?: Cabin;
  confidence?: AwardResult["confidence"];
}

export function normalizeGenericJsonResult(raw: unknown, fieldMap: Record<string, string>, context: NormalizeContext): AwardResult {
  const read = (field: string): unknown => {
    const mapped = fieldMap[field];
    return mapped ? getPath(raw, mapped) : undefined;
  };

  const origin = asString(read("origin")) ?? context.defaultOrigin ?? "";
  const destination = asString(read("destination")) ?? context.defaultDestination ?? "";
  const departsAt = asString(read("departsAt"));
  const date = asString(read("date")) ?? departsAt?.slice(0, 10) ?? context.defaultDate ?? "";
  const flightNumbers = splitFlightNumbers(asString(read("flightNumbers")));
  const cabin = asString(read("cabin")) ?? context.defaultCabin;

  return {
    id: asString(read("id")) ?? stableishId(context.source, origin, destination, date, cabin, flightNumbers),
    source: context.source,
    sourceKind: context.sourceKind,
    foundAt: context.foundAt,
    confidence: context.confidence ?? "medium",
    program: asString(read("program")),
    origin,
    destination,
    date,
    cabin,
    seats: asNumber(read("seats")),
    mileageCost: asNumber(read("mileageCost")),
    taxes: asNumber(read("taxes")),
    taxesCurrency: asString(read("taxesCurrency")),
    cashPrice: asNumber(read("cashPrice")),
    cashCurrency: asString(read("cashCurrency")),
    portalPointsCost: asNumber(read("portalPointsCost")),
    centsPerPoint: asNumber(read("centsPerPoint")),
    durationMinutes: asNumber(read("durationMinutes")),
    stops: asNumber(read("stops")),
    premiumCabinPercent: asNumber(read("premiumCabinPercent")),
    marketingAirline: asString(read("marketingAirline")),
    operatingAirline: asString(read("operatingAirline")),
    flightNumbers,
    aircraft: asString(read("aircraft")),
    fareClass: asString(read("fareClass")),
    changeFee: asString(read("changeFee")),
    cancellationFee: asString(read("cancellationFee")),
    bookingUrl: asString(read("bookingUrl")),
    rawUrl: asString(read("rawUrl")),
    segments: normalizeSegments(read("segments"), cabin),
    warnings: [],
    raw
  };
}

export function normalizeSeatsAeroItem(raw: unknown, context: NormalizeContext): AwardResult[] {
  const record = asRecord(raw);
  const trips = asArray(record.Trips ?? record.trips ?? record.AvailabilityTrips ?? record.availabilityTrips);
  if (trips.length > 0) {
    return trips.map((trip) => normalizeSeatsAeroTrip(trip, raw, context));
  }

  return [normalizeSeatsAeroAvailability(raw, context)];
}

function normalizeSeatsAeroTrip(rawTrip: unknown, parent: unknown, context: NormalizeContext): AwardResult {
  const trip = asRecord(rawTrip);
  const availability = asRecord(parent);
  const origin = readString(trip, ["OriginAirport", "originAirport", "Origin", "origin"]) ??
    readString(availability, ["OriginAirport", "originAirport", "Origin", "origin"]) ??
    context.defaultOrigin ??
    "";
  const destination = readString(trip, ["DestinationAirport", "destinationAirport", "Destination", "destination"]) ??
    readString(availability, ["DestinationAirport", "destinationAirport", "Destination", "destination"]) ??
    context.defaultDestination ??
    "";
  const departsAt = readString(trip, ["DepartsAt", "departsAt", "DepartureTime", "departureTime"]);
  const date = departsAt?.slice(0, 10) ??
    readString(availability, ["Date", "date", "DepartureDate", "departureDate"]) ??
    context.defaultDate ??
    "";
  const cabin = readString(trip, ["Cabin", "cabin"]) ?? context.defaultCabin;
  const flightNumbers = splitFlightNumbers(readString(trip, ["FlightNumbers", "flightNumbers", "FlightNumber", "flightNumber"]));

  return {
    id: readString(trip, ["ID", "Id", "id"]) ?? stableishId(context.source, origin, destination, date, cabin, flightNumbers),
    source: context.source,
    sourceKind: context.sourceKind,
    sourceUpdatedAt: readString(availability, ["UpdatedAt", "updatedAt"]),
    foundAt: context.foundAt,
    confidence: "medium",
    program: readString(trip, ["Source", "source"]) ?? readString(availability, ["Source", "source"]),
    origin,
    destination,
    date,
    cabin,
    seats: readNumber(trip, ["RemainingSeats", "remainingSeats", "Seats", "seats"]),
    mileageCost: readNumber(trip, ["MileageCost", "mileageCost", "Miles", "miles"]),
    taxes: centsToMajor(readNumber(trip, ["TotalTaxes", "totalTaxes", "Taxes", "taxes"])),
    taxesCurrency: readString(trip, ["TaxesCurrency", "taxesCurrency"]),
    durationMinutes: readNumber(trip, ["TotalDuration", "totalDuration", "Duration", "duration"]),
    stops: readNumber(trip, ["Stops", "stops"]),
    marketingAirline: readString(trip, ["Carriers", "carriers", "MarketingAirline", "marketingAirline"]),
    operatingAirline: readString(trip, ["OperatingAirline", "operatingAirline"]),
    flightNumbers,
    bookingUrl: readString(trip, ["BookingUrl", "bookingUrl", "URL", "url"]),
    segments: normalizeSegments(trip.Segments ?? trip.segments, cabin),
    warnings: [],
    raw: rawTrip
  };
}

function normalizeSeatsAeroAvailability(raw: unknown, context: NormalizeContext): AwardResult {
  const item = asRecord(raw);
  const origin = readString(item, ["OriginAirport", "originAirport", "Origin", "origin"]) ?? context.defaultOrigin ?? "";
  const destination = readString(item, ["DestinationAirport", "destinationAirport", "Destination", "destination"]) ??
    context.defaultDestination ??
    "";
  const date = readString(item, ["Date", "date", "DepartureDate", "departureDate"]) ?? context.defaultDate ?? "";
  const cabin = context.defaultCabin ?? inferCabinFromAvailability(item);

  return {
    id: readString(item, ["ID", "Id", "id"]) ?? stableishId(context.source, origin, destination, date, cabin, []),
    source: context.source,
    sourceKind: context.sourceKind,
    sourceUpdatedAt: readString(item, ["UpdatedAt", "updatedAt"]),
    foundAt: context.foundAt,
    confidence: "low",
    program: readString(item, ["Source", "source"]),
    origin,
    destination,
    date,
    cabin,
    seats: inferSeatsFromAvailability(item, cabin),
    mileageCost: inferMileageFromAvailability(item, cabin),
    taxes: centsToMajor(inferTaxesFromAvailability(item, cabin)),
    taxesCurrency: readString(item, ["TaxesCurrency", "taxesCurrency"]),
    stops: readNumber(item, ["Stops", "stops"]),
    flightNumbers: splitFlightNumbers(readString(item, ["FlightNumbers", "flightNumbers"])),
    segments: [],
    warnings: ["Summary availability result. Run verify_award or includeTrips=true when supported before transferring points."],
    raw
  };
}

function normalizeSegments(value: unknown, fallbackCabin: string | undefined): AwardSegment[] {
  return asArray(value).map((segment) => {
    const item = asRecord(segment);
    return {
      origin: readString(item, ["OriginAirport", "originAirport", "Origin", "origin"]),
      destination: readString(item, ["DestinationAirport", "destinationAirport", "Destination", "destination"]),
      marketingAirline: readString(item, ["MarketingAirline", "marketingAirline", "Carrier", "carrier"]),
      operatingAirline: readString(item, ["OperatingAirline", "operatingAirline"]),
      flightNumber: readString(item, ["FlightNumber", "flightNumber", "FlightNumbers", "flightNumbers"]),
      aircraft: readString(item, ["Aircraft", "aircraft"]),
      cabin: readString(item, ["Cabin", "cabin"]) ?? fallbackCabin,
      departsAt: readString(item, ["DepartsAt", "departsAt", "DepartureTime", "departureTime"]),
      arrivesAt: readString(item, ["ArrivesAt", "arrivesAt", "ArrivalTime", "arrivalTime"]),
      durationMinutes: readNumber(item, ["DurationMinutes", "durationMinutes", "Duration", "duration"]),
      distanceMiles: readNumber(item, ["DistanceMiles", "distanceMiles", "Distance", "distance"]),
      fareClass: readString(item, ["FareClass", "fareClass", "BookingClass", "bookingClass"])
    };
  });
}

export function extractResultItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  for (const key of ["data", "results", "Results", "availability", "Availability"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

export function extractCursor(payload: unknown): number | undefined {
  const record = asRecord(payload);
  return readNumber(record, ["cursor", "Cursor"]);
}

export function splitFlightNumbers(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function inferCabinFromAvailability(record: Record<string, unknown>): Cabin | undefined {
  const cabinChecks: Array<[Cabin, string[]]> = [
    ["first", ["FAvailable", "FirstAvailable", "firstAvailable"]],
    ["business", ["JAvailable", "BusinessAvailable", "businessAvailable"]],
    ["premium", ["WAvailable", "PremiumAvailable", "premiumAvailable"]],
    ["economy", ["YAvailable", "EconomyAvailable", "economyAvailable"]]
  ];

  return cabinChecks.find(([, keys]) => keys.some((key) => Boolean(record[key])))?.[0];
}

function inferSeatsFromAvailability(record: Record<string, unknown>, cabin: string | undefined): number | undefined {
  return cabin ? readNumber(record, [`${cabin}Seats`, `${cabin}_seats`, `${cabin}AvailableSeats`]) : undefined;
}

function inferMileageFromAvailability(record: Record<string, unknown>, cabin: string | undefined): number | undefined {
  const prefix = cabin ? cabin[0]?.toUpperCase() : undefined;
  return readNumber(record, [
    "MileageCost",
    "mileageCost",
    ...(prefix ? [`${prefix}MileageCost`, `${prefix}Mileage`, `${prefix}Cost`] : [])
  ]);
}

function inferTaxesFromAvailability(record: Record<string, unknown>, cabin: string | undefined): number | undefined {
  const prefix = cabin ? cabin[0]?.toUpperCase() : undefined;
  return readNumber(record, ["TotalTaxes", "totalTaxes", ...(prefix ? [`${prefix}TotalTaxes`, `${prefix}Taxes`] : [])]);
}

function centsToMajor(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value > 1000 ? Math.round(value) / 100 : value;
}

function stableishId(
  source: string,
  origin: string,
  destination: string,
  date: string,
  cabin: string | undefined,
  flightNumbers: string[]
): string {
  const base = [source, origin, destination, date, cabin, ...flightNumbers].filter(Boolean).join(":");
  return base.length > 8 ? base : randomUUID();
}
