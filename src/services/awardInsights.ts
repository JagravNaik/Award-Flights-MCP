import type { AwardResult, TransferBonus, TransferPartner } from "../domain/types.js";

export function buildAwardCalendar(results: AwardResult[], groupBy: string[]) {
  const buckets = new Map<string, AwardResult[]>();
  for (const result of results) {
    const key = groupBy.map((field) => bucketValue(result, field)).join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), result]);
  }

  return Array.from(buckets.entries())
    .map(([key, bucketResults]) => {
      const mileageValues = bucketResults.map((result) => result.mileageCost).filter((value): value is number => typeof value === "number");
      const taxValues = bucketResults.map((result) => result.taxes).filter((value): value is number => typeof value === "number");
      const seatValues = bucketResults.map((result) => result.seats).filter((value): value is number => typeof value === "number");
      return {
        key,
        group: Object.fromEntries(groupBy.map((field, index) => [field, key.split("|")[index] || undefined])),
        resultCount: bucketResults.length,
        cheapestMileageCost: mileageValues.length ? Math.min(...mileageValues) : undefined,
        lowestTaxes: taxValues.length ? Math.min(...taxValues) : undefined,
        maxSeats: seatValues.length ? Math.max(...seatValues) : undefined,
        bestResultId: [...bucketResults].sort(compareAwardResults)[0]?.id,
        resultIds: bucketResults.map((result) => result.id)
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function compareCashPoints(input: {
  cashPrice: number;
  mileageCost: number;
  taxes: number;
  transferBonusPercent: number;
  portalPointsCost?: number;
  currency: string;
}) {
  const effectiveMiles = Math.ceil(input.mileageCost / (1 + input.transferBonusPercent / 100));
  const awardNetValue = Math.max(0, input.cashPrice - input.taxes);
  const centsPerPoint = (awardNetValue / effectiveMiles) * 100;
  const portalCpp = input.portalPointsCost ? (input.cashPrice / input.portalPointsCost) * 100 : undefined;

  return {
    currency: input.currency,
    cashPrice: input.cashPrice,
    awardTaxes: input.taxes,
    mileageCost: input.mileageCost,
    effectiveTransferablePointsNeeded: effectiveMiles,
    transferBonusPercent: input.transferBonusPercent,
    centsPerPoint,
    portalPointsCost: input.portalPointsCost,
    portalCentsPerPoint: portalCpp,
    recommendation: portalCpp !== undefined && portalCpp > centsPerPoint ? "portal_cash_booking" : "transfer_partner_award"
  };
}

export function buildBookingPlan(
  input: {
    origin: string;
    destination: string;
    date: string;
    program?: string;
    cabin?: string;
    mileageCost?: number;
    taxes?: number;
    taxesCurrency?: string;
    passengers: number;
    bank?: string;
    flightNumbers?: string[];
    bookingUrl?: string;
  },
  transferPartners: TransferPartner[],
  transferBonuses: TransferBonus[]
) {
  const matchingPartners = transferPartners.filter((partner) => {
    const bankOk = input.bank ? includes(partner.bank, input.bank) : true;
    const programOk = input.program ? includes(partner.program, input.program) : true;
    return bankOk && programOk;
  });

  const matchingBonuses = transferBonuses.filter((bonus) => {
    const bankOk = input.bank ? includes(bonus.bank, input.bank) : true;
    const programOk = input.program ? includes(bonus.program, input.program) : true;
    return bankOk && programOk;
  });

  return {
    route: `${input.origin}-${input.destination}`,
    date: input.date,
    program: input.program,
    estimatedCost: {
      mileageCost: input.mileageCost,
      taxes: input.taxes,
      taxesCurrency: input.taxesCurrency
    },
    transferPartners: matchingPartners,
    transferBonuses: matchingBonuses,
    steps: [
      "Verify the exact flight on the operating loyalty program before moving points.",
      "Confirm passenger count, cabin, flight numbers, mileage, taxes, and cancellation rules.",
      "Check transfer partners and any active transfer bonus for the selected program.",
      "Transfer only the points needed after availability is confirmed.",
      "Book on the loyalty program website and save the confirmation number."
    ],
    bookingUrl: input.bookingUrl,
    warnings: [
      "Award space can disappear while points are transferring.",
      "Most transferable points cannot be reversed after transfer.",
      "Some itineraries include mixed cabins, married-segment logic, or phantom availability."
    ]
  };
}

export function summarizeDeals(results: AwardResult[], limit: number) {
  return results
    .map((result) => ({
      result,
      score: dealScore(result),
      centsPerPoint: result.centsPerPoint ?? computeCpp(result)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.result.id,
      route: `${entry.result.origin}-${entry.result.destination}`,
      date: entry.result.date,
      program: entry.result.program,
      cabin: entry.result.cabin,
      mileageCost: entry.result.mileageCost,
      taxes: entry.result.taxes,
      seats: entry.result.seats,
      centsPerPoint: entry.centsPerPoint,
      score: entry.score,
      bookingUrl: entry.result.bookingUrl,
      warnings: entry.result.warnings
    }));
}

function bucketValue(result: AwardResult, field: string): string {
  switch (field) {
    case "program":
      return result.program ?? "unknown";
    case "cabin":
      return result.cabin?.toString() ?? "unknown";
    case "origin":
      return result.origin;
    case "destination":
      return result.destination;
    case "date":
    default:
      return result.date;
  }
}

function compareAwardResults(left: AwardResult, right: AwardResult): number {
  const mileageCompare = (left.mileageCost ?? Number.MAX_SAFE_INTEGER) - (right.mileageCost ?? Number.MAX_SAFE_INTEGER);
  if (mileageCompare !== 0) {
    return mileageCompare;
  }
  return (left.taxes ?? Number.MAX_SAFE_INTEGER) - (right.taxes ?? Number.MAX_SAFE_INTEGER);
}

function dealScore(result: AwardResult): number {
  const cpp = result.centsPerPoint ?? computeCpp(result) ?? 0;
  const seatBoost = Math.min(result.seats ?? 1, 4) * 0.1;
  const cabinBoost = result.cabin === "first" ? 0.6 : result.cabin === "business" ? 0.4 : result.cabin === "premium" ? 0.2 : 0;
  const taxPenalty = (result.taxes ?? 0) / 1000;
  return cpp + seatBoost + cabinBoost - taxPenalty;
}

function computeCpp(result: AwardResult): number | undefined {
  if (!result.cashPrice || !result.mileageCost) {
    return undefined;
  }
  return (Math.max(0, result.cashPrice - (result.taxes ?? 0)) / result.mileageCost) * 100;
}

function includes(value: string, needle: string): boolean {
  return normalize(value).includes(normalize(needle));
}

function normalize(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
