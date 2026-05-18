import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Response } from "playwright";
import type { CollectedAward, CollectorCabin, CollectorRoute } from "../types.js";

export interface CapturedJson {
  url: string;
  payload: unknown;
}

export interface VisibleMileageTextInput {
  source: string;
  route: CollectorRoute;
  program: string;
  airline?: string;
  bookingUrl: string;
  text: string;
  warning: string;
  maxResults?: number;
}

export function captureJsonResponses(page: Page, maxResponses: number): CapturedJson[] {
  const captured: CapturedJson[] = [];
  page.on("response", (response) => {
    void captureResponse(response, captured, maxResponses);
  });
  return captured;
}

export async function dismissCommonCookieBanners(page: Page): Promise<void> {
  for (const pattern of [/accept all/i, /^accept$/i, /agree/i, /allow all/i, /continue/i]) {
    const button = page.getByRole("button", { name: pattern }).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 3000 });
        return;
      }
    } catch {
      // Best-effort cookie handling; individual sites change these controls often.
    }
  }
}

export async function fillFirstVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.fill(value, { timeout: 5000 });
        await page.keyboard.press("Tab").catch(() => undefined);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function selectFirstOption(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.selectOption(value, { timeout: 5000 });
        await page.keyboard.press("Tab").catch(() => undefined);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function clickFirst(page: Page, names: RegExp[]): Promise<boolean> {
  for (const name of names) {
    const button = page.getByRole("button", { name }).first();
    try {
      if (await button.isVisible({ timeout: 2000 })) {
        await button.click({ timeout: 5000 });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function saveDebugArtifacts(page: Page, debugDir: string | undefined, adapterId: string, route: CollectorRoute): Promise<string[]> {
  if (!debugDir) {
    return [];
  }
  mkdirSync(debugDir, { recursive: true });
  const slug = `${adapterId}-${route.origin}-${route.destination}-${route.startDate}-${Date.now()}`;
  const screenshotPath = join(debugDir, `${slug}.png`);
  const htmlPath = join(debugDir, `${slug}.html`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  const html = await page.content().catch(() => "");
  if (html) {
    await import("node:fs").then((fs) => fs.writeFileSync(htmlPath, html));
  }
  return [screenshotPath, htmlPath];
}

export function normalizeCapturedAwards(captured: CapturedJson[], route: CollectorRoute, source: string): CollectedAward[] {
  const candidates = captured.flatMap((item) => extractObjects(item.payload));
  const normalized = candidates
    .map((item) => normalizeAwardObject(item, route, source))
    .filter((item): item is CollectedAward => Boolean(item))
    .filter((item) => matchesRoute(item, route));
  return dedupe(normalized);
}

export function normalizeVisibleMileageText(input: VisibleMileageTextInput): CollectedAward[] {
  const seen = new Map<string, CollectedAward>();
  const regex = /(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*(k)?\s*(?:miles|mile|mi|points|point|pts|avios)\b/gi;
  for (const match of input.text.matchAll(regex)) {
    const miles = parseMileage(match[1], match[2]);
    if (miles === undefined || miles < 1_000 || miles > 2_000_000) {
      continue;
    }

    const index = match.index ?? 0;
    const context = input.text.slice(Math.max(0, index - 100), Math.min(input.text.length, index + match[0].length));
    const inferredCabin = inferNearestCabin(context);
    const cabin = inferredCabin ?? (input.route.cabins?.length === 1 ? input.route.cabins[0] : undefined);
    if (input.route.cabins?.length && cabin && !input.route.cabins.includes(cabin)) {
      continue;
    }

    const id = stableId([input.source, input.route.origin, input.route.destination, input.route.startDate, cabin, miles]);
    seen.set(id, {
      id,
      source: input.source,
      source_updated_at: new Date().toISOString(),
      program: input.program,
      airline: input.airline,
      origin: input.route.origin,
      destination: input.route.destination,
      date: input.route.startDate,
      cabin,
      miles,
      booking_url: input.bookingUrl,
      raw: { text: context.trim() },
      warnings: [input.warning]
    });

    if (seen.size >= (input.maxResults ?? 20)) {
      break;
    }
  }
  return [...seen.values()];
}

export function normalizeCabin(value: unknown): CollectorCabin | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (["y", "eco", "economy", "main cabin", "coach"].includes(normalized) || /\b(economy|main cabin|coach|basic)\b/.test(normalized)) {
    return "economy";
  }
  if (["w", "premium", "premium economy", "world traveller plus", "premium plus"].includes(normalized) || /\b(premium economy|premium plus|world traveller plus)\b/.test(normalized)) {
    return "premium";
  }
  if (["j", "business", "club", "club world", "upper class"].includes(normalized) || /\b(business|club world|upper class|polaris|delta one)\b/.test(normalized)) {
    return "business";
  }
  if (["f", "first", "first class"].includes(normalized) || /\b(first|first class)\b/.test(normalized)) {
    return "first";
  }
  return undefined;
}

async function captureResponse(response: Response, captured: CapturedJson[], maxResponses: number): Promise<void> {
  if (captured.length >= maxResponses) {
    return;
  }
  const contentType = response.headers()["content-type"] ?? "";
  const url = response.url();
  if (!contentType.includes("json") && !/award|reward|availability|calendar|flight/i.test(url)) {
    return;
  }
  try {
    const payload = await response.json();
    captured.push({ url, payload });
  } catch {
    return;
  }
}

function normalizeAwardObject(item: Record<string, unknown>, route: CollectorRoute, source: string): CollectedAward | undefined {
  const origin = readString(item, ["origin", "from", "fromAirport", "originAirport", "departureAirport", "departureAirportCode"]) ?? route.origin;
  const destination = readString(item, ["destination", "to", "toAirport", "destinationAirport", "arrivalAirport", "arrivalAirportCode"]) ?? route.destination;
  const date = readString(item, ["date", "departureDate", "departure_date", "flightDate", "outboundDate"])?.slice(0, 10);
  const miles = readNumber(item, ["miles", "points", "avios", "priceInPoints", "mileage", "mileageCost", "awardCost", "amount"]);
  const seats = readNumber(item, ["seats", "availableSeats", "remainingSeats", "availability", "available"]);
  const cabin = normalizeCabin(readString(item, ["cabin", "travelClass", "class", "fareClassName", "product"]));

  if (!date || (miles === undefined && seats === undefined && cabin === undefined)) {
    return undefined;
  }

  return {
    id: stableId([source, origin, destination, date, cabin, miles, readString(item, ["flightNumber", "flight_numbers"])]),
    source,
    source_updated_at: new Date().toISOString(),
    program: readString(item, ["program", "loyaltyProgram", "scheme", "source"]),
    airline: readString(item, ["airline", "carrier", "marketingCarrier", "marketingAirline"]),
    operating_airline: readString(item, ["operatingAirline", "operatingCarrier"]),
    flight_numbers: readString(item, ["flightNumber", "flightNumbers", "flight_numbers"]),
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    date,
    cabin,
    miles,
    taxes: readTaxes(item),
    seats,
    aircraft: readString(item, ["aircraft", "equipment"]),
    fare_class: readString(item, ["fareClass", "bookingClass"]),
    departure: readString(item, ["departure", "departureTime", "departsAt"]),
    arrival: readString(item, ["arrival", "arrivalTime", "arrivesAt"]),
    duration_minutes: readNumber(item, ["durationMinutes", "duration"]),
    stops: readNumber(item, ["stops", "stopCount"]),
    raw: item,
    warnings: ["Browser-collected lead. Verify on the loyalty program website before transferring points."]
  };
}

function extractObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8 || value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractObjects(item, depth + 1));
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const children = Object.values(record).flatMap((item) => extractObjects(item, depth + 1));
  return [record, ...children];
}

function matchesRoute(item: CollectedAward, route: CollectorRoute): boolean {
  if (item.origin !== route.origin || item.destination !== route.destination) {
    return false;
  }
  if (item.date < route.startDate || item.date > route.endDate) {
    return false;
  }
  if (route.cabins?.length && item.cabin && !route.cabins.includes(item.cabin as CollectorCabin)) {
    return false;
  }
  if (route.passengers && item.seats !== undefined && item.seats < route.passengers) {
    return false;
  }
  return true;
}

function dedupe(items: CollectedAward[]): CollectedAward[] {
  const byId = new Map<string, CollectedAward>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replaceAll(",", "")) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readTaxes(record: Record<string, unknown>): CollectedAward["taxes"] | undefined {
  const nested = record.taxes ?? record.fees ?? record.surcharges;
  if (typeof nested === "object" && nested !== null) {
    const amount = readNumber(nested as Record<string, unknown>, ["amount", "value", "total"]);
    if (amount !== undefined) {
      return { amount, currency: readString(nested as Record<string, unknown>, ["currency", "currencyCode"]) ?? "USD" };
    }
  }
  const amount = readNumber(record, ["taxes", "fees", "surcharges"]);
  return amount === undefined ? undefined : { amount, currency: readString(record, ["currency", "currencyCode"]) ?? "USD" };
}

function parseMileage(value: string, suffix: string | undefined): number | undefined {
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.round(suffix ? parsed * 1_000 : parsed);
}

function inferNearestCabin(value: string): CollectorCabin | undefined {
  const lower = value.toLowerCase();
  const rawCandidates: Array<{ cabin: CollectorCabin; index: number }> = [
    { cabin: "economy", index: maxIndex(lower, ["economy", "main cabin", "coach", "basic"]) },
    { cabin: "premium", index: maxIndex(lower, ["premium economy", "premium plus", "world traveller plus", "premium"]) },
    { cabin: "business", index: maxIndex(lower, ["business", "club world", "upper class", "polaris", "delta one"]) },
    { cabin: "first", index: maxIndex(lower, ["first class", "first"]) }
  ];
  const candidates = rawCandidates.filter((candidate) => candidate.index >= 0);
  return candidates.sort((left, right) => right.index - left.index)[0]?.cabin;
}

function maxIndex(value: string, terms: string[]): number {
  return Math.max(...terms.map((term) => value.lastIndexOf(term)));
}

function stableId(parts: Array<string | number | undefined>): string {
  return parts.filter(Boolean).join("|").replace(/[^a-z0-9|_-]/gi, "").toLowerCase();
}
