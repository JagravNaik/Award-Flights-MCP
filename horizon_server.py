from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Literal

try:
    import fcntl
except ImportError:  # pragma: no cover - Horizon runs on Linux, but keep local imports portable.
    fcntl = None  # type: ignore[assignment]

from fastmcp import FastMCP


mcp = FastMCP("award-flights-mcp")

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

Cabin = Literal["economy", "premium", "business", "first"]
SortDirection = Literal["asc", "desc"]

LOCAL_AWARD_FEED_PATH = Path(os.getenv("LOCAL_AWARD_FEED_PATH", str(ROOT / "config" / "sample-awards.json")))
PUBLIC_AWARD_FEED_URL = os.getenv("PUBLIC_AWARD_FEED_URL", "https://vercel-json-feed.vercel.app/api/awards").strip()
PUBLIC_AWARD_FEED_ENABLED = os.getenv("PUBLIC_AWARD_FEED_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
AWARD_FLIGHT_DAILY_ENABLED = os.getenv("AWARD_FLIGHT_DAILY_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
AWARD_FLIGHT_DAILY_MCP_URL = os.getenv("AWARD_FLIGHT_DAILY_MCP_URL", "https://awardflightdaily.com/mcp-server/mcp").strip()
AWARD_FLIGHT_DAILY_API_KEY = os.getenv("AWARD_FLIGHT_DAILY_API_KEY", "").strip()
TRANSFER_BONUSES_PATH = Path(os.getenv("TRANSFER_BONUSES_PATH", str(ROOT / "config" / "transfer-bonuses.json")))
AWARD_HISTORY_PATH = Path(os.getenv("AWARD_HISTORY_PATH", str(DATA_DIR / "history.json")))
AWARD_ALERTS_PATH = Path(os.getenv("AWARD_ALERTS_PATH", str(DATA_DIR / "alerts.json")))
AWARD_POINTS_WALLET_PATH = Path(os.getenv("AWARD_POINTS_WALLET_PATH", str(DATA_DIR / "points-wallet.json")))
HOTEL_RESULTS_PATH = Path(os.getenv("HOTEL_RESULTS_PATH", str(ROOT / "config" / "hotel-results.example.json")))
HOTEL_ALERTS_PATH = Path(os.getenv("HOTEL_ALERTS_PATH", str(DATA_DIR / "hotel-alerts.json")))
SEAT_MAPS_PATH = Path(os.getenv("SEAT_MAPS_PATH", str(ROOT / "config" / "seat-maps.example.json")))
FARE_CLASSES_PATH = Path(os.getenv("FARE_CLASSES_PATH", str(ROOT / "config" / "fare-classes.example.json")))

TRANSFER_PARTNERS: list[dict[str, str]] = [
    {"bank": "American Express Membership Rewards", "program": "Air Canada Aeroplan", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "Air France-KLM Flying Blue", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "ANA Mileage Club", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "Avianca LifeMiles", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "British Airways Executive Club", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "Emirates Skywards", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "Singapore KrisFlyer", "transferRatio": "1:1"},
    {"bank": "American Express Membership Rewards", "program": "Virgin Atlantic Flying Club", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "Air Canada Aeroplan", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "Air France-KLM Flying Blue", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "British Airways Executive Club", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "Emirates Skywards", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "Singapore KrisFlyer", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "United MileagePlus", "transferRatio": "1:1"},
    {"bank": "Chase Ultimate Rewards", "program": "Virgin Atlantic Flying Club", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Air Canada Aeroplan", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Air France-KLM Flying Blue", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Avianca LifeMiles", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "British Airways Executive Club", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Emirates Skywards", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Singapore KrisFlyer", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Turkish Airlines Miles&Smiles", "transferRatio": "1:1"},
    {"bank": "Capital One Miles", "program": "Virgin Atlantic Flying Club", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Air France-KLM Flying Blue", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Avianca LifeMiles", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Emirates Skywards", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Singapore KrisFlyer", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Turkish Airlines Miles&Smiles", "transferRatio": "1:1"},
    {"bank": "Citi ThankYou Points", "program": "Virgin Atlantic Flying Club", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "Air Canada Aeroplan", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "Air France-KLM Flying Blue", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "Alaska Airlines Atmos Rewards", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "British Airways Executive Club", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "Turkish Airlines Miles&Smiles", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "United MileagePlus", "transferRatio": "1:1"},
    {"bank": "Bilt Rewards", "program": "Virgin Atlantic Flying Club", "transferRatio": "1:1"},
]

PROGRAM_LINKS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile("aeroplan|air canada", re.I), "Air Canada Aeroplan", "https://www.aircanada.com/aeroplan/redeem"),
    (re.compile("united|mileageplus", re.I), "United MileagePlus", "https://www.united.com/en/us/book-flight/united-reservations"),
    (re.compile("lifemiles|avianca", re.I), "Avianca LifeMiles", "https://www.lifemiles.com/fly/find"),
    (re.compile("flying blue|air france|klm", re.I), "Air France-KLM Flying Blue", "https://wwws.airfrance.us/search/advanced"),
    (re.compile("virgin", re.I), "Virgin Atlantic Flying Club", "https://www.virginatlantic.com/flight-search/book-a-flight"),
    (re.compile("alaska|atmos", re.I), "Alaska Airlines Atmos Rewards", "https://www.alaskaair.com/search"),
    (re.compile("american|aadvantage", re.I), "American Airlines AAdvantage", "https://www.aa.com/booking/find-flights"),
    (re.compile("british|avios|executive club", re.I), "British Airways Executive Club", "https://www.britishairways.com/travel/redeem/execclub/_gf/en_us"),
    (re.compile("qantas", re.I), "Qantas Frequent Flyer", "https://www.qantas.com/us/en/book-a-trip/flights.html"),
    (re.compile("emirates", re.I), "Emirates Skywards", "https://www.emirates.com/us/english/book/"),
    (re.compile("singapore|krisflyer", re.I), "Singapore KrisFlyer", "https://www.singaporeair.com/en_UK/us/plan-travel/book-flights/"),
    (re.compile("turkish", re.I), "Turkish Airlines Miles&Smiles", "https://www.turkishairlines.com/en-us/flights/booking/"),
]

LOCAL_FIELD_MAP = {
    "id": "id",
    "origin": "origin",
    "destination": "destination",
    "date": "date",
    "program": "program",
    "marketingAirline": "airline",
    "operatingAirline": "operating_airline",
    "flightNumbers": "flight_numbers",
    "mileageCost": "miles",
    "taxes": "taxes.amount",
    "taxesCurrency": "taxes.currency",
    "cashPrice": "cash_price.amount",
    "cashCurrency": "cash_price.currency",
    "centsPerPoint": "cpp",
    "seats": "seats",
    "cabin": "cabin",
    "aircraft": "aircraft",
    "fareClass": "fare_class",
    "premiumCabinPercent": "premium_cabin_percent",
    "departsAt": "departure",
    "arrivesAt": "arrival",
    "durationMinutes": "duration_minutes",
    "stops": "stops",
    "segments": "segments",
    "bookingUrl": "booking_url",
    "rawUrl": "raw_url",
}


@mcp.tool
def search_awards(
    origins: list[str],
    destinations: list[str],
    startDate: str,
    endDate: str,
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
    includeTrips: bool = True,
    onlyDirectFlights: bool = False,
    strategy: str = "auto",
    bruteForce: dict[str, Any] | None = None,
    maxMileageCost: int | None = None,
    minMileageCost: int | None = None,
    maxTaxes: float | None = None,
    minSeats: int | None = None,
    maxStops: int | None = None,
    marketingAirlines: list[str] | None = None,
    operatingAirlines: list[str] | None = None,
    aircraft: list[str] | None = None,
    flightNumbers: list[str] | None = None,
    maxDurationMinutes: int | None = None,
    minPremiumCabinPercent: float | None = None,
    minCpp: float | None = None,
    sortBy: str = "date",
    sortDirection: str = "asc",
) -> dict[str, Any]:
    """Search credential-free award flight leads from local and public JSON feeds."""
    return _search_awards_impl(
        origins=origins,
        destinations=destinations,
        startDate=startDate,
        endDate=endDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=maxResults,
        includeTrips=includeTrips,
        onlyDirectFlights=onlyDirectFlights,
        strategy=strategy,
        bruteForce=bruteForce,
        maxMileageCost=maxMileageCost,
        minMileageCost=minMileageCost,
        maxTaxes=maxTaxes,
        minSeats=minSeats,
        maxStops=maxStops,
        marketingAirlines=marketingAirlines,
        operatingAirlines=operatingAirlines,
        aircraft=aircraft,
        flightNumbers=flightNumbers,
        maxDurationMinutes=maxDurationMinutes,
        minPremiumCabinPercent=minPremiumCabinPercent,
        minCpp=minCpp,
        sortBy=sortBy,
        sortDirection=sortDirection,
    )


def _search_awards_impl(
    origins: list[str],
    destinations: list[str],
    startDate: str,
    endDate: str,
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
    includeTrips: bool = True,
    onlyDirectFlights: bool = False,
    strategy: str = "auto",
    bruteForce: dict[str, Any] | None = None,
    maxMileageCost: int | None = None,
    minMileageCost: int | None = None,
    maxTaxes: float | None = None,
    minSeats: int | None = None,
    maxStops: int | None = None,
    marketingAirlines: list[str] | None = None,
    operatingAirlines: list[str] | None = None,
    aircraft: list[str] | None = None,
    flightNumbers: list[str] | None = None,
    maxDurationMinutes: int | None = None,
    minPremiumCabinPercent: float | None = None,
    minCpp: float | None = None,
    sortBy: str = "date",
    sortDirection: str = "asc",
) -> dict[str, Any]:
    started = time.time()
    search = _award_search_input(
        origins=origins,
        destinations=destinations,
        startDate=startDate,
        endDate=endDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=maxResults,
        includeTrips=includeTrips,
        onlyDirectFlights=onlyDirectFlights,
        strategy=strategy,
        bruteForce=bruteForce,
        maxMileageCost=maxMileageCost,
        minMileageCost=minMileageCost,
        maxTaxes=maxTaxes,
        minSeats=minSeats,
        maxStops=maxStops,
        marketingAirlines=marketingAirlines,
        operatingAirlines=operatingAirlines,
        aircraft=aircraft,
        flightNumbers=flightNumbers,
        maxDurationMinutes=maxDurationMinutes,
        minPremiumCabinPercent=minPremiumCabinPercent,
        minCpp=minCpp,
        sortBy=sortBy,
        sortDirection=sortDirection,
    )
    response = _run_award_search(search, started)
    _record_history(response["results"])
    return response


@mcp.tool
def explore_awards(
    startDate: str,
    endDate: str,
    originRegion: str | None = None,
    destinationRegion: str | None = None,
    origins: list[str] | None = None,
    destinations: list[str] | None = None,
    cabins: list[str] | None = None,
    programs: list[str] | None = None,
    maxResults: int = 100,
    maxMileageCost: int | None = None,
    minMileageCost: int | None = None,
    maxTaxes: float | None = None,
    minSeats: int | None = None,
    maxStops: int | None = None,
    marketingAirlines: list[str] | None = None,
    operatingAirlines: list[str] | None = None,
    aircraft: list[str] | None = None,
    flightNumbers: list[str] | None = None,
    maxDurationMinutes: int | None = None,
    minPremiumCabinPercent: float | None = None,
    minCpp: float | None = None,
    sortBy: str = "date",
    sortDirection: str = "asc",
) -> dict[str, Any]:
    """Explore cached/public award leads by route, cabin, program, and date window."""
    _assert_date_window(startDate, endDate)
    input_origins = origins or _region_airports(originRegion)
    input_destinations = destinations or _region_airports(destinationRegion)
    if not input_origins:
        input_origins = _feed_airports("origin")
    if not input_destinations:
        input_destinations = _feed_airports("destination")
    return _search_awards_impl(
        origins=input_origins[:25],
        destinations=input_destinations[:25],
        startDate=startDate,
        endDate=endDate,
        cabins=cabins,
        passengers=1,
        programs=programs,
        maxResults=maxResults,
        includeTrips=True,
        onlyDirectFlights=False,
        strategy="brute_force",
        bruteForce={"enabled": True, "maxQueries": 2000, "concurrency": 2, "delayMs": 0},
        maxMileageCost=maxMileageCost,
        minMileageCost=minMileageCost,
        maxTaxes=maxTaxes,
        minSeats=minSeats,
        maxStops=maxStops,
        marketingAirlines=marketingAirlines,
        operatingAirlines=operatingAirlines,
        aircraft=aircraft,
        flightNumbers=flightNumbers,
        maxDurationMinutes=maxDurationMinutes,
        minPremiumCabinPercent=minPremiumCabinPercent,
        minCpp=minCpp,
        sortBy=sortBy,
        sortDirection=sortDirection,
    )


@mcp.tool
def verify_award(
    origin: str,
    destination: str,
    date: str,
    cabin: str | None = None,
    program: str | None = None,
    source: str | None = None,
    flightNumber: str | None = None,
    passengers: int = 1,
) -> dict[str, Any]:
    """Re-run a narrow award lead search. Results are leads and must be verified with the loyalty program."""
    response = _search_awards_impl(
        origins=[origin],
        destinations=[destination],
        startDate=date,
        endDate=date,
        cabins=[cabin] if cabin else None,
        passengers=passengers,
        programs=[program] if program else None,
        maxResults=25,
        flightNumbers=[flightNumber] if flightNumber else None,
    )
    results = [result for result in response["results"] if not source or _includes(result.get("source"), source)]
    return {
        "results": results,
        "diagnostics": response["diagnostics"],
        "warnings": [
            "Verification re-checks configured feeds only. Confirm availability, price, cabin, and passenger count on the loyalty program website before transferring points."
        ],
    }


@mcp.tool
def refresh_route(
    origins: list[str],
    destinations: list[str],
    startDate: str,
    endDate: str,
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
    includeTrips: bool = True,
    onlyDirectFlights: bool = False,
    strategy: str = "auto",
    bruteForce: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Refresh a route/date search against configured credential-free feeds."""
    return _search_awards_impl(
        origins=origins,
        destinations=destinations,
        startDate=startDate,
        endDate=endDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=maxResults,
        includeTrips=includeTrips,
        onlyDirectFlights=onlyDirectFlights,
        strategy=strategy,
        bruteForce=bruteForce,
    )


@mcp.tool
def search_round_trip_awards(
    origins: list[str],
    destinations: list[str],
    outboundStartDate: str,
    outboundEndDate: str,
    returnStartDate: str,
    returnEndDate: str,
    minStayDays: int | None = None,
    maxStayDays: int | None = None,
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
    legMaxResults: int = 40,
    includeTrips: bool = True,
    onlyDirectFlights: bool = False,
    strategy: str = "auto",
    bruteForce: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Search outbound and return award space, then combine compatible round-trip candidates."""
    outbound = _search_awards_impl(
        origins=origins,
        destinations=destinations,
        startDate=outboundStartDate,
        endDate=outboundEndDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=legMaxResults,
        includeTrips=includeTrips,
        onlyDirectFlights=onlyDirectFlights,
        strategy=strategy,
        bruteForce=bruteForce,
    )
    inbound = _search_awards_impl(
        origins=destinations,
        destinations=origins,
        startDate=returnStartDate,
        endDate=returnEndDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=legMaxResults,
        includeTrips=includeTrips,
        onlyDirectFlights=onlyDirectFlights,
        strategy=strategy,
        bruteForce=bruteForce,
    )
    return {
        "itineraries": _build_round_trips(outbound["results"], inbound["results"], minStayDays, maxStayDays, maxResults),
        "outboundDiagnostics": outbound["diagnostics"],
        "inboundDiagnostics": inbound["diagnostics"],
    }


@mcp.tool
def search_multi_city_awards(
    legs: list[dict[str, Any]],
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
    legMaxResults: int = 25,
    includeTrips: bool = True,
    onlyDirectFlights: bool = False,
    strategy: str = "auto",
    bruteForce: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Search each multi-city leg and combine compatible leg results into itineraries."""
    leg_responses = []
    for leg in legs:
        leg_responses.append(
            _search_awards_impl(
                origins=leg["origins"],
                destinations=leg["destinations"],
                startDate=leg["startDate"],
                endDate=leg["endDate"],
                cabins=cabins,
                passengers=passengers,
                programs=programs,
                maxResults=legMaxResults,
                includeTrips=includeTrips,
                onlyDirectFlights=onlyDirectFlights,
                strategy=strategy,
                bruteForce=bruteForce,
            )
        )
    return {
        "itineraries": _build_multi_city([response["results"] for response in leg_responses], maxResults),
        "diagnosticsByLeg": [response["diagnostics"] for response in leg_responses],
    }


@mcp.tool
def calendar_awards(
    origins: list[str],
    destinations: list[str],
    startDate: str,
    endDate: str,
    groupBy: list[str] | None = None,
    cabins: list[str] | None = None,
    passengers: int = 1,
    programs: list[str] | None = None,
    maxResults: int = 50,
) -> dict[str, Any]:
    """Search awards and return a calendar-style grouping."""
    response = _search_awards_impl(
        origins=origins,
        destinations=destinations,
        startDate=startDate,
        endDate=endDate,
        cabins=cabins,
        passengers=passengers,
        programs=programs,
        maxResults=maxResults,
    )
    return {
        "calendar": _build_calendar(response["results"], groupBy or ["date", "program", "cabin"]),
        "results": response["results"],
        "diagnostics": response["diagnostics"],
    }


@mcp.tool
def search_deals(
    search: dict[str, Any] | None = None,
    minCpp: float | None = None,
    maxMileageCost: int | None = None,
    maxTaxes: float | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Rank award leads by deal quality from a supplied explore search or local history."""
    return _search_deals_impl(search=search, minCpp=minCpp, maxMileageCost=maxMileageCost, maxTaxes=maxTaxes, limit=limit)


def _search_deals_impl(
    search: dict[str, Any] | None = None,
    minCpp: float | None = None,
    maxMileageCost: int | None = None,
    maxTaxes: float | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    response = _search_from_object(search) if search else None
    source_results = response["results"] if response else [entry["result"] for entry in _read_json(AWARD_HISTORY_PATH, [])]
    filtered = [_with_cpp(result) for result in source_results if _deal_filter(result, minCpp, maxMileageCost, maxTaxes)]
    return {
        "deals": _summarize_deals(filtered, limit),
        "diagnostics": response.get("diagnostics") if response else None,
        "warnings": [] if response else ["No search was supplied, so deals were ranked from local result history."],
    }


@mcp.tool
def generate_deal_digest(
    search: dict[str, Any] | None = None,
    minCpp: float | None = None,
    maxMileageCost: int | None = None,
    maxTaxes: float | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Return a concise ranked digest of notable award leads."""
    deals = _search_deals_impl(search=search, minCpp=minCpp, maxMileageCost=maxMileageCost, maxTaxes=maxTaxes, limit=limit)
    return {
        "generatedAt": _now(),
        "dealCount": len(deals["deals"]),
        "deals": deals["deals"],
        "diagnostics": deals.get("diagnostics"),
        "warnings": deals.get("warnings", []),
    }


@mcp.tool
def source_status() -> dict[str, Any]:
    """Show configured data sources, credential status, and file-backed store paths."""
    local_ready = LOCAL_AWARD_FEED_PATH.exists()
    return {
        "sources": [
            {
                "id": "award-flight-daily",
                "name": "Award Flight Daily MCP",
                "kind": "partner_api",
                "health": "ready" if AWARD_FLIGHT_DAILY_ENABLED and AWARD_FLIGHT_DAILY_MCP_URL else "disabled",
                "message": (
                    "No-key remote MCP source enabled. Free tier may be rate-limited."
                    if AWARD_FLIGHT_DAILY_ENABLED and AWARD_FLIGHT_DAILY_MCP_URL and not AWARD_FLIGHT_DAILY_API_KEY
                    else "Remote MCP source enabled with API key."
                    if AWARD_FLIGHT_DAILY_ENABLED and AWARD_FLIGHT_DAILY_MCP_URL
                    else "Disabled with AWARD_FLIGHT_DAILY_ENABLED=false or empty AWARD_FLIGHT_DAILY_MCP_URL."
                ),
                "supportsLive": False,
                "supportsCached": True,
                "supportsBatch": False,
                "supportsExplore": False,
                "rateLimitMs": 1000,
            },
            {
                "id": "local-award-feed",
                "name": "Local Award JSON Feed",
                "kind": "manual",
                "health": "ready" if local_ready else "error",
                "message": f"Reads credential-free award leads from {LOCAL_AWARD_FEED_PATH}" if local_ready else f"Missing {LOCAL_AWARD_FEED_PATH}",
                "supportsLive": False,
                "supportsCached": True,
                "supportsBatch": True,
                "supportsExplore": True,
                "rateLimitMs": 0,
            },
            {
                "id": "public-award-feed",
                "name": "Public Award JSON Feed",
                "kind": "public_json",
                "health": "ready" if PUBLIC_AWARD_FEED_ENABLED and PUBLIC_AWARD_FEED_URL else "disabled",
                "message": f"GET {PUBLIC_AWARD_FEED_URL}" if PUBLIC_AWARD_FEED_ENABLED and PUBLIC_AWARD_FEED_URL else "Disabled with PUBLIC_AWARD_FEED_ENABLED=false or empty PUBLIC_AWARD_FEED_URL.",
                "supportsLive": False,
                "supportsCached": True,
                "supportsBatch": False,
                "supportsExplore": True,
                "rateLimitMs": 500,
            },
        ],
        "cache": {"type": "stateless"},
        "feeds": {
            "localAwardFeedPath": str(LOCAL_AWARD_FEED_PATH),
            "awardFlightDailyMcpUrl": AWARD_FLIGHT_DAILY_MCP_URL,
            "publicAwardFeedUrl": PUBLIC_AWARD_FEED_URL,
            "historyPath": str(AWARD_HISTORY_PATH),
            "alertsPath": str(AWARD_ALERTS_PATH),
            "pointsWalletPath": str(AWARD_POINTS_WALLET_PATH),
            "hotelResultsPath": str(HOTEL_RESULTS_PATH),
            "hotelAlertsPath": str(HOTEL_ALERTS_PATH),
            "transferBonusesPath": str(TRANSFER_BONUSES_PATH),
            "seatMapsPath": str(SEAT_MAPS_PATH),
            "fareClassesPath": str(FARE_CLASSES_PATH),
        },
        "warnings": [
            "This Horizon entrypoint is credential-free. It searches JSON feeds and planning data, not private airline APIs."
        ],
    }


@mcp.tool
def get_transfer_partners(bank: str | None = None, program: str | None = None) -> dict[str, Any]:
    """Return built-in US transferable-currency partner metadata."""
    return _get_transfer_partners_impl(bank=bank, program=program)


def _get_transfer_partners_impl(bank: str | None = None, program: str | None = None) -> dict[str, Any]:
    return {
        "transferPartners": [
            partner
            for partner in TRANSFER_PARTNERS
            if (not bank or _includes(partner["bank"], bank)) and (not program or _includes(partner["program"], program))
        ]
    }


@mcp.tool
def get_booking_links(origin: str, destination: str, date: str, programs: list[str] | None = None) -> dict[str, Any]:
    """Return loyalty-program booking links and verification instructions for a route/date."""
    selected_programs = programs or [name for _, name, _ in PROGRAM_LINKS]
    links = []
    for program in selected_programs:
        match = next(((name, url) for pattern, name, url in PROGRAM_LINKS if pattern.search(program)), None)
        links.append(
            {
                "program": program,
                "url": match[1] if match else None,
                "instructions": [
                    f"Search {origin.upper()}-{destination.upper()} on {date}.",
                    "Use the airline or loyalty program award/redeem-with-miles option.",
                    "Confirm points, taxes, cabin, flight numbers, and passenger count before transferring points.",
                ],
                "warning": None if match else "No direct booking URL template is configured for this program yet.",
            }
        )
    return {"bookingLinks": links}


@mcp.tool
def build_booking_plan(
    origin: str,
    destination: str,
    date: str,
    program: str | None = None,
    cabin: str | None = None,
    mileageCost: int | None = None,
    taxes: float | None = None,
    taxesCurrency: str = "USD",
    passengers: int = 1,
    bank: str | None = None,
    flightNumbers: list[str] | None = None,
    bookingUrl: str | None = None,
) -> dict[str, Any]:
    """Create transfer and booking steps for a selected award lead."""
    bonus_response = _get_transfer_bonuses_impl(bank=bank, program=program, activeOn=date)
    matching_partners = _get_transfer_partners_impl(bank=bank, program=program)["transferPartners"]
    return {
        "bookingPlan": {
            "route": f"{origin.upper()}-{destination.upper()}",
            "date": date,
            "program": program,
            "cabin": cabin,
            "flightNumbers": flightNumbers or [],
            "passengers": passengers,
            "estimatedCost": {"mileageCost": mileageCost, "taxes": taxes, "taxesCurrency": taxesCurrency},
            "transferPartners": matching_partners,
            "transferBonuses": bonus_response["transferBonuses"],
            "steps": [
                "Verify the exact flight on the operating loyalty program before moving points.",
                "Confirm passenger count, cabin, flight numbers, mileage, taxes, and cancellation rules.",
                "Check transfer partners and any active transfer bonus for the selected program.",
                "Transfer only the points needed after availability is confirmed.",
                "Book on the loyalty program website and save the confirmation number.",
            ],
            "bookingUrl": bookingUrl,
            "warnings": [
                "Award space can disappear while points are transferring.",
                "Most transferable points cannot be reversed after transfer.",
                "Some itineraries include mixed cabins, married-segment logic, or phantom availability.",
            ],
        },
        "warnings": bonus_response.get("warnings", []),
    }


@mcp.tool
def compare_cash_points(
    cashPrice: float,
    mileageCost: int,
    taxes: float = 0,
    transferBonusPercent: float = 0,
    portalPointsCost: int | None = None,
    currency: str = "USD",
) -> dict[str, Any]:
    """Calculate cents-per-point and compare award transfer value against cash/portal booking."""
    effective_miles = int((mileageCost / (1 + transferBonusPercent / 100)) + 0.999999)
    award_net_value = max(0, cashPrice - taxes)
    cents_per_point = (award_net_value / effective_miles) * 100
    portal_cpp = (cashPrice / portalPointsCost) * 100 if portalPointsCost else None
    return {
        "comparison": {
            "currency": currency,
            "cashPrice": cashPrice,
            "awardTaxes": taxes,
            "mileageCost": mileageCost,
            "effectiveTransferablePointsNeeded": effective_miles,
            "transferBonusPercent": transferBonusPercent,
            "centsPerPoint": cents_per_point,
            "portalPointsCost": portalPointsCost,
            "portalCentsPerPoint": portal_cpp,
            "recommendation": "portal_cash_booking" if portal_cpp is not None and portal_cpp > cents_per_point else "transfer_partner_award",
        }
    }


@mcp.tool
def get_transfer_bonuses(bank: str | None = None, program: str | None = None, activeOn: str | None = None) -> dict[str, Any]:
    """Return configured current transfer bonuses from TRANSFER_BONUSES_PATH."""
    return _get_transfer_bonuses_impl(bank=bank, program=program, activeOn=activeOn)


def _get_transfer_bonuses_impl(bank: str | None = None, program: str | None = None, activeOn: str | None = None) -> dict[str, Any]:
    warnings = []
    bonuses = _read_json(TRANSFER_BONUSES_PATH, [])
    if not isinstance(bonuses, list):
        warnings.append(f"{TRANSFER_BONUSES_PATH} did not contain a JSON array.")
        bonuses = []
    filtered = []
    for bonus in bonuses:
        if bank and not _includes(bonus.get("bank"), bank):
            continue
        if program and not _includes(bonus.get("program"), program):
            continue
        if activeOn and not _active_on(bonus, activeOn):
            continue
        filtered.append(bonus)
    if not TRANSFER_BONUSES_PATH.exists():
        warnings.append(f"Transfer bonus feed not found: {TRANSFER_BONUSES_PATH}")
    return {"transferBonuses": filtered, "warnings": warnings}


@mcp.tool
def upsert_points_balance(
    program: str,
    balance: int,
    id: str | None = None,
    owner: str | None = None,
    bank: str | None = None,
    transferableTo: list[str] | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Add or update a local points balance for planning."""
    balances = _read_store_list(AWARD_POINTS_WALLET_PATH)
    now = _now()
    balance_id = id or _stable_id([owner, bank, program])
    record = {
        "id": balance_id,
        "owner": owner,
        "bank": bank,
        "program": program,
        "balance": balance,
        "transferableTo": transferableTo or [],
        "notes": notes,
        "updatedAt": now,
    }
    balances = [existing for existing in balances if existing.get("id") != balance_id]
    balances.append(record)
    _write_json(AWARD_POINTS_WALLET_PATH, balances)
    return {"balance": record}


@mcp.tool
def list_points_balances(owner: str | None = None, bank: str | None = None, program: str | None = None) -> dict[str, Any]:
    """List locally stored bank and loyalty-program point balances."""
    balances = [
        balance
        for balance in _read_store_list(AWARD_POINTS_WALLET_PATH)
        if (not owner or _includes(balance.get("owner"), owner))
        and (not bank or _includes(balance.get("bank"), bank))
        and (not program or _includes(balance.get("program"), program))
    ]
    return {"balances": balances}


@mcp.tool
def delete_points_balance(id: str) -> dict[str, Any]:
    """Delete a locally stored points balance by id."""
    balances = _read_store_list(AWARD_POINTS_WALLET_PATH)
    next_balances = [balance for balance in balances if balance.get("id") != id]
    _write_json(AWARD_POINTS_WALLET_PATH, next_balances)
    return {"deleted": len(next_balances) != len(balances), "id": id}


@mcp.tool
def search_hotels(
    checkIn: str,
    checkOut: str,
    location: str | None = None,
    hotelName: str | None = None,
    programs: list[str] | None = None,
    maxPointsPerNight: int | None = None,
    maxCashRate: float | None = None,
    minCpp: float | None = None,
    maxResults: int = 50,
    sortBy: str = "points",
    sortDirection: str = "asc",
) -> dict[str, Any]:
    """Search configured hotel award result feeds."""
    return _search_hotels_impl(
        checkIn=checkIn,
        checkOut=checkOut,
        location=location,
        hotelName=hotelName,
        programs=programs,
        maxPointsPerNight=maxPointsPerNight,
        maxCashRate=maxCashRate,
        minCpp=minCpp,
        maxResults=maxResults,
        sortBy=sortBy,
        sortDirection=sortDirection,
    )


def _search_hotels_impl(
    checkIn: str,
    checkOut: str,
    location: str | None = None,
    hotelName: str | None = None,
    programs: list[str] | None = None,
    maxPointsPerNight: int | None = None,
    maxCashRate: float | None = None,
    minCpp: float | None = None,
    maxResults: int = 50,
    sortBy: str = "points",
    sortDirection: str = "asc",
) -> dict[str, Any]:
    _assert_date_window(checkIn, checkOut)
    results = _extract_items(_read_json(HOTEL_RESULTS_PATH, []))
    filtered = []
    for result in results:
        if location and not _includes(result.get("location"), location):
            continue
        if hotelName and not _includes(result.get("hotelName"), hotelName):
            continue
        if programs and not any(_includes(result.get("program"), item) for item in programs):
            continue
        if result.get("checkIn") < checkIn or result.get("checkOut") > checkOut:
            continue
        if maxPointsPerNight is not None and _number(result.get("pointsPerNight"), 10**12) > maxPointsPerNight:
            continue
        if maxCashRate is not None and _number(result.get("cashRate"), 10**12) > maxCashRate:
            continue
        if minCpp is not None and _number(result.get("centsPerPoint"), 0) < minCpp:
            continue
        filtered.append(result)
    key_map = {"points": "pointsPerNight", "cash": "cashRate", "cpp": "centsPerPoint", "distance": "distanceMiles", "updated_at": "foundAt"}
    filtered = _sort_dicts(filtered, key_map.get(sortBy, "pointsPerNight"), sortDirection)
    warnings = [] if HOTEL_RESULTS_PATH.exists() else [f"Hotel results feed not found: {HOTEL_RESULTS_PATH}"]
    return {"results": filtered[:maxResults], "warnings": warnings}


@mcp.tool
def create_hotel_alert(name: str, search: dict[str, Any], enabled: bool = True) -> dict[str, Any]:
    """Persist a hotel award search alert definition."""
    return {"alert": _create_alert(HOTEL_ALERTS_PATH, name, search, enabled)}


@mcp.tool
def list_hotel_alerts(enabledOnly: bool = False) -> dict[str, Any]:
    """List saved hotel award alerts."""
    return {"alerts": _list_alerts(HOTEL_ALERTS_PATH, enabledOnly)}


@mcp.tool
def delete_hotel_alert(id: str) -> dict[str, Any]:
    """Delete a saved hotel award alert by id."""
    return _delete_alert(HOTEL_ALERTS_PATH, id)


@mcp.tool
def run_hotel_alerts(ids: list[str] | None = None, enabledOnly: bool = True, maxAlerts: int = 25) -> dict[str, Any]:
    """Run saved hotel alerts now and return matching hotel award leads."""
    selected = _select_alerts(HOTEL_ALERTS_PATH, ids, enabledOnly, maxAlerts)
    runs = []
    for alert in selected:
        search = alert["search"]
        response = _search_hotels_impl(**search)
        updated = _mark_alert_run(HOTEL_ALERTS_PATH, alert["id"], len(response["results"]))
        runs.append({"alert": updated or alert, "matches": response["results"], "warnings": response.get("warnings", [])})
    return {"runs": runs}


@mcp.tool
def get_seat_map(
    flightNumber: str,
    airline: str | None = None,
    date: str | None = None,
    origin: str | None = None,
    destination: str | None = None,
    cabin: str | None = None,
    aircraft: str | None = None,
) -> dict[str, Any]:
    """Return configured seat-map data or links for a flight."""
    results = []
    for item in _extract_items(_read_json(SEAT_MAPS_PATH, [])):
        if not _same(item.get("flightNumber"), flightNumber):
            continue
        if airline and not _includes(item.get("airline"), airline):
            continue
        if date and item.get("date") != date:
            continue
        if origin and not _same(item.get("origin"), origin):
            continue
        if destination and not _same(item.get("destination"), destination):
            continue
        if cabin and not _same(item.get("cabin"), cabin):
            continue
        if aircraft and not _includes(item.get("aircraft"), aircraft):
            continue
        results.append(item)
    warnings = [] if SEAT_MAPS_PATH.exists() else [f"Seat-map feed not found: {SEAT_MAPS_PATH}"]
    return {"seatMaps": results, "warnings": warnings}


@mcp.tool
def get_fare_classes(
    flightNumber: str,
    airline: str | None = None,
    date: str | None = None,
    origin: str | None = None,
    destination: str | None = None,
) -> dict[str, Any]:
    """Return configured fare-class or award-bucket data for a flight."""
    results = []
    for item in _extract_items(_read_json(FARE_CLASSES_PATH, [])):
        if not _same(item.get("flightNumber"), flightNumber):
            continue
        if airline and not _includes(item.get("airline"), airline):
            continue
        if date and item.get("date") != date:
            continue
        if origin and not _same(item.get("origin"), origin):
            continue
        if destination and not _same(item.get("destination"), destination):
            continue
        results.append(item)
    warnings = [] if FARE_CLASSES_PATH.exists() else [f"Fare-class feed not found: {FARE_CLASSES_PATH}"]
    return {"fareClasses": results, "warnings": warnings}


@mcp.tool
def get_price_history(
    origin: str | None = None,
    destination: str | None = None,
    startDate: str | None = None,
    endDate: str | None = None,
    program: str | None = None,
    cabin: str | None = None,
    maxEntries: int = 500,
) -> dict[str, Any]:
    """Return locally observed historical award results captured by searches and alerts."""
    history = [
        entry
        for entry in _read_store_list(AWARD_HISTORY_PATH)
        if _history_match(entry.get("result", {}), origin, destination, startDate, endDate, program, cabin)
    ]
    return {"history": history[:maxEntries]}


@mcp.tool
def get_route_stats(
    origin: str | None = None,
    destination: str | None = None,
    program: str | None = None,
    cabin: str | None = None,
    startDate: str | None = None,
    endDate: str | None = None,
) -> dict[str, Any]:
    """Summarize locally observed route availability, prices, programs, cabins, and seen dates."""
    entries = [
        entry
        for entry in _read_store_list(AWARD_HISTORY_PATH)
        if _history_match(entry.get("result", {}), origin, destination, startDate, endDate, program, cabin)
    ]
    results = [entry["result"] for entry in entries]
    mileage = [_number(result.get("mileageCost")) for result in results if result.get("mileageCost") is not None]
    taxes = [_number(result.get("taxes")) for result in results if result.get("taxes") is not None]
    observed = sorted(entry.get("observedAt") for entry in entries if entry.get("observedAt"))
    return {
        "stats": {
            "resultCount": len(results),
            "uniqueResultCount": len({_result_key(result) for result in results}),
            "cheapestMileageCost": min(mileage) if mileage else None,
            "highestMileageCost": max(mileage) if mileage else None,
            "lowestTaxes": min(taxes) if taxes else None,
            "highestTaxes": max(taxes) if taxes else None,
            "programs": sorted({result.get("program") for result in results if result.get("program")}),
            "cabins": sorted({result.get("cabin") for result in results if result.get("cabin")}),
            "firstSeenAt": observed[0] if observed else None,
            "lastSeenAt": observed[-1] if observed else None,
        }
    }


@mcp.tool
def create_alert(
    name: str,
    search: dict[str, Any],
    enabled: bool = True,
    maxMileageCost: int | None = None,
    maxTaxes: float | None = None,
    minSeats: int | None = None,
) -> dict[str, Any]:
    """Persist an award search alert definition."""
    alert = _create_alert(AWARD_ALERTS_PATH, name, search, enabled)
    alert["maxMileageCost"] = maxMileageCost
    alert["maxTaxes"] = maxTaxes
    alert["minSeats"] = minSeats
    _upsert_alert(AWARD_ALERTS_PATH, alert)
    return {"alert": alert}


@mcp.tool
def list_alerts(enabledOnly: bool = False) -> dict[str, Any]:
    """List saved award alerts."""
    return {"alerts": _list_alerts(AWARD_ALERTS_PATH, enabledOnly)}


@mcp.tool
def delete_alert(id: str) -> dict[str, Any]:
    """Delete a saved award alert by id."""
    return _delete_alert(AWARD_ALERTS_PATH, id)


@mcp.tool
def run_alerts(ids: list[str] | None = None, enabledOnly: bool = True, maxAlerts: int = 25) -> dict[str, Any]:
    """Run saved award alerts now and return matching award leads."""
    selected = _select_alerts(AWARD_ALERTS_PATH, ids, enabledOnly, maxAlerts)
    runs = []
    for alert in selected:
        response = _search_from_object(alert["search"])
        matches = _filter_alert_matches(alert, response["results"])
        updated = _mark_alert_run(AWARD_ALERTS_PATH, alert["id"], len(matches))
        runs.append({"alert": updated or alert, "matches": matches, "diagnostics": response["diagnostics"]})
    return {"runs": runs}


def _run_award_search(search: dict[str, Any], started: float) -> dict[str, Any]:
    _assert_date_window(search["startDate"], search["endDate"])
    warnings: list[str] = []
    adapters_used: list[str] = []
    skipped: list[dict[str, Any]] = []
    attempted_queries = 0
    results: list[dict[str, Any]] = []

    if AWARD_FLIGHT_DAILY_ENABLED and AWARD_FLIGHT_DAILY_MCP_URL:
        afd_results, afd_warnings, afd_queries = _search_award_flight_daily(search)
        attempted_queries += afd_queries
        warnings.extend(afd_warnings)
        if afd_results:
            adapters_used.append("award-flight-daily")
            results.extend(afd_results)
        else:
            skipped.append(_source_skip("award-flight-daily", "No normalized Award Flight Daily results."))
    else:
        skipped.append(_source_skip("award-flight-daily", "Disabled or missing AWARD_FLIGHT_DAILY_MCP_URL.", health="disabled"))

    local_results, local_warnings = _search_local_feed(search)
    warnings.extend(local_warnings)
    if local_results:
        adapters_used.append("local-award-feed")
        results.extend(local_results)
    else:
        skipped.append(_source_skip("local-award-feed", "No matching local feed results."))

    if PUBLIC_AWARD_FEED_ENABLED and PUBLIC_AWARD_FEED_URL:
        public_results, public_warnings, public_queries = _search_public_feed(search)
        attempted_queries += public_queries
        warnings.extend(public_warnings)
        if public_results:
            adapters_used.append("public-award-feed")
            results.extend(public_results)
        else:
            skipped.append(_source_skip("public-award-feed", "No matching public feed results."))
    else:
        skipped.append(_source_skip("public-award-feed", "Disabled or missing PUBLIC_AWARD_FEED_URL.", health="disabled"))

    filtered = _dedupe_results([result for result in results if _matches_award_filters(result, search)])
    sorted_results = _sort_awards(filtered, search.get("sortBy", "date"), search.get("sortDirection", "asc"))[: search["maxResults"]]
    diagnostics = {
        "strategy": search["strategy"],
        "adaptersUsed": adapters_used,
        "adaptersSkipped": skipped,
        "attemptedQueries": attempted_queries or max(1, len(search["origins"]) * len(search["destinations"])),
        "cacheHits": 0,
        "warnings": warnings,
        "elapsedMs": round((time.time() - started) * 1000),
    }
    return {"results": sorted_results, "diagnostics": diagnostics}


def _search_award_flight_daily(search: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str], int]:
    warnings: list[str] = []
    results: list[dict[str, Any]] = []
    queries = _build_afd_queries(search)
    for query in queries:
        try:
            payload = _call_remote_mcp_tool(AWARD_FLIGHT_DAILY_MCP_URL, "afd_search_award_flights", {"params": query}, AWARD_FLIGHT_DAILY_API_KEY)
            message = _payload_message(payload)
            if message and not _extract_items(payload):
                warnings.append(f"award-flight-daily returned: {message}")
                continue
            found_at = _now()
            for item in _extract_items(payload):
                result = _normalize_afd_award(
                    item,
                    found_at=found_at,
                    default_origin=query.get("origin", ""),
                    default_destination=query.get("destination", ""),
                    default_date=query.get("date_from", search["startDate"]),
                    default_cabin=_from_afd_cabin(query.get("cabin")),
                )
                if _matches_award_search(result, search):
                    results.append(result)
        except Exception as exc:  # noqa: BLE001 - surface upstream/source failures to the caller.
            warnings.append(f"award-flight-daily request failed: {exc}")
    if not results and not warnings:
        warnings.append("award-flight-daily returned no normalized award availability for this query.")
    return results, warnings, len(queries)


def _build_afd_queries(search: dict[str, Any]) -> list[dict[str, Any]]:
    cabins = search.get("cabins") or [None]
    brute = search.get("bruteForce") or {}
    max_queries = min(int(brute.get("maxQueries", 2000)), 2000)
    queries = []
    for origin in search["origins"]:
        for destination in search["destinations"]:
            for cabin in cabins:
                query = _compact_dict(
                    {
                        "origin": origin,
                        "destination": destination,
                        "date_from": search["startDate"],
                        "date_to": search["endDate"],
                        "cabin": _to_afd_cabin(cabin) if cabin else None,
                        "source": ",".join(search.get("programs") or []) or None,
                        "direct_only": search.get("onlyDirectFlights", False),
                        "max_miles": search.get("maxMileageCost"),
                        "min_seats": search.get("minSeats") or search.get("passengers") or 1,
                        "limit": min(200, max(1, int(search.get("maxResults") or 50))),
                        "offset": 0,
                        "response_format": "json",
                    }
                )
                queries.append(query)
                if len(queries) >= max_queries:
                    return queries
    return queries


def _normalize_afd_award(
    raw: dict[str, Any],
    found_at: str,
    default_origin: str,
    default_destination: str,
    default_date: str,
    default_cabin: str | None,
) -> dict[str, Any]:
    origin = _string(raw.get("origin") or raw.get("from")) or default_origin
    destination = _string(raw.get("destination") or raw.get("to")) or default_destination
    date = (_string(raw.get("date") or raw.get("departure_date")) or default_date)[:10]
    cabin = _from_afd_cabin(_string(raw.get("cabin") or raw.get("cabin_class"))) or default_cabin
    flight_numbers = _split_flight_numbers(_string(raw.get("flight_number") or raw.get("flightNumbers") or raw.get("flight_numbers")))
    result = {
        "id": _stable_id(["award-flight-daily", raw.get("program") or raw.get("source"), origin, destination, date, cabin, raw.get("award_cost") or raw.get("miles") or raw.get("mileage")]),
        "source": "award-flight-daily",
        "sourceKind": "partner_api",
        "sourceUpdatedAt": _string(raw.get("updated_at") or raw.get("updatedAt")),
        "foundAt": found_at,
        "confidence": "medium",
        "program": _string(raw.get("program_name") or raw.get("program") or raw.get("source") or raw.get("loyalty_program")),
        "origin": origin.upper(),
        "destination": destination.upper(),
        "date": date,
        "cabin": cabin,
        "seats": _optional_number(raw.get("seats") or raw.get("remaining_seats") or raw.get("availability_count")),
        "mileageCost": _optional_number(raw.get("award_cost") or raw.get("miles") or raw.get("mileage") or raw.get("mileage_cost")),
        "taxes": _optional_number(raw.get("taxes") or raw.get("fees")),
        "taxesCurrency": _string(raw.get("taxes_currency") or raw.get("currency")),
        "durationMinutes": _optional_number(raw.get("duration_minutes") or raw.get("duration")),
        "stops": _optional_number(raw.get("stops")) if raw.get("stops") is not None else _infer_stops(raw.get("direct")),
        "marketingAirline": _string(raw.get("airline_name") or raw.get("airline") or raw.get("airlines") or raw.get("marketing_airline")),
        "operatingAirline": _string(raw.get("operating_airline")),
        "flightNumbers": flight_numbers,
        "aircraft": _string(raw.get("equipment") or raw.get("aircraft")),
        "segments": [],
        "warnings": ["Cached Award Flight Daily result. Verify availability on the loyalty program website before transferring points."],
        "raw": raw,
    }
    return _compact_dict(result)


def _call_remote_mcp_tool(url: str, tool_name: str, arguments: dict[str, Any], api_key: str | None = None) -> Any:
    headers = {"user-agent": "award-flights-mcp-horizon/0.1"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
        headers["x-api-key"] = api_key

    initialize_headers, _ = _post_mcp_json(
        url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "award-flights-mcp-horizon", "version": "0.1.0"},
            },
        },
        headers,
    )
    session_id = initialize_headers.get("mcp-session-id") or initialize_headers.get("Mcp-Session-Id")
    with contextlib.suppress(Exception):
        _post_mcp_json(url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, headers, session_id=session_id)
    _, response = _post_mcp_json(
        url,
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}},
        headers,
        session_id=session_id,
    )
    return _extract_mcp_payload(response)


