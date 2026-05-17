import { readFileSync } from "node:fs";

const awards = JSON.parse(readFileSync(new URL("../data/awards.json", import.meta.url), "utf8"));

export default function handler(request, response) {
  const url = new URL(request.url, "https://example.local");
  const origin = normalize(url.searchParams.get("origin"));
  const destination = normalize(url.searchParams.get("destination"));
  const date = url.searchParams.get("date");
  const startDate = url.searchParams.get("startDate") ?? date;
  const endDate = url.searchParams.get("endDate") ?? date;
  const cabin = normalize(url.searchParams.get("cabin"));
  const programs = splitList(url.searchParams.get("programs"));

  const results = awards.results.filter((award) => {
    return matches(origin, award.origin) &&
      matches(destination, award.destination) &&
      inDateWindow(award.date, startDate, endDate) &&
      matches(cabin, award.cabin) &&
      (programs.length === 0 || programs.some((program) => normalize(award.program).includes(program)));
  });

  response.setHeader("content-type", "application/json; charset=utf-8");
  response.status(200).json({
    updatedAt: awards.updatedAt,
    results
  });
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
