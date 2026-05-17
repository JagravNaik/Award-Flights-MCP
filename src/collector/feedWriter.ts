import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CollectedAward, CollectorFeed, CollectorRunResult } from "./types.js";

export function writeCollectorFeed(path: string, runs: CollectorRunResult[]): CollectorFeed {
  const previous = readPreviousResults(path);
  const nextResults = dedupeAwards([...previous, ...runs.flatMap((run) => run.results)]);
  const feed: CollectorFeed = {
    updatedAt: new Date().toISOString(),
    source: "personal-browser-collector",
    notice:
      "Private browser-collected award leads. Verify availability on the loyalty-program website before transferring points.",
    diagnostics: runs.map((run) => ({
      adapterId: run.adapterId,
      route: `${run.route.origin}-${run.route.destination} ${run.route.startDate}..${run.route.endDate}`,
      resultCount: run.results.length,
      warnings: run.warnings,
      debugArtifacts: run.debugArtifacts
    })),
    results: nextResults
  };

  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(feed, null, 2));
  renameSync(tempPath, path);
  return feed;
}

function readPreviousResults(path: string): CollectedAward[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { results?: unknown };
    return Array.isArray(parsed.results) ? parsed.results.filter(isAward) : [];
  } catch {
    return [];
  }
}

function dedupeAwards(results: CollectedAward[]): CollectedAward[] {
  const byKey = new Map<string, CollectedAward>();
  for (const result of results) {
    byKey.set(awardKey(result), result);
  }
  return [...byKey.values()].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return (left.miles ?? Number.MAX_SAFE_INTEGER) - (right.miles ?? Number.MAX_SAFE_INTEGER);
  });
}

function awardKey(result: CollectedAward): string {
  return [
    result.source,
    result.origin,
    result.destination,
    result.date,
    result.program,
    result.cabin,
    result.miles,
    result.taxes?.amount,
    result.flight_numbers
  ].join("|");
}

function isAward(value: unknown): value is CollectedAward {
  const item = value as CollectedAward;
  return Boolean(item?.origin && item.destination && item.date && item.source);
}