def _post_mcp_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, session_id: str | None = None) -> tuple[dict[str, str], Any]:
    request_headers = {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        **(headers or {}),
    }
    if session_id:
        request_headers["mcp-session-id"] = session_id
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=request_headers)
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - URL is configured by the server owner.
        body = response.read().decode("utf-8")
        return dict(response.headers.items()), _parse_mcp_body(body)


def _parse_mcp_body(body: str) -> Any:
    text = body.strip()
    if not text:
        return {}
    if text.startswith("event:") or "\ndata:" in text:
        for line in text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
    return json.loads(text)


def _extract_mcp_payload(response: Any) -> Any:
    record = response if isinstance(response, dict) else {}
    result = record.get("result")
    if isinstance(result, dict):
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            unwrapped = _unwrap_result(structured)
            return structured if unwrapped is None else unwrapped
        unwrapped = _unwrap_result(result)
        if unwrapped is not None:
            return unwrapped
        for content in result.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "text":
                parsed = _parse_json_text(_string(content.get("text")) or "")
                if parsed is not None:
                    return parsed
                return {"message": content.get("text")}
    return response


def _unwrap_result(record: dict[str, Any]) -> Any:
    if "result" not in record:
        return None
    value = record.get("result")
    if isinstance(value, str):
        parsed = _parse_json_text(value)
        return parsed if parsed is not None else {"message": value}
    return value


