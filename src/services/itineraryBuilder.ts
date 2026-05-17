import type { AwardItinerary, AwardResult } from "../domain/types.js";

export function buildRoundTripItineraries(input: {
  outbound: AwardResult[];
  inbound: AwardResult[];
  minStayDays?: number;
  maxStayDays?: number;
  maxResults: number;
}): AwardItinerary[] {
  const itineraries: AwardItinerary[] = [];
  for (const outbound of input.outbound) {
    for (const inbound of input.inbound) {
      const stayDays = daysBetween(outbound.date, inbound.date);
      if (stayDays < (input.minStayDays ?? 0)) {
        continue;
      }
      if (input.maxStayDays !== undefined && stayDays > input.maxStayDays) {
        continue;
      }
      itineraries.push(toItinerary("round_trip", [outbound, inbound]));
    }
  }
  return itineraries.sort(compareItineraries).slice(0, input.maxResults);
}

export function buildMultiCityItineraries(legResults: AwardResult[][], maxResults: number): AwardItinerary[] {
  const combinations: AwardResult[][] = [[]];
  for (const results of legResults) {
    const next: AwardResult[][] = [];
    for (const existing of combinations) {
      for (const result of results) {
        next.push([...existing, result]);
        if (next.length > maxResults * 20) {
          break;
        }
      }
      if (next.length > maxResults * 20) {
        break;
      }
    }
    combinations.splice(0, combinations.length, ...next);
  }

  return combinations.map((legs) => toItinerary("multi_city", legs)).sort(compareItineraries).slice(0, maxResults);
}

function toItinerary(type: "round_trip" | "multi_city", legs: AwardResult[]): AwardItinerary {
  const mileageValues = legs.map((leg) => leg.mileageCost);
  const taxesValues = legs.map((leg) => leg.taxes);
  const durationValues = legs.map((leg) => leg.durationMinutes);
  const stopValues = legs.map((leg) => leg.stops);
  const seatValues = legs.map((leg) => leg.seats).filter((value): value is number => typeof value === "number");

  return {
    id: `${type}:${legs.map((leg) => leg.id).join(":")}`,
    type,
    legs,
    totalMileageCost: mileageValues.every((value) => typeof value === "number") ? sum(mileageValues as number[]) : undefined,
    totalTaxes: taxesValues.every((value) => typeof value === "number") ? roundCurrency(sum(taxesValues as number[])) : undefined,
    taxesCurrency: legs.find((leg) => leg.taxesCurrency)?.taxesCurrency,
    totalDurationMinutes: durationValues.every((value) => typeof value === "number") ? sum(durationValues as number[]) : undefined,
    totalStops: stopValues.every((value) => typeof value === "number") ? sum(stopValues as number[]) : undefined,
    minSeats: seatValues.length ? Math.min(...seatValues) : undefined,
    programs: unique(legs.map((leg) => leg.program)),
    warnings: unique(legs.flatMap((leg) => leg.warnings))
  };
}

function compareItineraries(left: AwardItinerary, right: AwardItinerary): number {
  const mileageCompare = (left.totalMileageCost ?? Number.MAX_SAFE_INTEGER) - (right.totalMileageCost ?? Number.MAX_SAFE_INTEGER);
  if (mileageCompare !== 0) {
    return mileageCompare;
  }
  return (left.totalTaxes ?? Number.MAX_SAFE_INTEGER) - (right.totalTaxes ?? Number.MAX_SAFE_INTEGER);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
