import type { AppConfig } from "../config.js";
import type {
  AwardExploreInput,
  AwardResult,
  AwardResultFilters,
  AwardSearchInput,
  AwardSearchResponse,
  AwardVerifyInput,
  SearchDiagnostics,
  SourceStatus
} from "../domain/types.js";
import { InMemoryCache } from "../utils/cache.js";
import { runLimited } from "../utils/concurrency.js";
import { assertDateWindow, eachDateInclusive } from "../utils/dates.js";
import type { AdapterSearchResponse, AwardSourceAdapter } from "../adapters/types.js";

interface SearchJob {
  adapter: AwardSourceAdapter;
  input: AwardSearchInput;
  cacheKey: string;
}

export class AwardSearchService {
  private readonly cache: InMemoryCache<AdapterSearchResponse>;

  constructor(
    private readonly adapters: AwardSourceAdapter[],
    private readonly config: AppConfig
  ) {
    this.cache = new InMemoryCache<AdapterSearchResponse>(config.cacheTtlSeconds * 1000);
  }

  async search(input: AwardSearchInput): Promise<AwardSearchResponse> {
    const startedAt = Date.now();
    assertDateWindow(input.startDate, input.endDate);

    const readyAdapters = this.adapters.filter((adapter) => adapter.status().health === "ready");
    const skipped = this.adapters.map((adapter) => adapter.status()).filter((status) => status.health !== "ready");
    const warnings: string[] = [];

    if (readyAdapters.length === 0) {
      warnings.push(
        "No ready award data adapters are configured. Enable the local award feed, Award Flight Daily, a public JSON adapter, or an optional provider adapter with credentials."
      );
    }

    const jobs = this.buildJobs(readyAdapters, input, warnings);
    this.assertJobLimit(jobs.length, input.bruteForce.maxQueries);

    let cacheHits = 0;
    const responses = await runLimited(jobs, input.bruteForce.concurrency, input.bruteForce.delayMs, async (job) => {
      const cached = this.cache.get(job.cacheKey);
      if (cached) {
        cacheHits += 1;
        return cached;
      }

      const response = await this.safeAdapterSearch(job.adapter, job.input);
      this.cache.set(job.cacheKey, response, this.config.cacheTtlSeconds * 1000);
      return response;
    });

    const results = this.finalizeResults(
      responses.flatMap((response) => {
        warnings.push(...response.warnings);
        return response.results;
      }),
      input
    );

    return {
      results,
      diagnostics: this.buildDiagnostics(input, readyAdapters, skipped, jobs.length, cacheHits, warnings, startedAt)
    };
  }