def _parse_json_text(text: str) -> Any:
    stripped = text.strip()
    candidates = [stripped]
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped)
    if fenced:
        candidates.append(fenced.group(1))
    embedded = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", stripped)
    if embedded:
        candidates.append(embedded.group(1))
    for candidate in candidates:
        if not candidate:
            continue
        with contextlib.suppress(Exception):
            return json.loads(candidate)
    return None


def _payload_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
        return _string(payload.get("error") or payload.get("message") or payload.get("detail") or payload.get("result"))
    return _string(payload)


def _to_afd_cabin(cabin: str | None) -> str | None:
    if cabin == "economy":
        return "Y"
    if cabin == "premium":
        return "W"
    if cabin == "business":
        return "J"
    if cabin == "first":
        return "F"
    return None


def _from_afd_cabin(value: str | None) -> str | None:
    normalized = (value or "").strip().upper()
    if normalized in {"Y", "ECONOMY"}:
        return "economy"
    if normalized in {"W", "PREMIUM", "PREMIUM_ECONOMY"}:
        return "premium"
    if normalized in {"J", "BUSINESS"}:
        return "business"
    if normalized in {"F", "FIRST"}:
        return "first"
    return None


def _infer_stops(value: Any) -> int | None:
    return 0 if value is True else 1 if value is False else None


