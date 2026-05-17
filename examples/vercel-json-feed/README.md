# Award Flights JSON Feed on Vercel

Yes, this feed can be hosted on Vercel. Deploy this folder as its own Vercel project, then point `PUBLIC_JSON_ADAPTER_CONFIG` in the MCP server at the deployed `/api/awards` URL.

The feed is not limited to the checked-in JSON file. On each route/date request it first attempts a no-credential Award Flight Daily MCP search, then merges those results with `data/awards.json` as a fallback. If the upstream free tier is capped, the response includes a warning instead of silently pretending the route has no data.

## Run Locally

```bash
npm install
npm run dev
```

Local endpoint:

```text
http://localhost:3000/api/awards?origin=JFK&destination=LHR&date=2026-06-10&cabin=business
```

## Deploy

```bash
npm install
npm run deploy
```

Or import this folder in the Vercel dashboard.

## MCP Adapter Config

After deploy, copy `../../config/public-json-adapters.vercel.example.json`, replace `https://your-award-feed.vercel.app/api/awards` with your deployment URL, and set:

```bash
PUBLIC_JSON_ADAPTER_CONFIG=./config/public-json-adapters.vercel.example.json
```

The feed reads `data/awards.json`. You can update that file manually, from a scheduled job, or from another authorized data source.

## Live Source Settings

Optional Vercel environment variables:

```bash
AWARD_FLIGHT_DAILY_ENABLED=true
AWARD_FLIGHT_DAILY_MCP_URL=https://awardflightdaily.com/mcp-server/mcp
AWARD_FLIGHT_DAILY_API_KEY=
```

Leave `AWARD_FLIGHT_DAILY_API_KEY` empty for the no-key tier. Set it only if you have your own key.
