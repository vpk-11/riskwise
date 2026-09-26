# RiskWise
<!-- version: v1.1.0 -->
![Version](https://img.shields.io/badge/version-v1.1.0-blue)

Maritime supply chain intelligence platform. Evaluate shipping routes for geopolitical, weather, labor, and congestion risk using a multi-agent AI pipeline. Get risk scores, narratives, alternative routes, and a live disruption feed.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Tailwind CSS 4, Wouter, shadcn/ui |
| Backend | Node.js, Express 4, tRPC 11, Drizzle ORM |
| Database | PostgreSQL |
| AI | LiteLLM gateway (Ollama locally, remote providers through one interface) |
| Auth | JWT via jose, cookie-based sessions |
| Logging | Pino (structured JSON) |
| Scheduling | node-cron (hourly Athena background scan) |

---

## Architecture

Three agents collaborate on every route evaluation:

- **Athena** - researcher. Fetches live intelligence from GDELT RSS, NASA EONET, USGS. Runs hourly background scan to populate the disruption feed.
- **Hermes** - risk modeler. Scores weather, geopolitical, labor, and congestion risk on a 0-100 scale, with per-factor breakdown.
- **Apollo** - route optimizer. Suggests alternative routes when overall risk is high.

Risk thresholds: Green (0-30), Amber (31-60), Red (61-100). Critical alerts (score > 75) fire a console log and optional webhook.

---

## Running Locally

### Prerequisites

- Node.js 20+
- pnpm
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
JWT_SECRET=your-secret-minimum-32-characters-long

# LLM config (defaults to Ollama + Mistral via LiteLLM)
RISKWISE_LLM_BASE_URL=http://localhost:11434/v1
RISKWISE_LLM_API_KEY=ollama
RISKWISE_LLM_MODEL=mistral

# Optional
RISKWISE_ALERT_WEBHOOK_URL=
```

### Database

```bash
pnpm db:push
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
pnpm test       # vitest (17 tests)
pnpm check      # TypeScript type check
pnpm format     # Prettier
pnpm db:push    # generate + apply DB migrations
```

---

## Project Structure

```
client/src/
  pages/          RouteAnalyzer, ActiveDisruptions, RouteHistory, MapView
  components/     reusable UI + shadcn/ui primitives
  contexts/       ThemeContext, RouteMapContext
  hooks/          custom hooks
  lib/trpc.ts     tRPC client binding
  App.tsx         routing
  index.css       global styles, Tailwind config, cyberpunk tokens

server/
  agents.ts             Athena / Hermes / Apollo orchestration
  db.ts                 Drizzle query helpers
  realtime.ts           live data fetchers (GDELT, NASA EONET, USGS)
  scheduledHandlers.ts  hourly Athena scan via node-cron
  routers.ts            tRPC router assembly
  routers/riskwise.ts   route eval, rerun, history, disruptions, auth procedures
  _core/
    index.ts        Express app, middleware, request ID, cron, Vite middleware
    context.ts      tRPC context + JWT resolution
    env.ts          Zod-validated env config (fails fast on missing vars)
    llm.ts          LiteLLM-backed LLM client with OpenAI-compatible surface
    logger.ts       Pino instance
    notification.ts console + optional webhook alerts
    errors.ts       typed HTTP error classes

shared/
  const.ts          cookie name, shared constants
  types.ts          re-exports DB types + error classes
  _core/errors.ts   HttpError base class

drizzle/
  schema.ts         PostgreSQL schema (users, risk_events, shipping_routes, route_evaluations)
  0000_init.sql     initial migration
```

---

## Tests

17 tests in `server/riskwise.test.ts` covering:
- Risk score color thresholds (Green/Amber/Red boundaries)
- tRPC router procedures: events, routes, auth
- Athena scan result validation (category/severity enums)
- Critical notification threshold (score > 75)

---

*RiskWise was initially ideated and bootstrapped using [Manus AI](https://manus.im) for the Manus AI Hackathon at Boston Tech Week 2026.*

## Changelog
- **v1.1.0** (2026-09-26): minor bump