def _search_local_feed(search: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    if not LOCAL_AWARD_FEED_PATH.exists():
        return [], [f"local-award-feed skipped because {LOCAL_AWARD_FEED_PATH} does not exist."]
    payload = _read_json(LOCAL_AWARD_FEED_PATH, {})
    found_at = _now()
    results = []
    for item in _extract_items(payload):
        result = _normalize_award(item, LOCAL_FIELD_MAP, "local-award-feed", "manual", found_at, confidence="low")
        if _matches_award_search(result, search):
            result["warnings"] = [
                *result.get("warnings", []),
                "Local JSON feed result. It is only as current as the feed file and must be verified on the loyalty program website.",
            ]
            results.append(result)
    warning = f"local-award-feed read {LOCAL_AWARD_FEED_PATH}. Results are feed leads, not guaranteed live inventory."
    return results, [warning] if results else [f"local-award-feed found no matching results in {LOCAL_AWARD_FEED_PATH}."]


def _search_public_feed(search: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str], int]:
    warnings: list[str] = []
    results: list[dict[str, Any]] = []
    queries = _build_public_queries(search)
    for query in queries:
        try:
            url = _with_query(PUBLIC_AWARD_FEED_URL, query)
            payload = _fetch_json(url)
            found_at = _now()
            for item in _extract_items(payload):
                result = _normalize_award(
                    item,
                    LOCAL_FIELD_MAP,
                    "public-award-feed",
                    "public_json",
                    found_at,
                    default_origin=query.get("origin"),
                    default_destination=query.get("destination"),
                    default_date=query.get("date") or query.get("startDate"),
                    default_cabin=query.get("cabin") or None,
                    confidence="low",
                )
                if _matches_award_search(result, search):
                    result["warnings"] = [
                        *result.get("warnings", []),
                        "Public JSON feed result. Verify on the loyalty program website before transferring points.",
                    ]
                    results.append(result)
        except Exception as exc:  # noqa: BLE001 - surface feed errors to the MCP caller.
            warnings.append(f"public-award-feed request failed: {exc}")
    if not results and not warnings:
        warnings.append("public-award-feed found no matching results.")
    return results, warnings, len(queries)


