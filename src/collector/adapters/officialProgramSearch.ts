import type { Page } from "playwright";
import type { CollectedAward, CollectorRoute } from "../types.js";
import type { BrowserCollectorAdapter } from "./types.js";
import {
  captureJsonResponses,
  clickFirst,
  dismissCommonCookieBanners,
  fillFirstVisible,
  normalizeCapturedAwards,
  normalizeVisibleMileageText,
  saveDebugArtifacts,
  selectFirstOption
} from "./helpers.js";

interface OfficialProgramSearchConfig {
  id: string;
  name: string;
  program: string;
  airline?: string;
  airlines?: string[];
  alliances?: string[];
  requiresLogin?: BrowserCollectorAdapter["requiresLogin"];
  coverageNotes?: string;
  startUrl(route: CollectorRoute): string;
  submitButtons?: RegExp[];
}

export function createOfficialProgramSearchAdapter(config: OfficialProgramSearchConfig): BrowserCollectorAdapter {
  return {
    id: config.id,
    name: config.name,
    programs: [config.program],
    airlines: config.airlines ?? (config.airline ? [config.airline] : undefined),
    alliances: config.alliances,
    requiresLogin: config.requiresLogin ?? "sometimes",
    coverageNotes: config.coverageNotes,
    async collect({ context, route, config: collectorConfig }) {
      const page = await context.newPage();
      page.setDefaultTimeout(collectorConfig.navigationTimeoutMs);
      const captured = captureJsonResponses(page, collectorConfig.maxCapturedJsonResponses);
      const warnings: string[] = [];

      try {
        const url = config.startUrl(route);
        const navigationError = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: collectorConfig.navigationTimeoutMs
        }).then(() => undefined).catch((error) => error instanceof Error ? error : new Error(String(error)));
        if (navigationError) {
          const debugArtifacts = await saveDebugArtifacts(page, collectorConfig.debugDir, config.id, route);
          return {
            results: [],
            warnings: [`${config.name} did not finish loading before timeout. ${navigationError.message}`],
            debugArtifacts
          };
        }

        await dismissCommonCookieBanners(page);
        await fillGenericAwardSearch(page, route);
        await clickFirst(page, config.submitButtons ?? [/search/i, /find flights/i, /find flight/i, /continue/i, /submit/i]);
        await page.waitForLoadState("networkidle", { timeout: collectorConfig.navigationTimeoutMs }).catch(() => undefined);
        await page.waitForTimeout(collectorConfig.actionDelayMs);

        const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        const results = dedupeAwards([
          ...normalizeCapturedAwards(captured, route, config.id),
          ...normalizeVisibleMileageText({
            source: config.id,
            route,
            program: config.program,
            airline: config.airline,
            bookingUrl: page.url(),
            text,
            warning: `${config.name} visible-page result. Verify availability, taxes, operating carrier, and booking rules on the airline website before transferring points.`
          })
        ]);

        const loginWarning = loginGateWarning(config.name, text);
        if (loginWarning) {
          warnings.push(loginWarning);
        }

        const debugArtifacts = results.length ? [] : await saveDebugArtifacts(page, collectorConfig.debugDir, config.id, route);
        if (!results.length) {
          warnings.push(`${config.name} found no normalized award results. The route may be unavailable, the page may require login, or this source may need a site-specific parser.`);
        }
        return { results, warnings, debugArtifacts };
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  };
}

async function fillGenericAwardSearch(page: Page, route: CollectorRoute): Promise<void> {
  await clickFirst(page, [/one[- ]?way/i]).catch(() => undefined);
  await clickFirst(page, [/use miles/i, /miles/i, /award/i, /redeem/i]).catch(() => undefined);

  await selectFirstOption(page, originSelectors("select"), route.origin)
    || await fillFirstVisible(page, originSelectors("input"), route.origin);
  await page.waitForTimeout(500);
  await selectFirstOption(page, destinationSelectors("select"), route.destination)
    || await fillFirstVisible(page, destinationSelectors("input"), route.destination);
  await fillFirstVisible(page, dateSelectors(), route.startDate);
}

function originSelectors(kind: "input" | "select"): string[] {
  return [
    `${kind}[name*='origin' i]`,
    `${kind}[name*='from' i]`,
    `${kind}[name*='departure' i]`,
    `${kind}[id*='origin' i]`,
    `${kind}[id*='from' i]`,
    `${kind}[id*='departure' i]`,
    `${kind}[aria-label*='from' i]`,
    `${kind}[aria-label*='origin' i]`,
    `${kind}[placeholder*='from' i]`,
    `${kind}[placeholder*='origin' i]`
  ];
}

function destinationSelectors(kind: "input" | "select"): string[] {
  return [
    `${kind}[name*='destination' i]`,
    `${kind}[name*='to' i]`,
    `${kind}[name*='arrival' i]`,
    `${kind}[id*='destination' i]`,
    `${kind}[id*='to' i]`,
    `${kind}[id*='arrival' i]`,
    `${kind}[aria-label*='to' i]`,
    `${kind}[aria-label*='destination' i]`,
    `${kind}[placeholder*='to' i]`,
    `${kind}[placeholder*='destination' i]`
  ];
}

