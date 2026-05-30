# RiskWise TODO

## Database & Schema
- [x] Add risk_events, shipping_routes, route_evaluations tables to drizzle/schema.ts
- [x] Generate and apply migration SQL
- [x] Seed mock disruption data (12 risk events, 5 routes)
- [x] Add heartbeat_jobs table for cron job tracking

## Backend – tRPC Routers & Agents
- [x] Multi-agent orchestration: Athena (researcher), Hermes (risk modeler), Apollo (route optimizer)
- [x] Route evaluation engine: POST /trpc/routes.evaluate
- [x] Active disruptions feed: GET /trpc/events.active (with category/severity filters)
- [x] Route history: GET /trpc/routes.history
- [x] Re-run route evaluation from history
- [x] All shipping routes: GET /trpc/routes.allRoutes
- [x] Critical risk alert: notify owner when risk score > 75
- [x] Hourly background job (Heartbeat): Athena scans for new disruptions (taskUid=cso5ohwDST22x6t7XSyaw5)

## Frontend – Global Theme & Layout
- [x] Dark cyberpunk theme in index.css (neon accents, monospace fonts, OKLCH colors)
- [x] RiskWiseLayout sidebar: Map View, Route Analyzer, Active Disruptions, History
- [x] App.tsx routing for all four sections
- [x] Cyber card component, glow effects, neon pulse animations

## Frontend – Map View
- [x] Google Maps integration with dark map styles
- [x] Color-coded shipping routes (Green 0-30, Amber 31-60, Red 61-100)
- [x] Glow markers for active disruption zones with InfoWindow popups
- [x] Route overlays from evaluation results
- [x] Layer controls (toggle routes/disruptions)
- [x] Risk legend panel
- [x] Schematic fallback view when Google Maps fails to load

## Frontend – Query Terminal
- [x] Terminal-style natural language input with monospace font
- [x] Real-time agent activity indicators (ATHENA, HERMES, APOLLO, SYSTEM)
- [x] Agent log with working/done/error states and cursor blink
- [x] Example query suggestions

## Frontend – Route Analyzer
- [x] Origin/destination port input form
- [x] Risk Metrics Panel: Overall Risk Score (animated ring), Transit Time Delta, primary risk factor, cost impact
- [x] Risk Breakdown bars (weather, labor, geopolitical, congestion)
- [x] Intelligence Narrative section
- [x] Apollo Alternative Routes comparison panel

## Frontend – Active Disruptions Feed
- [x] List of risk events with category badges and severity indicators
- [x] Filter by category (Weather, Strike, Geopolitical, Port Congestion)
- [x] Filter by severity (Low, Medium, High, Critical)
- [x] Summary stats cards (total, critical, high counts)
- [x] Auto-refresh every 60 seconds

## Frontend – Route History
- [x] Table of past evaluations with risk scores and timestamps
- [x] Quick re-run button per entry
- [x] Risk score color badges
- [x] Inline re-run results display

## Tests
- [x] Vitest: risk score color threshold tests (Green/Amber/Red boundaries)
- [x] Vitest: critical notification threshold (strictly > 75)
- [x] Vitest: events.active procedure (no filter, category filter, severity filter)
- [x] Vitest: routes.history procedure (default limit, custom limit)
- [x] Vitest: routes.allRoutes procedure
- [x] Vitest: Athena scan result schema validation
- [x] Vitest: auth.logout (from template)
- [x] All 17 tests passing

## Deployment Prep
- [x] Register hourly heartbeat job on server startup (idempotent)
- [x] Save checkpoint

## UI Fixes (Round 2)
- [x] Fix map contrast — use a lighter dark map style so geography is clearly visible post-publish
- [x] Fix dark-mode info windows — white box/invisible close button on disruption/route markers
- [x] Add loading indicators — show users when services/agents are loading
- [x] Alternate route visualization — clicking an alternate route in Route Analyzer shows it on the map with color coding
