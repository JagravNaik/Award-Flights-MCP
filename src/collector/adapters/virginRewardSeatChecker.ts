import type { Page } from "playwright";
import type { CollectedAward, CollectorCabin, CollectorRoute } from "../types.js";
import type { BrowserCollectorAdapter } from "./types.js";
import {
  captureJsonResponses,
  clickFirst,
  dismissCommonCookieBanners,
  fillFirstVisible,
  normalizeCapturedAwards,
  saveDebugArtifacts,
  selectFirstOption
} from "./helpers.js";

export const virginRewardSeatCheckerAdapter: BrowserCollectorAdapter = {
  id: "virgin-reward-seat-checker",
  name: "Virgin Atlantic Reward Seat Checker",
  programs: ["Virgin Atlantic Flying Club"],
  airlines: ["Virgin Atlantic"],
  alliances: ["SkyTeam"],
  requiresLogin: "no",
  coverageNotes: "Searches Virgin Atlantic Flying Club reward-seat calendars on routes exposed by the public checker.",
  async collect({ context, route, config }) {
    const page = await context.newPage();
    page.setDefaultTimeout(config.navigationTimeoutMs);
    const captured = captureJsonResponses(page, config.maxCapturedJsonResponses);
    const warnings: string[] = [];

    try {
      await page.goto("https://www.virginatlantic.com/reward-flight-finder", {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs
      });
      await dismissCommonCookieBanners(page);
      await page.waitForTimeout(config.actionDelayMs);

      const fromFilled = await selectFirstOption(page, [
        "select#origin",
        "select[name='origin']"
      ], route.origin) || await fillFirstVisible(page, [
        "input[name*='origin' i]",
        "input[id*='origin' i]",
        "input[aria-label*='from' i]",
        "input[placeholder*='from' i]"
      ], route.origin);
      await page.waitForTimeout(config.actionDelayMs);

      const toFilled = await selectFirstOption(page, [
        "select#destination",
        "select[name='destination']"
      ], route.destination) || await fillFirstVisible(page, [
        "input[name*='destination' i]",
        "input[id*='destination' i]",
        "input[aria-label*='to' i]",
        "input[placeholder*='to' i]"
      ], route.destination);
      const dateFilled = await selectFirstOption(page, [
        "select#date",
        "select[name='date']"
      ], virginMonthValue(route.startDate)) || await fillFirstVisible(page, [
        "input[name*='date' i]",
        "input[id*='date' i]",
        "input[aria-label*='when' i]",
        "input[placeholder*='when' i]",
        "input[type='date']"
      ], route.startDate);

      if (!fromFilled || !toFilled) {
        warnings.push("Could not confidently fill Virgin route fields; UI selectors may have changed or the profile may need a manual setup run.");
      }
      if (!dateFilled) {
        warnings.push("Could not confidently fill Virgin date field; attempting search anyway.");
      }

      await clickFirst(page, [/find reward/i, /find/i, /search/i, /submit/i]);
      await page.waitForLoadState("networkidle", { timeout: config.navigationTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(config.actionDelayMs);

      const results = dedupeAwards([
        ...normalizeCapturedAwards(captured, route, this.id),
        ...(await extractVirginCalendarAwards(page, route, this.id))
      ]);
      const debugArtifacts = results.length ? [] : await saveDebugArtifacts(page, config.debugDir, this.id, route);
      if (!results.length) {
        warnings.push("Virgin collector found no normalized awards in browser responses or rendered calendar cards.");
      }
      return { results, warnings, debugArtifacts };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
};

function virginMonthValue(date: string): string {
  const [year, month] = date.split("-");
  return `${month}_${year}`;
}

async function extractVirginCalendarAwards(page: Page, route: CollectorRoute, source: string): Promise<CollectedAward[]> {
  const bookingUrl = page.url();
  const rows = await page.locator("article[data-cy='availability-card']").evaluateAll((cards) =>
    cards.map((card) => ({
      title: card.querySelector("h2")?.textContent?.trim() ?? "",
      cabins: Array.from(card.querySelectorAll("[data-cy='economy'], [data-cy='premium'], [data-cy='upper-class']")).map((node) => ({
        key: node.getAttribute("data-cy") ?? "",
        text: node.textContent ?? ""
      }))
    }))
  );

  return normalizeVirginCalendarRows(rows, route, source, bookingUrl);
}

interface VirginCalendarRow {
  title: string;
  cabins: Array<{
    key: string;
    text: string;
  }>;
}

export function normalizeVirginCalendarRows(
  rows: VirginCalendarRow[],
  route: CollectorRoute,
  source: string,
  bookingUrl: string
): CollectedAward[] {
  const [year, month] = route.startDate.split("-");

  return rows.flatMap((row) => {
    const day = readDay(row.title);
    if (!day) {
      return [];
    }
    const date = `${year}-${month}-${String(day).padStart(2, "0")}`;
    if (date < route.startDate || date > route.endDate) {
      return [];
    }

    return row.cabins.flatMap((cabinRow) => {
      const cabin = normalizeVirginCabin(cabinRow.key, cabinRow.text);
      const miles = readPoints(cabinRow.text);
      if (!cabin || miles === undefined || !matchesCabin(route, cabin)) {
        return [];
      }

      return [{
        id: [source, route.origin, route.destination, date, cabin, miles].join("|").toLowerCase(),
        source,
        source_updated_at: new Date().toISOString(),
        program: "Virgin Atlantic Flying Club",
        airline: "Virgin Atlantic",
        origin: route.origin,
        destination: route.destination,
        date,
        cabin,
        miles,
        booking_url: bookingUrl,
        raw: {
          title: row.title,
          cabin: cabinRow.key,
          text: cabinRow.text
        },
        warnings: ["Virgin calendar result. The page shows lowest one-way points; verify seats, taxes, and final fare before booking."]
      }];
    });
  });
}

function readDay(value: string): number | undefined {
  const matched = value.match(/\b(\d{1,2})\b/);
  if (!matched) {
    return undefined;
  }
  const day = Number(matched[1]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined;
}

function readPoints(value: string): number | undefined {
  const matched = value.match(/([\d,]+)\s*pts/i);
  if (!matched) {
    return undefined;
  }
  const points = Number(matched[1].replaceAll(",", ""));
  return Number.isFinite(points) ? points : undefined;
}

function normalizeVirginCabin(key: string, label: string): CollectorCabin | undefined {
  const text = `${key} ${label}`.toLowerCase();
  if (text.includes("upper-class") || text.includes("upper class")) {
    return "business";
  }
  if (text.includes("premium")) {
    return "premium";
  }
  if (text.includes("economy")) {
    return "economy";
  }
  return undefined;
}

function matchesCabin(route: CollectorRoute, cabin: CollectorCabin): boolean {
  return !route.cabins?.length || route.cabins.includes(cabin);
}

function dedupeAwards(results: CollectedAward[]): CollectedAward[] {
  return [...new Map(results.map((result) => [result.id, result])).values()];
}