function dateSelectors(): string[] {
  return [
    "input[type='date']",
    "input[name*='date' i]",
    "input[name*='depart' i]",
    "input[id*='date' i]",
    "input[id*='depart' i]",
    "input[aria-label*='date' i]",
    "input[aria-label*='depart' i]",
    "input[placeholder*='date' i]"
  ];
}

function loginGateWarning(name: string, text: string): string | undefined {
  if (/sign in|log in|login|join.*account|account required/i.test(text)) {
    return `${name} displayed login/account language. Results may be incomplete unless the persistent browser profile is already authorized.`;
  }
  return undefined;
}

function dedupeAwards(results: CollectedAward[]): CollectedAward[] {
  return [...new Map(results.map((result) => [result.id, result])).values()];
}

export const unitedMileagePlusAdapter = createOfficialProgramSearchAdapter({
  id: "united-mileageplus",
  name: "United MileagePlus Official Search",
  program: "United MileagePlus",
  airline: "United Airlines",
  alliances: ["Star Alliance"],
  requiresLogin: "sometimes",
  coverageNotes: "Searches United and Star Alliance/partner awards shown by MileagePlus.",
  startUrl: (route) => {
    const params = new URLSearchParams({
      f: route.origin,
      t: route.destination,
      d: route.startDate,
      tt: "1",
      sc: "7",
      px: String(route.passengers ?? 1),
      taxng: "1",
      newHP: "true",
      clm: "7",
      st: "bestmatches"
    });
    return `https://www.united.com/ual/en/us/flight-search/book-a-flight/results?${params}`;
  }
});

export const americanAadvantageAdapter = createOfficialProgramSearchAdapter({
  id: "american-aadvantage",
  name: "American AAdvantage Official Search",
  program: "American Airlines AAdvantage",
  airline: "American Airlines",
  alliances: ["oneworld"],
  requiresLogin: "optional",
  coverageNotes: "Searches American and oneworld/partner awards shown by AAdvantage.",
  startUrl: () => "https://www.aa.com/booking/find-flights/award"
});

export const deltaSkyMilesAdapter = createOfficialProgramSearchAdapter({
  id: "delta-skymiles",
  name: "Delta SkyMiles Official Search",
  program: "Delta SkyMiles",
  airline: "Delta Air Lines",
  alliances: ["SkyTeam"],
  requiresLogin: "optional",
  coverageNotes: "Searches Delta, SkyTeam, and SkyMiles partner awards shown by Delta.",
  startUrl: () => "https://www.delta.com/air-shopping/searchFlights.action?awardTravel=true"
});

export const airCanadaAeroplanAdapter = createOfficialProgramSearchAdapter({
  id: "air-canada-aeroplan",
  name: "Air Canada Aeroplan Official Search",
  program: "Air Canada Aeroplan",
  airline: "Air Canada",
  alliances: ["Star Alliance"],
  requiresLogin: "sometimes",
  coverageNotes: "Searches Air Canada, Star Alliance, and Aeroplan partner awards.",
  startUrl: () => "https://www.aircanada.com/aeroplan/redeem/availability/outbound"
});

export const flyingBlueAdapter = createOfficialProgramSearchAdapter({
  id: "flying-blue",
  name: "Flying Blue Official Search",
  program: "Air France-KLM Flying Blue",
  airlines: ["Air France", "KLM"],
  alliances: ["SkyTeam"],
  requiresLogin: "sometimes",
  coverageNotes: "Searches Air France/KLM Flying Blue and partner awards where the public flow exposes them.",
  startUrl: () => "https://www.flyingblue.us/en/flights/reward-tickets"
});

export const alaskaMileagePlanAdapter = createOfficialProgramSearchAdapter({
  id: "alaska-mileage-plan",
  name: "Alaska Mileage Plan Official Search",
  program: "Alaska Airlines Mileage Plan",
  airline: "Alaska Airlines",
  alliances: ["oneworld"],
  requiresLogin: "optional",
  coverageNotes: "Searches Alaska and Mileage Plan partner awards shown by Alaska.",
  startUrl: () => "https://www.alaskaair.com/search"
});

export const qantasFrequentFlyerAdapter = createOfficialProgramSearchAdapter({
  id: "qantas-frequent-flyer",
  name: "Qantas Frequent Flyer Official Search",
  program: "Qantas Frequent Flyer",
  airline: "Qantas",
  alliances: ["oneworld"],
  requiresLogin: "sometimes",
  coverageNotes: "Searches Qantas and oneworld Classic Flight Reward availability where the public flow exposes it.",
  startUrl: () => "https://www.qantas.com/us/en/frequent-flyer/use-points/classic-flight-rewards.html"
});

export const emiratesSkywardsAdapter = createOfficialProgramSearchAdapter({
  id: "emirates-skywards",
  name: "Emirates Skywards Official Search",
  program: "Emirates Skywards",
  airline: "Emirates",
  requiresLogin: "sometimes",
  coverageNotes: "Searches Emirates Skywards award booking pages where the public flow exposes results.",
  startUrl: () => "https://www.emirates.com/us/english/skywards/spend-miles/"
});