  async explore(input: AwardExploreInput): Promise<AwardSearchResponse> {
    const startedAt = Date.now();
    assertDateWindow(input.startDate, input.endDate);
    const warnings: string[] = [];
    const readyAdapters = this.adapters.filter((adapter) => adapter.status().health === "ready" && adapter.supportsExplore);
    const skipped = this.adapters.map((adapter) => adapter.status()).filter((status) => status.health !== "ready" || !status.supportsExplore);

    const responses = await runLimited(readyAdapters, this.config.defaultConcurrency, this.config.defaultDelayMs, async (adapter) => {
      const cacheKey = `explore:${adapter.id}:${JSON.stringify(input)}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const response = await this.safeAdapterExplore(adapter, input);
      const normalized = response ?? { results: [], warnings: [`${adapter.id} does not implement explore.`] };
      this.cache.set(cacheKey, normalized, this.config.cacheTtlSeconds * 1000);
      return normalized;
    });

    const results = this.finalizeResults(
      responses.flatMap((response) => {
        warnings.push(...response.warnings);
        return response.results;
      }),
      input
    );

    return {
      results,
      diagnostics: {
        strategy: "direct",
        adaptersUsed: readyAdapters.map((adapter) => adapter.id),
        adaptersSkipped: skipped,
        attemptedQueries: readyAdapters.length,
        cacheHits: 0,
        warnings,
        elapsedMs: Date.now() - startedAt
      }
    };
  }

  async verify(input: AwardVerifyInput): Promise<AwardSearchResponse> {
    const startedAt = Date.now();
    const adapters = this.adapters.filter((adapter) => {
      const status = adapter.status();
      return status.health === "ready" && (!input.source || adapter.id === input.source);
    });
    const skipped = this.adapters.map((adapter) => adapter.status()).filter((status) => !adapters.some((adapter) => adapter.id === status.id));
    const warnings: string[] = [];

    const responses = await runLimited(adapters, this.config.defaultConcurrency, this.config.defaultDelayMs, async (adapter) => {
      if (adapter.verify) {
        return this.safeAdapterVerify(adapter, input);
      }

      return this.safeAdapterSearch(adapter, {
        origins: [input.origin],
        destinations: [input.destination],
        startDate: input.date,
        endDate: input.date,
        cabins: input.cabin ? [input.cabin] : undefined,
        passengers: input.passengers,
        programs: input.program ? [input.program] : undefined,
        maxResults: 50,
        includeTrips: true,
        onlyDirectFlights: false,
        strategy: "direct",
        bruteForce: {
          enabled: false,
          maxQueries: 1,
          concurrency: 1,
          delayMs: this.config.defaultDelayMs
        }
      });
    });

    const results = this.finalizeResults(
      responses.flatMap((response) => {
        warnings.push(...response.warnings);
        return input.flightNumber
          ? response.results.filter((result) => result.flightNumbers?.some((flight) => sameFlight(flight, input.flightNumber ?? "")))
          : response.results;
      }),
      { maxResults: 50 }
    );

    return {
      results,
      diagnostics: {
        strategy: "direct",
        adaptersUsed: adapters.map((adapter) => adapter.id),
        adaptersSkipped: skipped,
        attemptedQueries: adapters.length,
        cacheHits: 0,
        warnings: [...warnings, "Availability can change quickly. Treat verification as a fresh lead, not a ticket hold."],
        elapsedMs: Date.now() - startedAt
      }
    };
  }

  statuses(): SourceStatus[] {
    return this.adapters.map((adapter) => adapter.status());
  }

  cacheStats(): { size: number } {
    return this.cache.stats();
  }

  private async safeAdapterSearch(adapter: AwardSourceAdapter, input: AwardSearchInput): Promise<AdapterSearchResponse> {
    try {
      return await adapter.search(input);
    } catch (error) {
      return { results: [], warnings: [`${adapter.id} failed: ${errorMessage(error)}`] };
    }
  }

  private async safeAdapterExplore(adapter: AwardSourceAdapter, input: AwardExploreInput): Promise<AdapterSearchResponse | undefined> {
    try {
      return await adapter.explore?.(input);
    } catch (error) {
      return { results: [], warnings: [`${adapter.id} explore failed: ${errorMessage(error)}`] };
    }
  }

  private async safeAdapterVerify(adapter: AwardSourceAdapter, input: AwardVerifyInput): Promise<AdapterSearchResponse> {
    try {
      return await adapter.verify?.(input) ?? { results: [], warnings: [`${adapter.id} does not implement verify.`] };
    } catch (error) {
      return { results: [], warnings: [`${adapter.id} verify failed: ${errorMessage(error)}`] };
    }
  }

  private buildJobs(adapters: AwardSourceAdapter[], input: AwardSearchInput, warnings: string[]): SearchJob[] {
    const jobs: SearchJob[] = [];
    const forceBrute = input.strategy === "brute_force" || input.bruteForce.enabled;

    for (const adapter of adapters) {
      const shouldBruteForce = forceBrute || !adapter.supportsBatch;
      if (!shouldBruteForce && input.strategy !== "brute_force") {
        jobs.push({
          adapter,
          input,
          cacheKey: `search:${adapter.id}:${JSON.stringify(input)}`
        });
        continue;
      }

      warnings.push(`${adapter.id} will run controlled brute-force route/date enumeration.`);
      for (const origin of input.origins) {
        for (const destination of input.destinations) {
          for (const date of eachDateInclusive(input.startDate, input.endDate)) {
            jobs.push({
              adapter,
              input: {
                ...input,
                origins: [origin],
                destinations: [destination],
                startDate: date,
                endDate: date,
                strategy: "brute_force"
              },
              cacheKey: `search:${adapter.id}:${origin}:${destination}:${date}:${JSON.stringify({
                cabins: input.cabins,
                passengers: input.passengers,
                programs: input.programs,
                includeTrips: input.includeTrips,
                onlyDirectFlights: input.onlyDirectFlights
              })}`
            });
          }
        }
      }
    }

    return jobs;
  }

  private assertJobLimit(jobCount: number, requestedMax: number): void {
    const hardLimit = Math.min(requestedMax, this.config.maxBruteForceQueries);
    if (jobCount > hardLimit) {
      throw new Error(
        `Search would run ${jobCount} adapter queries, above the configured limit of ${hardLimit}. Narrow dates/routes or raise AWARD_MAX_BRUTE_FORCE_QUERIES.`
      );
    }
  }

  private finalizeResults(results: AwardResult[], input: AwardResultFilters & { maxResults: number; programs?: string[]; cabins?: string[]; onlyDirectFlights?: boolean }): AwardResult[] {
    const seen = new Set<string>();
    return results
      .filter((result) => result.origin && result.destination && result.date)
      .filter((result) => matchesFilters(result, input))
      .filter((result) => {
        const key = [
          result.source,
          result.program,
          result.origin,
          result.destination,
          result.date,
          result.cabin,
          result.flightNumbers?.join(","),
          result.mileageCost
        ].join("|");
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((left, right) => compareResults(left, right, input.sortBy ?? "date", input.sortDirection ?? "asc"))
      .slice(0, input.maxResults);
  }

  private buildDiagnostics(
    input: AwardSearchInput,
    adapters: AwardSourceAdapter[],
    skipped: SourceStatus[],
    attemptedQueries: number,
    cacheHits: number,
    warnings: string[],
    startedAt: number
  ): SearchDiagnostics {
    return {
      strategy: input.strategy === "auto" && input.bruteForce.enabled ? "brute_force" : input.strategy,
      adaptersUsed: adapters.map((adapter) => adapter.id),
      adaptersSkipped: skipped,
      attemptedQueries,
      cacheHits,
      warnings: unique(warnings),
      elapsedMs: Date.now() - startedAt
    };
  }
}

function matchesFilters(
  result: AwardResult,
  filters: AwardResultFilters & { programs?: string[]; cabins?: string[]; onlyDirectFlights?: boolean }
): boolean {
  if (filters.programs?.length && !includesLoose(filters.programs, result.program)) {
    return false;
  }
  if (filters.cabins?.length && !includesLoose(filters.cabins, result.cabin)) {
    return false;
  }
  if (filters.onlyDirectFlights && (result.stops ?? Math.max(0, result.segments.length - 1)) > 0) {
    return false;
  }
  if (filters.maxMileageCost !== undefined && (result.mileageCost ?? Number.MAX_SAFE_INTEGER) > filters.maxMileageCost) {
    return false;
  }
  if (filters.minMileageCost !== undefined && (result.mileageCost ?? 0) < filters.minMileageCost) {
    return false;
  }
  if (filters.maxTaxes !== undefined && (result.taxes ?? Number.MAX_SAFE_INTEGER) > filters.maxTaxes) {
    return false;
  }
  if (filters.minSeats !== undefined && (result.seats ?? 0) < filters.minSeats) {
    return false;
  }
  if (filters.maxStops !== undefined && (result.stops ?? Math.max(0, result.segments.length - 1)) > filters.maxStops) {
    return false;
  }
  if (filters.maxDurationMinutes !== undefined && (result.durationMinutes ?? Number.MAX_SAFE_INTEGER) > filters.maxDurationMinutes) {
    return false;
  }
  if (filters.minPremiumCabinPercent !== undefined && (result.premiumCabinPercent ?? 0) < filters.minPremiumCabinPercent) {
    return false;
  }
  if (filters.minCpp !== undefined && (result.centsPerPoint ?? computeCentsPerPoint(result) ?? 0) < filters.minCpp) {
    return false;
  }
  if (filters.marketingAirlines?.length && !matchesAny(filters.marketingAirlines, [result.marketingAirline, ...result.segments.map((segment) => segment.marketingAirline)])) {
    return false;
  }
  if (filters.operatingAirlines?.length && !matchesAny(filters.operatingAirlines, [result.operatingAirline, ...result.segments.map((segment) => segment.operatingAirline)])) {
    return false;
  }
  if (filters.aircraft?.length && !matchesAny(filters.aircraft, [result.aircraft, ...result.segments.map((segment) => segment.aircraft)])) {
    return false;
  }
  if (filters.flightNumbers?.length && !filters.flightNumbers.some((flight) => result.flightNumbers?.some((candidate) => sameFlight(candidate, flight)))) {
    return false;
  }
  return true;
}

function compareResults(left: AwardResult, right: AwardResult, sortBy: string, direction: string): number {
  const multiplier = direction === "desc" ? -1 : 1;
  const primary = compareBy(left, right, sortBy);
  if (primary !== 0) {
    return primary * multiplier;
  }

  const dateCompare = left.date.localeCompare(right.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  const leftCost = left.mileageCost ?? Number.MAX_SAFE_INTEGER;
  const rightCost = right.mileageCost ?? Number.MAX_SAFE_INTEGER;
  if (leftCost !== rightCost) {
    return leftCost - rightCost;
  }

  return (left.taxes ?? Number.MAX_SAFE_INTEGER) - (right.taxes ?? Number.MAX_SAFE_INTEGER);
}

function compareBy(left: AwardResult, right: AwardResult, sortBy: string): number {
  switch (sortBy) {
    case "mileage":
      return numberCompare(left.mileageCost, right.mileageCost);
    case "taxes":
      return numberCompare(left.taxes, right.taxes);
    case "duration":
      return numberCompare(left.durationMinutes, right.durationMinutes);
    case "stops":
      return numberCompare(left.stops, right.stops);
    case "seats":
      return numberCompare(left.seats, right.seats);
    case "cpp":
      return numberCompare(left.centsPerPoint ?? computeCentsPerPoint(left), right.centsPerPoint ?? computeCentsPerPoint(right));
    case "found_at":
      return left.foundAt.localeCompare(right.foundAt);
    case "date":
    default:
      return left.date.localeCompare(right.date);
  }
}

function numberCompare(left: number | undefined, right: number | undefined): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function computeCentsPerPoint(result: AwardResult): number | undefined {
  if (!result.cashPrice || !result.mileageCost) {
    return undefined;
  }
  const netCash = Math.max(0, result.cashPrice - (result.taxes ?? 0));
  return (netCash / result.mileageCost) * 100;
}

function sameFlight(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return normalize(left) === normalize(right);
}

function includesLoose(values: string[], candidate: string | undefined): boolean {
  return candidate ? matchesAny(values, [candidate]) : false;
}

function matchesAny(needles: string[], haystack: Array<string | undefined>): boolean {
  const normalizedHaystack = haystack.filter(Boolean).map((value) => normalizeLoose(value ?? ""));
  return needles.some((needle) => normalizedHaystack.some((candidate) => candidate.includes(normalizeLoose(needle))));
}

function normalizeLoose(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
