# Award Flights MCP

MCP server for award flight search. It is built around pluggable data adapters so the MCP tools can stay stable while sources evolve.

The server is Docker-ready and supports:

- MCP over stdio for local clients
- MCP over Streamable HTTP at `/mcp` for container deployments
- Credential-free award searches from a bundled local JSON feed
- Award Flight Daily remote MCP searches, including its no-key free tier when available
- Cached Seats.aero partner API searches when `SEATS_AERO_API_KEY` is configured
- Cached Aerobase award searches when `AEROBASE_API_KEY` is configured, with no Seats.aero key required
- Award Travel Finder REST searches when `AWARD_TRAVEL_FINDER_API_KEY` is configured
- Apify Flight Award Scraper runs when `APIFY_API_TOKEN` is configured
- Controlled route/date brute-force enumeration with query caps, concurrency limits, delay, and cache
- Public JSON adapter config for your own Vercel-hosted feed or other lawful/documented endpoints
- Flexible filters, calendars, round-trip and multi-city assembly, alerts, local deal digests, transfer-partner metadata, booking plans, wallets, history, hotel feeds, seat maps, and fare-class feeds

## Why Adapter-Based?

Award availability data is fragmented. Some products use live loyalty-program searches, some use cached scans, some use user-search-derived discovery data, and some use partner/commercial API access. There is no universal official free API for award inventory.

This project keeps that mess behind adapters:

- `local-award-feed`: reads `config/sample-awards.json` by default. This is the credential-free baseline and can be replaced with a JSON feed you own.
- `award-flight-daily`: calls the remote Award Flight Daily MCP server. It supports a limited no-key tier per their docs and can also use `AWARD_FLIGHT_DAILY_API_KEY`.
- `seats-aero`: uses documented Seats.aero cached API endpoints, disabled until `SEATS_AERO_API_KEY` is set.
- `aerobase-awards`: uses Aerobase's documented awards endpoint, disabled until `AEROBASE_API_KEY` is set.
- `award-travel-finder`: uses Award Travel Finder's REST JSON endpoints, disabled until `AWARD_TRAVEL_FINDER_API_KEY` is set.
- `apify-flight-award-scraper`: runs the Apify actor and reads returned dataset JSON, disabled until `APIFY_API_TOKEN` is set.
- `public_json`: a configurable plain HTTP JSON adapter for endpoints you are authorized to call.
- More adapters can be added under `src/adapters`.

Fresh clones do not need any credentials. Optional credentialed adapters stay disabled until a key is supplied or an `*_ENABLED=true` flag is set.

## Tools

- `search_awards`: Search award leads by route, date range, cabin, passenger count, and program.
- `refresh_route`: Re-run a route/date search immediately.
- `explore_awards`: Broad cached/discovery search where adapters support it.
- `verify_award`: Re-run a narrow search for a specific lead.
- `search_round_trip_awards`: Search outbound and inbound legs and combine compatible round-trip itineraries.
- `search_multi_city_awards`: Search several ordered legs and combine multi-city candidates.
- `calendar_awards`: Group search results by date/program/cabin/origin/destination.
- `search_deals`: Rank award leads from an explore search or local history.
- `generate_deal_digest`: Return a deal digest from explore results or local history.
- `create_alert`: Save a route/date/cabin watch.
- `list_alerts`: List saved watches.
- `delete_alert`: Delete a saved watch.
- `run_alerts`: Execute saved watches and return current matches.
- `search_hotels`: Search a configured hotel award feed.
- `create_hotel_alert`, `list_hotel_alerts`, `delete_hotel_alert`, `run_hotel_alerts`: Hotel award watches.
- `get_seat_map`: Return configured seat-map data for a flight.
- `get_fare_classes`: Return configured fare-class or award-bucket data for a flight.
- `get_price_history`: Return locally observed historical award results.
- `get_route_stats`: Summarize locally observed route history.
- `source_status`: Show adapter health and cache stats.
- `get_transfer_partners`: Return built-in US transferable-currency partners.
- `get_transfer_bonuses`: Return configured transfer bonus data.
- `get_booking_links`: Return booking links and confirmation steps.
- `build_booking_plan`: Build transfer and booking instructions for a selected award lead.
- `compare_cash_points`: Calculate cents-per-point and portal-vs-transfer recommendation.
- `upsert_points_balance`, `list_points_balances`, `delete_points_balance`: Maintain a local points wallet.

Search and explore tools support filters for max mileage, taxes, minimum seats, max stops, airlines, aircraft, flight number, max duration, minimum premium-cabin percentage, minimum cents-per-point, and sorting.