def _build_public_queries(search: dict[str, Any]) -> list[dict[str, str]]:
    cabins = search.get("cabins") or [""]
    base_queries = []
    brute = search.get("bruteForce") or {}
    force_one_day = search.get("strategy") == "brute_force" or brute.get("enabled")
    dates = _each_date(search["startDate"], search["endDate"]) if force_one_day else [search["startDate"]]
    max_queries = min(int(brute.get("maxQueries", 2000)), 2000)
    for origin in search["origins"]:
        for destination in search["destinations"]:
            for date in dates:
                for cabin in cabins:
                    query = {
                        "origin": origin,
                        "destination": destination,
                        "date": date,
                        "startDate": date if force_one_day else search["startDate"],
                        "endDate": date if force_one_day else search["endDate"],
                        "cabin": cabin,
                        "passengers": str(search["passengers"]),
                        "programs": ",".join(search.get("programs") or []),
                    }
                    base_queries.append(query)
                    if len(base_queries) >= max_queries:
                        return base_queries
    return base_queries


def _award_search_input(**kwargs: Any) -> dict[str, Any]:
    search = dict(kwargs)
    search["origins"] = [_iata(code) for code in kwargs["origins"]]
    search["destinations"] = [_iata(code) for code in kwargs["destinations"]]
    search["cabins"] = [_normalize_cabin(cabin) for cabin in (kwargs.get("cabins") or [])]
    search["programs"] = [program.strip() for program in (kwargs.get("programs") or []) if program and program.strip()]
    search["passengers"] = max(1, min(9, int(kwargs.get("passengers") or 1)))
    search["maxResults"] = max(1, min(1000, int(kwargs.get("maxResults") or 50)))
    search["bruteForce"] = kwargs.get("bruteForce") or {"enabled": False, "maxQueries": 100, "concurrency": 2, "delayMs": 250}
    search["strategy"] = kwargs.get("strategy") or "auto"
    search["sortBy"] = kwargs.get("sortBy") or "date"
    search["sortDirection"] = kwargs.get("sortDirection") or "asc"
    return search


