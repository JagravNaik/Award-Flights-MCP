import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const awards = JSON.parse(readFileSync(new URL("../data/awards.json", import.meta.url), "utf8"));
const awardFlightDailyUrl = process.env.AWARD_FLIGHT_DAILY_MCP_URL ?? "https://awardflightdaily.com/mcp-server/mcp";
const awardFlightDailyEnabled = readBool(process.env.AWARD_FLIGHT_DAILY_ENABLED, true);
const awardFlightDailyApiKey = process.env.AWARD_FLIGHT_DAILY_API_KEY?.trim();

export default async function handler(request, response) {
  const url = new URL(request.url, "https://example.local");
  const origin = normalize(url.searchParams.get("origin"));
  const destination = normalize(url.searchParams.get("destination"));
  const date = url.searchParams.get("date");
  const startDate = url.searchParams.get("startDate") ?? date;
  const endDate = url.searchParams.get("endDate") ?? date;
  const cabin = normalize(url.searchParams.get("cabin"));
  const programs = splitList(url.searchParams.get("programs"));

  const localResults = awards.results.filter((award) => {
    return matches(origin, award.origin) &&
      matches(destination, award.destination) &&
      inDateWindow(award.date, startDate, endDate) &&
      matches(cabin, award.cabin) &&
      (programs.length === 0 || programs.some((program) => normalize(award.program).includes(program)));
  });
  const warnings = [];
  const liveResults = [];

  if (awardFlightDailyEnabled && origin && destination && (startDate || date)) {
    try {
      liveResults.push(...await searchAwardFlightDaily({
        origin,
        destination,
        startDate: startDate ?? date,
        endDate: endDate ?? startDate ?? date,
        cabin,
        programs,
        limit: Number(url.searchParams.get("limit") ?? 100)
      }));
    } catch (error) {
      warnings.push(`award-flight-daily failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const results = dedupeResults([...liveResults, ...localResults]);

  response.setHeader("content-type", "application/json; charset=utf-8");
  response.status(200).json({
    updatedAt: new Date().toISOString(),
    sources: {
      "award-flight-daily": {
        enabled: awardFlightDailyEnabled,
        attempted: awardFlightDailyEnabled && Boolean(origin && destination && (startDate || date)),
        resultCount: liveResults.length
      },
      "static-json": {
        resultCount: localResults.length,
        updatedAt: awards.updatedAt
      }
    },
    results,
    warnings
  });
}

async function searchAwardFlightDaily(input) {
  const cabin = toAfdCabin(input.cabin);
  const params = compact({
    origin: input.origin.toUpperCase(),
    destination: input.destination.toUpperCase(),
    date_from: input.startDate,
    date_to: input.endDate,
    cabin,
    source: input.programs.length ? input.programs.join(",") : undefined,
    limit: Math.min(200, Math.max(1, input.limit || 100)),
    offset: 0,
    response_format: "json"
  });

  const payload = await callMcpTool("afd_search_award_flights", { params });
  const message = payloadMessage(payload);
  const items = extractItems(payload);
  if (message && items.length === 0) {
    throw new Error(message);
  }

  return items.map((item) => normalizeAfdItem(item, input));
}

async function callMcpTool(name, args) {
  const headers = {
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
    "user-agent": "award-flights-json-feed/0.1"
  };
  if (awardFlightDailyApiKey) {
    headers.authorization = `Bearer ${awardFlightDailyApiKey}`;
    headers["x-api-key"] = awardFlightDailyApiKey;
  }

  const init = await postMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "award-flights-json-feed", version: "0.1.0" }
    }
  }, headers);
  const sessionId = init.headers.get("mcp-session-id");
  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, headers, sessionId).catch(() => undefined);
  const result = await postMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args }
  }, headers, sessionId);
  return extractMcpPayload(result.body);
}

async function postMcp(payload, baseHeaders, sessionId) {
  const headers = { ...baseHeaders };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  const response = await fetch(awardFlightDailyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const text = await response.text();
  return {
    headers: response.headers,
    body: parseMcpBody(text)
  };
}

function parseMcpBody(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    const dataLine = trimmed.split("\n").find((line) => line.startsWith("data:"));
    return dataLine ? JSON.parse(dataLine.slice(5).trim()) : {};
  }
  return JSON.parse(trimmed);
}

function extractMcpPayload(response) {
  const result = response?.result;
  const structured = result?.structuredContent;
  const unwrappedStructured = unwrapResult(structured);
  if (unwrappedStructured !== undefined) {
    return unwrappedStructured;
  }
  if (structured) {
    return structured;
  }
  const unwrapped = unwrapResult(result);
  if (unwrapped !== undefined) {
    return unwrapped;
  }
  for (const content of result?.content ?? []) {
    if (content?.type === "text") {
      const parsed = parseJsonText(content.text);
      return parsed ?? { message: content.text };
    }
  }
  return response;
}

function unwrapResult(value) {
  if (!value || !Object.prototype.hasOwnProperty.call(value, "result")) {
    return undefined;
  }
  if (typeof value.result === "string") {
    return parseJsonText(value.result) ?? { message: value.result };
  }
  return value.result;
}

function parseJsonText(text = "") {
  for (const candidate of [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1]
  ]) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function normalizeAfdItem(item, input) {
  const origin = item.origin ?? item.from ?? input.origin.toUpperCase();
  const destination = item.destination ?? item.to ?? input.destination.toUpperCase();
  const date = (item.date ?? item.departure_date ?? input.startDate).slice(0, 10);
  const cabin = fromAfdCabin(item.cabin ?? item.cabin_class) ?? input.cabin;
  const miles = numberValue(item.award_cost ?? item.miles ?? item.mileage ?? item.mileage_cost);
  return compact({
    id: stableId(["award-flight-daily", item.program ?? item.source, origin, destination, date, cabin, miles]),
    source: "award-flight-daily",
    source_updated_at: item.updated_at ?? item.updatedAt,
    program: item.program_name ?? item.program ?? item.source ?? item.loyalty_program,
    airline: item.airline_name ?? item.airline ?? item.airlines ?? item.marketing_airline,
    operating_airline: item.operating_airline,
    flight_numbers: item.flight_number ?? item.flightNumbers ?? item.flight_numbers,
    origin,
    destination,
    date,
    cabin,
    miles,
    taxes: numberValue(item.taxes ?? item.fees) === undefined ? undefined : {
      amount: numberValue(item.taxes ?? item.fees),
      currency: item.taxes_currency ?? item.currency ?? "USD"
    },
    seats: numberValue(item.seats ?? item.remaining_seats ?? item.availability_count),
    aircraft: item.equipment ?? item.aircraft,
    duration_minutes: numberValue(item.duration_minutes ?? item.duration),
    stops: item.stops ?? inferStops(item.direct),
    raw: item
  });
}

function extractItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of ["results", "flights", "data", "items"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }
  return [];
}

function payloadMessage(payload) {
  return typeof payload === "string" ? payload : payload?.error ?? payload?.message ?? payload?.detail ?? payload?.result;
}

function toAfdCabin(cabin) {
  return { economy: "Y", premium: "W", business: "J", first: "F" }[normalize(cabin)];
}

function fromAfdCabin(value) {
  const normalized = value?.trim().toUpperCase();
  return { Y: "economy", ECONOMY: "economy", W: "premium", PREMIUM: "premium", PREMIUM_ECONOMY: "premium", J: "business", BUSINESS: "business", F: "first", FIRST: "first" }[normalized];
}

function dedupeResults(results) {
  const byKey = new Map();
  for (const result of results) {
    byKey.set([result.source, result.origin, result.destination, result.date, result.program, result.cabin, result.miles, result.flight_numbers].join("|"), result);
  }
  return [...byKey.values()];
}

function matches(expected, actual) {
  return !expected || normalize(actual) === expected;
}

function inDateWindow(date, startDate, endDate) {
  if (!startDate && !endDate) {
    return true;
  }
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function splitList(value) {
  return value?.split(",").map(normalize).filter(Boolean) ?? [];
}

function normalize(value) {
  return value?.trim().toLowerCase() ?? "";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function numberValue(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferStops(value) {
  return typeof value === "boolean" ? value ? 0 : 1 : undefined;
}

function readBool(value, fallback) {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function stableId(parts) {
  const text = parts.filter((part) => part !== undefined && part !== "").join("|");
  return text ? createHash("sha1").update(text).digest("hex").slice(0, 20) : randomUUID();
}