## Brute Force Search

`search_awards` supports controlled brute force:

```json
{
  "origins": ["JFK", "EWR"],
  "destinations": ["LHR"],
  "startDate": "2026-06-01",
  "endDate": "2026-06-07",
  "cabins": ["business"],
  "passengers": 1,
  "strategy": "brute_force",
  "bruteForce": {
    "enabled": true,
    "maxQueries": 100,
    "concurrency": 2,
    "delayMs": 500
  }
}
```

This means one adapter query per origin/destination/date where needed. The server will refuse searches above `AWARD_MAX_BRUTE_FORCE_QUERIES`.

This implementation does not include captcha bypassing, login misuse, credential sharing, anti-blocking evasion, or rate-limit circumvention.

## Local Setup

```bash
npm install
npm run build
npm test
```

Run over stdio:

```bash
MCP_TRANSPORT=stdio npm start
```

Run over HTTP:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 npm start
```

Health check:

```bash
curl http://localhost:3000/healthz
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

HTTP endpoint:

```text
http://localhost:3000/mcp
```

## Prefect Horizon

Horizon Deploy expects a Python FastMCP server object. This repo includes a Horizon-compatible entrypoint in `horizon_server.py` that runs without credentials and exposes the award-search, planning, transfer-bonus, alert, hotel, seat-map, fare-class, wallet, and history tools from JSON feeds.

Use these values in the Horizon form:

```text
Server name: award-flights-mcp
Entrypoint: horizon_server.py:mcp
Description: Credential-free award flight search MCP server with public JSON feeds, transfer bonuses, alerts, and award planning tools.
```

Horizon will install Python dependencies from `requirements.txt`. The deployed MCP endpoint will be:

```text
https://award-flights-mcp.fastmcp.app/mcp
```

The Node/TypeScript server entrypoint is still `dist/index.js` after `npm run build`; Docker runs `node dist/index.js`. Use the Python entrypoint only for Horizon's `server.py:mcp` style deployment flow.

## Configuration

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | `3000` | HTTP port |
| `LOCAL_AWARD_FEED_ENABLED` | `true` | Enables the credential-free local award JSON feed |
| `LOCAL_AWARD_FEED_PATH` | `./config/sample-awards.json` | Local award feed path |
| `SEATS_AERO_ENABLED` | key-present auto-detect | Enables Seats.aero when a key is present or when explicitly true |
| `SEATS_AERO_API_KEY` | empty | Enables Seats.aero cached search |
| `AEROBASE_ENABLED` | key-present auto-detect | Enables the Aerobase adapter when `AEROBASE_API_KEY` is present |
| `AEROBASE_API_KEY` | empty | Enables Aerobase cached award search without a Seats.aero key |
| `AEROBASE_API_BASE_URL` | `https://aerobase.app/api` | Aerobase API base URL |
| `AWARD_FLIGHT_DAILY_ENABLED` | `true` | Enables the Award Flight Daily remote MCP adapter |
| `AWARD_FLIGHT_DAILY_API_KEY` | empty | Optional Award Flight Daily API key; empty uses their no-key free tier where available |
| `AWARD_FLIGHT_DAILY_MCP_URL` | `https://awardflightdaily.com/mcp-server/mcp` | Award Flight Daily Streamable HTTP MCP URL |
| `AWARD_TRAVEL_FINDER_ENABLED` | key-present auto-detect | Enables the Award Travel Finder REST adapter when its key is present |
| `AWARD_TRAVEL_FINDER_API_KEY` | empty | Enables Award Travel Finder REST JSON searches |
| `AWARD_TRAVEL_FINDER_API_BASE_URL` | `https://awardtravelfinder.com/api/v1` | Award Travel Finder REST base URL |
| `AWARD_TRAVEL_FINDER_AIRLINES` | `british_airways,qatar,cathay_pacific,virgin_atlantic` | Airline slugs to query when `programs` is not provided |
| `APIFY_FLIGHT_AWARD_ENABLED` | key-present auto-detect | Enables the Apify adapter when `APIFY_API_TOKEN` is present |
| `APIFY_API_TOKEN` | empty | Enables Apify Flight Award Scraper searches |
| `APIFY_FLIGHT_AWARD_ACTOR_ID` | `igolaizola/flight-award-scraper` | Apify actor id |
| `APIFY_FLIGHT_AWARD_MAX_ITEMS` | `100` | Max Apify dataset items per search |
| `PUBLIC_JSON_ADAPTER_CONFIG` | empty | Path to public JSON adapter config |
| `AWARD_CACHE_TTL_SECONDS` | `900` | In-memory cache TTL |
| `AWARD_DEFAULT_CONCURRENCY` | `2` | Default adapter concurrency |
| `AWARD_DEFAULT_DELAY_MS` | `250` | Delay between controlled brute-force jobs |
| `AWARD_MAX_BRUTE_FORCE_QUERIES` | `250` | Hard cap on generated route/date queries |
| `AWARD_ALERTS_PATH` | `./data/alerts.json` | File-backed alert store path |
| `AWARD_HISTORY_PATH` | `./data/history.json` | File-backed local result history |
| `AWARD_POINTS_WALLET_PATH` | `./data/points-wallet.json` | File-backed points wallet |
| `HOTEL_RESULTS_PATH` | `./config/hotel-results.example.json` | JSON file with hotel award results |
| `HOTEL_ALERTS_PATH` | `./data/hotel-alerts.json` | File-backed hotel alert store |
| `TRANSFER_BONUSES_PATH` | `./config/transfer-bonuses.json` | JSON file with current transfer bonuses |
| `SEAT_MAPS_PATH` | `./config/seat-maps.example.json` | JSON file with seat-map data |
| `FARE_CLASSES_PATH` | `./config/fare-classes.example.json` | JSON file with fare-class data |