def _search_from_object(search: dict[str, Any]) -> dict[str, Any]:
    return _search_awards_impl(
        origins=search.get("origins") or _feed_airports("origin")[:25],
        destinations=search.get("destinations") or _feed_airports("destination")[:25],
        startDate=search["startDate"],
        endDate=search["endDate"],
        cabins=search.get("cabins"),
        passengers=search.get("passengers", 1),
        programs=search.get("programs"),
        maxResults=search.get("maxResults", 100),
        includeTrips=search.get("includeTrips", True),
        onlyDirectFlights=search.get("onlyDirectFlights", False),
        strategy=search.get("strategy", "auto"),
        bruteForce=search.get("bruteForce"),
        maxMileageCost=search.get("maxMileageCost"),
        minMileageCost=search.get("minMileageCost"),
        maxTaxes=search.get("maxTaxes"),
        minSeats=search.get("minSeats"),
        maxStops=search.get("maxStops"),
        marketingAirlines=search.get("marketingAirlines"),
        operatingAirlines=search.get("operatingAirlines"),
        aircraft=search.get("aircraft"),
        flightNumbers=search.get("flightNumbers"),
        maxDurationMinutes=search.get("maxDurationMinutes"),
        minPremiumCabinPercent=search.get("minPremiumCabinPercent"),
        minCpp=search.get("minCpp"),
        sortBy=search.get("sortBy", "date"),
        sortDirection=search.get("sortDirection", "asc"),
    )


def _normalize_award(
    raw: Any,
    field_map: dict[str, str],
    source: str,
    source_kind: str,
    found_at: str,
    default_origin: str | None = None,
    default_destination: str | None = None,
    default_date: str | None = None,
    default_cabin: str | None = None,
    confidence: str = "medium",
) -> dict[str, Any]:
    origin = _string(_get_path(raw, field_map.get("origin"))) or default_origin or ""
    destination = _string(_get_path(raw, field_map.get("destination"))) or default_destination or ""
    departs_at = _string(_get_path(raw, field_map.get("departsAt")))
    date = _string(_get_path(raw, field_map.get("date"))) or (departs_at[:10] if departs_at else None) or default_date or ""
    cabin = _string(_get_path(raw, field_map.get("cabin"))) or default_cabin
    flight_numbers = _split_flight_numbers(_string(_get_path(raw, field_map.get("flightNumbers"))))
    result = {
        "id": _string(_get_path(raw, field_map.get("id"))) or _stable_id([source, origin, destination, date, cabin, ",".join(flight_numbers)]),
        "source": source,
        "sourceKind": source_kind,
        "foundAt": found_at,
        "confidence": confidence,
        "program": _string(_get_path(raw, field_map.get("program"))),
        "origin": origin.upper(),
        "destination": destination.upper(),
        "date": date,
        "cabin": _normalize_cabin(cabin) if cabin else None,
        "seats": _optional_number(_get_path(raw, field_map.get("seats"))),
        "mileageCost": _optional_number(_get_path(raw, field_map.get("mileageCost"))),
        "taxes": _optional_number(_get_path(raw, field_map.get("taxes"))),
        "taxesCurrency": _string(_get_path(raw, field_map.get("taxesCurrency"))),
        "cashPrice": _optional_number(_get_path(raw, field_map.get("cashPrice"))),
        "cashCurrency": _string(_get_path(raw, field_map.get("cashCurrency"))),
        "portalPointsCost": _optional_number(_get_path(raw, field_map.get("portalPointsCost"))),
        "centsPerPoint": _optional_number(_get_path(raw, field_map.get("centsPerPoint"))),
        "durationMinutes": _optional_number(_get_path(raw, field_map.get("durationMinutes"))),
        "stops": _optional_number(_get_path(raw, field_map.get("stops"))),
        "premiumCabinPercent": _optional_number(_get_path(raw, field_map.get("premiumCabinPercent"))),
        "marketingAirline": _string(_get_path(raw, field_map.get("marketingAirline"))),
        "operatingAirline": _string(_get_path(raw, field_map.get("operatingAirline"))),
        "flightNumbers": flight_numbers,
        "aircraft": _string(_get_path(raw, field_map.get("aircraft"))),
        "fareClass": _string(_get_path(raw, field_map.get("fareClass"))),
        "bookingUrl": _string(_get_path(raw, field_map.get("bookingUrl"))),
        "rawUrl": _string(_get_path(raw, field_map.get("rawUrl"))),
        "segments": _normalize_segments(_get_path(raw, field_map.get("segments")), cabin),
        "warnings": [],
        "raw": raw,
    }
    return _compact_dict(result)


