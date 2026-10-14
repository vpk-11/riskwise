# RiskWise
<!-- version: v1.2.0 -->
![Version](https://img.shields.io/badge/version-v1.2.0-blue)

Maritime supply chain intelligence platform. Evaluate shipping routes for geopolitical, weather, labor, and congestion risk using a multi-agent AI pipeline. Risk scores are computed in code from live events; the LLM writes narratives only. Includes a live disruption feed with source labels.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Tailwind CSS 4, Wouter, shadcn/ui |
| Backend | Node.js, Express 4, tRPC 11, Drizzle ORM |
| Database | PostgreSQL |
| AI | LiteLLM gateway (Ollama locally, remote providers through one interface) |
| Logging | Pino (structured JSON) |
| Scheduling | node-cron (hourly Athena background scan) |

---

## Architecture

Three agents collaborate on every route evaluation:

- **Athena** - researcher. Gathers live events from maritime trade-press RSS (gCaptain, Seatrade Maritime), BBC / Al Jazeera / NYT World RSS, NASA EONET, and USGS, finds those near the route, and summarizes them. A background scan stores the top live event hourly (it never fabricates one).
- **Hermes** - risk modeler. Explains the score in prose. The score itself is computed in `server/scoring.ts`.
- **Apollo** - route advisor, a tool-using agent. When the score is above 50 it explores alternative lanes with two read-only tools: `route_options` (the sea-lane graph with chosen chokepoints blocked, returning computed route, transit days, and risk score) and `nearby_events`. It can only recommend routes the tools returned; the risk score, days, distance, and geometry on every alternative are computed in code, and a pick that is not safer than the direct route is dropped. If the model is down or picks nothing valid, a deterministic ranking of the same candidates is used. Alternatives are drawn on the map as dashed lanes.

**Scoring.** Each event contributes `severity x category weight x proximity`, where proximity falls linearly from 1 on the route to 0 at 1,500 km. Routes follow a graph of sea lanes and chokepoints (not AIS data). Same-category events within 100 km of each other count once, at the strongest report, and contributions combine as a noisy-OR capped at 100. The same events always give the same score. Weights live in `server/scoring.ts`. **Labor and congestion often read 0:** a strike or congestion story scores only if it names a supported port or a known place. Otherwise it appears in the feed as "Location unknown (not scored)" and adds nothing, because it cannot be placed relative to a route.

**Data sources.** gCaptain, Seatrade Maritime, BBC, Al Jazeera, and NYT RSS, NASA EONET, and USGS are live. General news feeds rarely mention shipping, so most RSS events come from the trade press. The country risk table is a static, hand-maintained baseline and is labelled as such. If every live feed is down and no recent live event is stored, evaluation returns an error instead of a score.

Risk thresholds: Green (0-30), Amber (31-60), Red (61-100). Critical alerts (score > 75) fire a console log and optional webhook. Evaluations are rate limited per IP (`RISKWISE_EVAL_LIMIT_PER_HOUR`, default 10). Set `RISKWISE_TRUST_PROXY=1` behind one reverse proxy (the Render blueprint does); it defaults to 0 so a client cannot fake `X-Forwarded-For`.

---

## Running Locally

### Prerequisites

- Node.js 20+
- pnpm 10.4.1 (pinned in `package.json`; run `corepack enable` so a newer global pnpm does not refuse the project)
- PostgreSQL
- [Ollama](https://ollama.ai) for local LLM, or a LiteLLM-backed provider setup

### Install

```bash
pnpm install
```

### Environment

Create `.env` at the project root:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/riskwise

# LLM config (defaults to Ollama + Mistral via LiteLLM)
RISKWISE_LLM_BASE_URL=http://localhost:11434/v1
RISKWISE_LLM_API_KEY=ollama
RISKWISE_LLM_MODEL=mistral

# Optional
RISKWISE_ALERT_WEBHOOK_URL=
RISKWISE_EVAL_LIMIT_PER_HOUR=10   # 0 disables the limit
RISKWISE_TRUST_PROXY=0            # 1 behind a single reverse proxy
```

### Database

```bash
createdb riskwise
pnpm db:migrate   # applies drizzle/*.sql in order, tracked in _migrations
```

### Dev server

```bash
pnpm dev
# http://localhost:3000
```

### LLM options

**Ollama (local, no API key):**
```bash
ollama pull mistral && ollama serve
```

**LiteLLM gateway with OpenAI-compatible upstreams:**
```env
RISKWISE_LLM_BASE_URL=https://api.openai.com/v1
RISKWISE_LLM_API_KEY=sk-...
RISKWISE_LLM_MODEL=gpt-4o
```

The app checks at startup that the configured model exists at the configured endpoint, logs a warning if not, and shows an amber "LLM MODEL MISSING" or "LLM OFFLINE" chip in the sidebar. The Apollo agent needs a model that supports tool calls (tested with `gpt-oss:20b`).

**Anthropic** (via LiteLLM or another OpenAI-compatible gateway):
```env
RISKWISE_LLM_MODEL=claude-sonnet-4-5
```

---

## Commands

```bash
pnpm dev        # start dev server
pnpm build      # production build
pnpm start      # run production build
pnpm test       # vitest
pnpm check      # TypeScript type check
pnpm format     # Prettier
pnpm db:migrate # apply DB migrations
pnpm measure:feeds [runs] [gapMs]   # per-source feed latency and failure rate
```

---

## Project Structure

```
client/src/
  pages/          RouteAnalyzer, ActiveDisruptions, RouteHistory, MapView
  components/     reusable UI + shadcn/ui primitives
  contexts/       ThemeContext
  hooks/          custom hooks
  lib/trpc.ts     tRPC client binding
  App.tsx         routing
  index.css       global styles, Tailwind config, cyberpunk tokens

server/
  scoring.ts            deterministic risk score (pure)
  agents.ts             Athena / Hermes orchestration (LLM writes prose only)
  apollo.ts             Apollo agent: workspace, two tools, bounded loop, deterministic fallback
  promptSafety.ts       sanitizing and fencing of untrusted text for prompts
  realtime.ts           live feed fetchers (RSS, NASA EONET, USGS), 5 minute cache
  rateLimit.ts          per-IP sliding window limiter
  db.ts                 Drizzle query helpers
  scheduledHandlers.ts  hourly scan: stores the top live event
  routers.ts            tRPC router assembly
  routers/riskwise.ts   route eval, rerun, history, disruptions
  _core/
    index.ts        Express app, middleware, request ID, cron, Vite middleware
    env.ts          Zod-validated env config (fails fast on missing vars)
    llm.ts          LiteLLM-backed LLM client with OpenAI-compatible surface
    logger.ts       Pino instance
    notification.ts console + optional webhook alerts

shared/
  ports.ts          supported ports and name resolution
  geo.ts            sea-lane graph, route geometry, distance to route (server scoring and the map)

drizzle/
  schema.ts         PostgreSQL schema (risk_events, shipping_routes, route_evaluations)
  0000_init.sql     initial schema
  0001_*.sql        risk_events.source_type (live | baseline | llm-synthetic)
  0002_*.sql        drops the unused users table (only when it is empty)
  0003_*.sql        risk_events.longitude and latitude (exact source coordinates)

scripts/
  migrate.ts        migration runner (bundled to dist/migrate.js)
  measure-feeds.ts  feed latency and failure measurement

render.yaml         Render blueprint: web service + Postgres
```

---

## Tests

`pnpm test` runs Vitest across scoring (pinned values, clustering of duplicate reports), route geometry and lane coverage against real coastlines, the Apollo agent loop with a scripted LLM, the live-only DB filter and the SQL migrations (both on an in-process Postgres), env handling, prompt safety, the LLM availability check, feed degradation (mocked `fetch`: timeouts, 500s, malformed XML, dedup, 30-event cap, cache), orchestration including the all-feeds-down path, the hourly scan, and routers (port validation, error mapping, rate limit).

## Deploy

`render.yaml` defines a Render web service and a managed Postgres. Set `RISKWISE_LLM_BASE_URL`, `RISKWISE_LLM_API_KEY`, and `RISKWISE_LLM_MODEL` in the dashboard (a hosted OpenAI-compatible endpoint; there is no Ollama on Render). Migrations run on each start.

---

*RiskWise was initially ideated and bootstrapped using [Manus AI](https://manus.im) for the Manus AI Hackathon at Boston Tech Week 2026.*

## Changelog
- **v1.2.0** (2026-09-28): minor bump
- **v1.1.1** (2026-09-26): patch bump
- **v1.1.0** (2026-09-26): minor bump

