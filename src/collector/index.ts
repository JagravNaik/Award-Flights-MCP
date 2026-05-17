import { chromium } from "playwright";
import { loadCollectorConfig } from "./config.js";
import { writeCollectorFeed } from "./feedWriter.js";
import { selectCollectorAdapters } from "./adapters/index.js";
import type { CollectorRunResult } from "./types.js";

const config = loadCollectorConfig();

if (!config.routes.length) {
  throw new Error("No collector routes configured. Set COLLECTOR_ROUTES_PATH, COLLECTOR_ROUTES_JSON, or COLLECTOR_ORIGIN/COLLECTOR_DESTINATION/COLLECTOR_START_DATE.");
}

await runLoop();

async function runLoop(): Promise<void> {
  do {
    await runOnce();
    if (config.intervalMinutes > 0) {
      console.error(`collector sleeping for ${config.intervalMinutes} minute(s)`);
      await sleep(config.intervalMinutes * 60_000);
    }
  } while (config.intervalMinutes > 0);
}

async function runOnce(): Promise<void> {
  const adapters = selectCollectorAdapters(config.adapters);
  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1365, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
  });

  const runs: CollectorRunResult[] = [];
  try {
    for (const route of config.routes) {
      for (const adapter of adapters) {
        console.error(`collector ${adapter.id} ${route.origin}-${route.destination} ${route.startDate}..${route.endDate}`);
        try {
          const output = await adapter.collect({ context, route, config });
          runs.push({
            adapterId: adapter.id,
            route,
            results: output.results,
            warnings: output.warnings,
            debugArtifacts: output.debugArtifacts
          });
          console.error(`collector ${adapter.id} normalized ${output.results.length} result(s)`);
        } catch (error) {
          runs.push({
            adapterId: adapter.id,
            route,
            results: [],
            warnings: [error instanceof Error ? error.message : String(error)]
          });
        }
        if (config.actionDelayMs > 0) {
          await sleep(config.actionDelayMs);
        }
      }
    }
  } finally {
    await context.close();
  }

  const feed = writeCollectorFeed(config.outputPath, runs);
  console.error(`collector wrote ${feed.results.length} total result(s) to ${config.outputPath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