def _normalize_segments(value: Any, fallback_cabin: str | None) -> list[dict[str, Any]]:
    segments = value if isinstance(value, list) else []
    normalized = []
    for segment in segments:
        normalized.append(
            _compact_dict(
                {
                    "origin": _string(segment.get("origin") or segment.get("OriginAirport") or segment.get("Origin")),
                    "destination": _string(segment.get("destination") or segment.get("DestinationAirport") or segment.get("Destination")),
                    "marketingAirline": _string(segment.get("marketingAirline") or segment.get("MarketingAirline") or segment.get("Carrier")),
                    "operatingAirline": _string(segment.get("operatingAirline") or segment.get("OperatingAirline")),
                    "flightNumber": _string(segment.get("flightNumber") or segment.get("FlightNumber") or segment.get("flightNumbers")),
                    "aircraft": _string(segment.get("aircraft") or segment.get("Aircraft")),
                    "cabin": _string(segment.get("cabin") or segment.get("Cabin") or fallback_cabin),
                    "departsAt": _string(segment.get("departsAt") or segment.get("departure") or segment.get("DepartsAt")),
                    "arrivesAt": _string(segment.get("arrivesAt") or segment.get("arrival") or segment.get("ArrivesAt")),
                    "durationMinutes": _optional_number(segment.get("durationMinutes") or segment.get("duration_minutes") or segment.get("Duration")),
                    "fareClass": _string(segment.get("fareClass") or segment.get("fare_class") or segment.get("BookingClass")),
                }
            )
        )
    return normalized


def _matches_award_search(result: dict[str, Any], search: dict[str, Any]) -> bool:
    if result.get("origin", "").upper() not in search["origins"]:
        return False
    if result.get("destination", "").upper() not in search["destinations"]:
        return False
    if result.get("date", "") < search["startDate"] or result.get("date", "") > search["endDate"]:
        return False
    if search.get("cabins") and (result.get("cabin") or "").lower() not in search["cabins"]:
        return False
    if search.get("programs") and not any(_includes(result.get("program"), program) for program in search["programs"]):
        return False
    if result.get("seats") is not None and _number(result.get("seats"), 0) < search["passengers"]:
        return False
    return True


def _matches_award_filters(result: dict[str, Any], search: dict[str, Any]) -> bool:
    checks = [
        ("maxMileageCost", "mileageCost", lambda left, right: left <= right),
        ("minMileageCost", "mileageCost", lambda left, right: left >= right),
        ("maxTaxes", "taxes", lambda left, right: left <= right),
        ("minSeats", "seats", lambda left, right: left >= right),
        ("maxStops", "stops", lambda left, right: left <= right),
        ("maxDurationMinutes", "durationMinutes", lambda left, right: left <= right),
        ("minPremiumCabinPercent", "premiumCabinPercent", lambda left, right: left >= right),
        ("minCpp", "centsPerPoint", lambda left, right: (_result_cpp(result) or 0) >= right),
    ]
    for input_key, result_key, comparator in checks:
        expected = search.get(input_key)
        if expected is None:
            continue
        actual = _number(result.get(result_key), None)
        if actual is None and input_key != "minCpp":
            return False
        if not comparator(actual or 0, expected):
            return False
    list_checks = [
        ("marketingAirlines", "marketingAirline"),
        ("operatingAirlines", "operatingAirline"),
        ("aircraft", "aircraft"),
    ]
    for input_key, result_key in list_checks:
        needles = search.get(input_key) or []
        if needles and not any(_includes(result.get(result_key), item) for item in needles):
            return False
    flight_numbers = search.get("flightNumbers") or []
    if flight_numbers and not any(_same(candidate, item) for candidate in result.get("flightNumbers", []) for item in flight_numbers):
        return False
    return True


def _record_history(results: list[dict[str, Any]]) -> None:
    if not results:
        return
    history = _read_store_list(AWARD_HISTORY_PATH)
    now = _now()
    by_key = {_result_key(entry.get("result", {})): entry for entry in history}
    for result in results:
        by_key[_result_key(result)] = {"observedAt": now, "result": result}
    next_history = sorted(by_key.values(), key=lambda entry: entry.get("observedAt", ""), reverse=True)[:5000]
    _write_json(AWARD_HISTORY_PATH, next_history)


def _build_round_trips(
    outbound: list[dict[str, Any]],
    inbound: list[dict[str, Any]],
    min_stay_days: int | None,
    max_stay_days: int | None,
    max_results: int,
) -> list[dict[str, Any]]:
    itineraries = []
    for out in outbound:
        for ret in inbound:
            stay = _days_between(out["date"], ret["date"])
            if stay < 0:
                continue
            if min_stay_days is not None and stay < min_stay_days:
                continue
            if max_stay_days is not None and stay > max_stay_days:
                continue
            itineraries.append(_itinerary("round_trip", [out, ret], {"stayDays": stay}))
    return sorted(itineraries, key=lambda item: (item.get("totalMileageCost") or 10**12, item.get("totalTaxes") or 10**12))[:max_results]


def _build_multi_city(legs: list[list[dict[str, Any]]], max_results: int) -> list[dict[str, Any]]:
    if not legs or any(not leg for leg in legs):
        return []
    itineraries = [[]]
    for leg_results in legs:
        itineraries = [itinerary + [result] for itinerary in itineraries for result in leg_results]
        itineraries = itineraries[:max_results * 5]
    return [_itinerary("multi_city", itinerary) for itinerary in itineraries[:max_results]]