## Public JSON Adapter

See `config/public-json-adapters.example.json`.

The adapter supports:

- GET or POST
- static headers
- query/body templating with `{{origin}}`, `{{destination}}`, `{{date}}`, `{{cabin}}`, `{{passengers}}`, and `{{programs}}`
- simple dot-path result extraction
- simple field mapping into the normalized award result model

Keep adapters pointed only at sources you are authorized to query.

### Host Your Own Feed on Vercel

Yes. See `examples/vercel-json-feed` for a small Vercel serverless JSON feed. It attempts a no-credential Award Flight Daily MCP search on each route/date request, then merges those live/cached leads with the local `data/awards.json` fallback.

Deploy that folder as its own Vercel project, then copy `config/public-json-adapters.vercel.example.json`, replace the `baseUrl` with your deployed `/api/awards` URL, and set:

```bash
PUBLIC_JSON_ADAPTER_CONFIG=./config/public-json-adapters.vercel.example.json
```

This is useful for live no-key lookups, hand-curated leads, data you export from another authorized provider, or a scheduled feed you own. If the upstream free tier is capped, the feed returns a warning so the MCP caller can tell the difference between "no award space" and "source limit reached."

## Optional Local Feeds

Some commercial award tools include hotel awards, seat maps, fare-class buckets, transfer bonuses, historical prices, and points-wallet awareness. This server exposes those workflows without tying them to a paid provider:

- `config/sample-awards.json`
- `config/hotel-results.example.json`
- `config/seat-maps.example.json`
- `config/fare-classes.example.json`
- `config/transfer-bonuses.json`

Point the matching environment variable at a JSON feed you are authorized to use. The committed files are safe demo/current-feed inputs for a no-credential public deployment; replace them with your own maintained feeds for real production use. Searches automatically write observed flight results to `AWARD_HISTORY_PATH`, which powers `get_price_history`, `get_route_stats`, and history-based deal digests.

## Seats.aero Notes

The implementation uses:

- `GET https://seats.aero/partnerapi/search`
- `GET https://seats.aero/partnerapi/availability`

Per Seats.aero's public docs, Pro API access is personal/non-commercial unless you have written commercial permission, and live search is restricted to commercial partners.

## Credential-Free Operation

The server works without Seats.aero, Aerobase, Award Travel Finder, or Apify credentials.

- `local-award-feed` is ready by default and reads `config/sample-awards.json`.
- `award-flight-daily` is enabled by default and uses the no-key remote MCP tier when available.
- Optional credentialed adapters are disabled by default, so a fresh public deployment should not show missing-key warnings.

To use your own award data without credentials, replace `config/sample-awards.json` or point `LOCAL_AWARD_FEED_PATH` at another local JSON file. To host your own feed, deploy `examples/vercel-json-feed` to Vercel and configure `PUBLIC_JSON_ADAPTER_CONFIG`.

If you explicitly set an optional adapter to enabled without its key, `source_status` will show `missing_credentials` for that adapter. That is an opt-in configuration error, not the default state.

## Verification Rule

Treat every result as a lead. Before transferring points:

1. Open the loyalty-program booking site.
2. Search the same route/date/passenger count.
3. Confirm flight number, cabin, points, taxes, and seat count.
4. Only then transfer points or book.