def _itinerary(kind: str, legs: list[dict[str, Any]], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    mileage = [_number(leg.get("mileageCost")) for leg in legs if leg.get("mileageCost") is not None]
    taxes = [_number(leg.get("taxes")) for leg in legs if leg.get("taxes") is not None]
    durations = [_number(leg.get("durationMinutes")) for leg in legs if leg.get("durationMinutes") is not None]
    stops = [_number(leg.get("stops")) for leg in legs if leg.get("stops") is not None]
    seats = [_number(leg.get("seats")) for leg in legs if leg.get("seats") is not None]
    item = {
        "id": _stable_id([kind, *[leg.get("id") for leg in legs]]),
        "type": kind,
        "legs": legs,
        "totalMileageCost": sum(mileage) if mileage else None,
        "totalTaxes": sum(taxes) if taxes else None,
        "taxesCurrency": next((leg.get("taxesCurrency") for leg in legs if leg.get("taxesCurrency")), None),
        "totalDurationMinutes": sum(durations) if durations else None,
        "totalStops": sum(stops) if stops else None,
        "minSeats": min(seats) if seats else None,
        "programs": sorted({leg.get("program") for leg in legs if leg.get("program")}),
        "warnings": sorted({warning for leg in legs for warning in leg.get("warnings", [])}),
    }
    if extra:
        item.update(extra)
    return item


def _build_calendar(results: list[dict[str, Any]], group_by: list[str]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        values = [_bucket_value(result, field) for field in group_by]
        buckets.setdefault("|".join(values), []).append(result)
    calendar = []
    for key, bucket in buckets.items():
        mileage = [_number(item.get("mileageCost")) for item in bucket if item.get("mileageCost") is not None]
        taxes = [_number(item.get("taxes")) for item in bucket if item.get("taxes") is not None]
        seats = [_number(item.get("seats")) for item in bucket if item.get("seats") is not None]
        best = sorted(bucket, key=lambda item: (item.get("mileageCost") or 10**12, item.get("taxes") or 10**12))[0]
        calendar.append(
            {
                "key": key,
                "group": dict(zip(group_by, key.split("|"), strict=False)),
                "resultCount": len(bucket),
                "cheapestMileageCost": min(mileage) if mileage else None,
                "lowestTaxes": min(taxes) if taxes else None,
                "maxSeats": max(seats) if seats else None,
                "bestResultId": best.get("id"),
                "resultIds": [item.get("id") for item in bucket],
            }
        )
    return sorted(calendar, key=lambda item: item["key"])


def _summarize_deals(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    ranked = sorted(results, key=_deal_score, reverse=True)[:limit]
    return [
        {
            "id": result.get("id"),
            "route": f"{result.get('origin')}-{result.get('destination')}",
            "date": result.get("date"),
            "program": result.get("program"),
            "cabin": result.get("cabin"),
            "mileageCost": result.get("mileageCost"),
            "taxes": result.get("taxes"),
            "seats": result.get("seats"),
            "centsPerPoint": _result_cpp(result),
            "score": _deal_score(result),
            "bookingUrl": result.get("bookingUrl"),
            "warnings": result.get("warnings", []),
        }
        for result in ranked
    ]


def _deal_filter(result: dict[str, Any], min_cpp: float | None, max_mileage: int | None, max_taxes: float | None) -> bool:
    if max_mileage is not None and _number(result.get("mileageCost"), 10**12) > max_mileage:
        return False
    if max_taxes is not None and _number(result.get("taxes"), 10**12) > max_taxes:
        return False
    if min_cpp is not None and (_result_cpp(result) or 0) < min_cpp:
        return False
    return True


def _deal_score(result: dict[str, Any]) -> float:
    cpp = _result_cpp(result) or 0
    seat_boost = min(_number(result.get("seats"), 1), 4) * 0.1
    cabin_boost = {"first": 0.6, "business": 0.4, "premium": 0.2}.get(str(result.get("cabin")), 0)
    tax_penalty = _number(result.get("taxes"), 0) / 1000
    return cpp + seat_boost + cabin_boost - tax_penalty


def _with_cpp(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("centsPerPoint") is None:
        result = dict(result)
        result["centsPerPoint"] = _result_cpp(result)
    return result


def _result_cpp(result: dict[str, Any]) -> float | None:
    if result.get("centsPerPoint") is not None:
        return _number(result.get("centsPerPoint"))
    if not result.get("cashPrice") or not result.get("mileageCost"):
        return None
    return (max(0, _number(result.get("cashPrice")) - _number(result.get("taxes"), 0)) / _number(result.get("mileageCost"))) * 100


def _create_alert(path: Path, name: str, search: dict[str, Any], enabled: bool) -> dict[str, Any]:
    now = _now()
    alert = {"id": str(uuid.uuid4()), "name": name, "enabled": enabled, "search": search, "createdAt": now, "updatedAt": now}
    alerts = _read_store_list(path)
    alerts.append(alert)
    _write_json(path, alerts)
    return alert


def _upsert_alert(path: Path, alert: dict[str, Any]) -> None:
    alerts = [item for item in _read_store_list(path) if item.get("id") != alert.get("id")]
    alerts.append(alert)
    _write_json(path, alerts)


def _list_alerts(path: Path, enabled_only: bool) -> list[dict[str, Any]]:
    alerts = _read_store_list(path)
    return [alert for alert in alerts if not enabled_only or alert.get("enabled", True)]


def _delete_alert(path: Path, id: str) -> dict[str, Any]:
    alerts = _read_store_list(path)
    next_alerts = [alert for alert in alerts if alert.get("id") != id]
    _write_json(path, next_alerts)
    return {"deleted": len(next_alerts) != len(alerts), "id": id}


def _select_alerts(path: Path, ids: list[str] | None, enabled_only: bool, max_alerts: int) -> list[dict[str, Any]]:
    return [
        alert
        for alert in _list_alerts(path, enabled_only)
        if not ids or alert.get("id") in ids
    ][:max_alerts]


def _mark_alert_run(path: Path, id: str, match_count: int) -> dict[str, Any] | None:
    alerts = _read_store_list(path)
    updated = None
    for alert in alerts:
        if alert.get("id") == id:
            alert["lastRunAt"] = _now()
            alert["lastMatchCount"] = match_count
            alert["updatedAt"] = _now()
            updated = alert
    _write_json(path, alerts)
    return updated


def _filter_alert_matches(alert: dict[str, Any], results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches = []
    for result in results:
        if alert.get("maxMileageCost") is not None and _number(result.get("mileageCost"), 10**12) > alert["maxMileageCost"]:
            continue
        if alert.get("maxTaxes") is not None and _number(result.get("taxes"), 10**12) > alert["maxTaxes"]:
            continue
        if alert.get("minSeats") is not None and _number(result.get("seats"), 0) < alert["minSeats"]:
            continue
        matches.append(result)
    return matches


def _history_match(
    result: dict[str, Any],
    origin: str | None,
    destination: str | None,
    start_date: str | None,
    end_date: str | None,
    program: str | None,
    cabin: str | None,
) -> bool:
    if origin and not _same(result.get("origin"), origin):
        return False
    if destination and not _same(result.get("destination"), destination):
        return False
    if start_date and result.get("date", "") < start_date:
        return False
    if end_date and result.get("date", "") > end_date:
        return False
    if program and not _includes(result.get("program"), program):
        return False
    if cabin and not _same(result.get("cabin"), cabin):
        return False
    return True


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        if not path.exists():
            return fallback
        try:
            with _file_lock(path, shared=True):
                return json.loads(path.read_text(encoding="utf-8"))
        except OSError:
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _read_store_list(path: Path) -> list[dict[str, Any]]:
    value = _read_json(path, [])
    return value if isinstance(value, list) else []


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _file_lock(path, shared=False):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temp_name = handle.name
        os.replace(temp_name, path)


@contextlib.contextmanager
def _file_lock(path: Path, shared: bool) -> Any:
    if fcntl is None:
        yield
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    with lock_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_SH if shared else fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "award-flights-mcp-horizon/0.1"})
    with urllib.request.urlopen(request, timeout=12) as response:  # noqa: S310 - URL is configured by the server owner.
        return json.loads(response.read().decode("utf-8"))


def _with_query(url: str, query: dict[str, str]) -> str:
    parsed = urllib.parse.urlparse(url)
    params = dict(urllib.parse.parse_qsl(parsed.query))
    params.update({key: value for key, value in query.items() if value is not None})
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(params)))


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ["data", "results", "Results", "availability", "Availability", "items"]:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _get_path(value: Any, path: str | None) -> Any:
    if not path:
        return None
    cursor = value
    for part in path.split("."):
        if isinstance(cursor, dict):
            cursor = cursor.get(part)
        else:
            return None
    return cursor


def _feed_airports(field: str) -> list[str]:
    codes = set()
    for item in _extract_items(_read_json(LOCAL_AWARD_FEED_PATH, {})):
        value = _string(item.get(field))
        if value:
            codes.add(value.upper())
    return sorted(codes)


def _region_airports(region: str | None) -> list[str]:
    if not region:
        return []
    regions = {
        "north_america": ["ATL", "BOS", "DFW", "EWR", "IAD", "JFK", "LAX", "MIA", "ORD", "SFO", "SEA", "YYZ"],
        "europe": ["AMS", "CDG", "FCO", "FRA", "LHR", "MAD", "MUC", "VIE", "ZRH"],
        "asia": ["BKK", "HKG", "HND", "ICN", "NRT", "SIN", "TPE"],
        "middle_east": ["AUH", "DOH", "DXB"],
        "oceania": ["AKL", "MEL", "SYD"],
    }
    key = _normalized(region)
    return regions.get(key, [])


def _sort_awards(results: list[dict[str, Any]], sort_by: str, direction: str) -> list[dict[str, Any]]:
    key_map = {
        "date": "date",
        "mileage": "mileageCost",
        "taxes": "taxes",
        "duration": "durationMinutes",
        "stops": "stops",
        "seats": "seats",
        "cpp": "centsPerPoint",
        "found_at": "foundAt",
    }
    return _sort_dicts(results, key_map.get(sort_by, "date"), direction)


def _sort_dicts(items: list[dict[str, Any]], key: str, direction: str) -> list[dict[str, Any]]:
    reverse = direction == "desc"
    return sorted(items, key=lambda item: (item.get(key) is None, item.get(key)), reverse=reverse)


def _dedupe_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for result in results:
        deduped[_result_key(result)] = result
    return list(deduped.values())


def _result_key(result: dict[str, Any]) -> str:
    return "|".join(
        str(result.get(key, ""))
        for key in ["source", "origin", "destination", "date", "program", "cabin", "mileageCost", "taxes", "flightNumbers"]
    )


def _source_skip(source_id: str, message: str, health: str = "ready") -> dict[str, Any]:
    source_kind = "partner_api" if source_id == "award-flight-daily" else "public_json" if source_id == "public-award-feed" else "manual"
    return {
        "id": source_id,
        "name": source_id.replace("-", " ").title(),
        "kind": source_kind,
        "health": health,
        "message": message,
        "supportsLive": False,
        "supportsCached": True,
        "supportsBatch": source_id == "local-award-feed",
        "supportsExplore": source_id != "award-flight-daily",
    }


def _active_on(bonus: dict[str, Any], date: str) -> bool:
    return (not bonus.get("startDate") or bonus["startDate"] <= date) and (not bonus.get("endDate") or bonus["endDate"] >= date)


def _assert_date_window(start: str, end: str) -> None:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", start or "") or not re.match(r"^\d{4}-\d{2}-\d{2}$", end or ""):
        raise ValueError("Dates must be in YYYY-MM-DD format.")
    if start > end:
        raise ValueError("startDate must be on or before endDate.")


def _each_date(start: str, end: str) -> list[str]:
    _assert_date_window(start, end)
    cursor = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    dates = []
    while cursor <= last:
        dates.append(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return dates


def _days_between(start: str, end: str) -> int:
    return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days


def _bucket_value(result: dict[str, Any], field: str) -> str:
    if field == "program":
        return str(result.get("program") or "unknown")
    if field == "cabin":
        return str(result.get("cabin") or "unknown")
    return str(result.get(field) or "unknown")


def _iata(code: str) -> str:
    value = (code or "").strip().upper()
    if not re.match(r"^[A-Z]{3}$", value):
        raise ValueError(f"Invalid IATA airport code: {code}")
    return value


def _normalize_cabin(cabin: str | None) -> str:
    value = (cabin or "").strip().lower().replace("_", " ")
    aliases = {"premium economy": "premium", "premium_economy": "premium", "j": "business", "f": "first", "y": "economy", "w": "premium"}
    normalized = aliases.get(value, value)
    if normalized not in {"economy", "premium", "business", "first"}:
        raise ValueError(f"Invalid cabin: {cabin}")
    return normalized


def _split_flight_numbers(value: str | None) -> list[str]:
    return [part.strip() for part in re.split(r"[,\s]+", value or "") if part.strip()]


def _compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _optional_number(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    return _number(value)


def _number(value: Any, fallback: Any = 0) -> Any:
    if isinstance(value, (int, float)):
        return value
    try:
        parsed = float(str(value).replace(",", ""))
        return int(parsed) if parsed.is_integer() else parsed
    except Exception:
        return fallback


def _includes(value: Any, needle: str | None) -> bool:
    if needle is None:
        return True
    return _normalized(str(needle)) in _normalized(str(value or ""))


def _same(left: Any, right: Any) -> bool:
    return _normalized(str(left or "")) == _normalized(str(right or ""))


def _normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _stable_id(parts: list[Any]) -> str:
    text = "|".join(str(part) for part in parts if part not in {None, ""})
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:20] if text else str(uuid.uuid4())


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    mcp.run()
