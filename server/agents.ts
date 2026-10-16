/**
 * RiskWise Multi-Agent Orchestration
 *
 * The risk score is computed in code (see scoring.ts), never by an LLM.
 *   Athena  – The Researcher: gathers live events, finds those near the route, summarizes them
 *   Hermes  – The Risk Modeler: explains the computed score (narrative only)
 *   Apollo  – The Route Optimizer: suggests alternative corridors in words when score > 50
 *
 * The LLM only writes prose. If it is down, the score and breakdown still return,
 * with a templated narrative.
 */

import { z } from "zod";
import { invokeLLM, type LLMConfig } from "./_core/llm";
import { ENV } from "./_core/env";
import { createLogger, logAgentTelemetry, logRouteEvaluation } from "./_core/logger";
import {
  BASELINE_PROVIDER,
  fetchAllRealTimeIntelligence,
  type DataFetchSummary,
  type LiveRiskEvent,
} from "./realtime";
import { buildRoute, type RouteGeometry } from "@shared/geo";
import { eventsBlock, sanitizeForPrompt, UNTRUSTED_NOTE } from "./promptSafety";
import { runApollo, type AlternativeRoute } from "./apollo";
import {
  scoreRoute,
  transitDays,
  type Category,
  type Driver,
  type Factor,
  type RiskScore,
  type ScorableEvent,
  type Severity,
} from "./scoring";

const REROUTE_THRESHOLD = 50;
const NO_REROUTE = "Route risk is within acceptable parameters. No rerouting required.";

// ── Per-agent LLM configs (fall back to global if not set) ───────────────────

const athenaConfig: LLMConfig = {
  baseUrl: ENV.RISKWISE_ATHENA_LLM_BASE_URL,
  apiKey: ENV.RISKWISE_ATHENA_LLM_API_KEY,
  model: ENV.RISKWISE_ATHENA_LLM_MODEL,
};

const hermesConfig: LLMConfig = {
  baseUrl: ENV.RISKWISE_HERMES_LLM_BASE_URL,
  apiKey: ENV.RISKWISE_HERMES_LLM_API_KEY,
  model: ENV.RISKWISE_HERMES_LLM_MODEL,
};

const apolloConfig: LLMConfig = {
  baseUrl: ENV.RISKWISE_APOLLO_LLM_BASE_URL,
  apiKey: ENV.RISKWISE_APOLLO_LLM_API_KEY,
  model: ENV.RISKWISE_APOLLO_LLM_MODEL,
};

const athenaLog = createLogger("athena");
const hermesLog = createLogger("hermes");
const orchestratorLog = createLogger("orchestrator");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiskBreakdown {
  weather: number;
  labor: number;
  geopolitical: number;
  congestion: number;
}

export interface DbEvent {
  title: string;
  category: Category;
  severity: Severity;
  affectedLocations: string[];
  coordinates?: [number, number];
}

export interface OrchestrationResult {
  overallRiskScore: number;
  primaryRiskFactor: string;
  breakdown: RiskBreakdown;
  baseTransitDays: number;
  riskNarrative: string;
  intelligenceSummary: string;
  /** True when an LLM call failed and templated text stands in for it. The score is unaffected. */
  llmDegraded: boolean;
  dataSources: DataFetchSummary["sources"];
  drivers: Driver[];
  /** Static country-risk entries near the route. Shown as context, never part of the score. */
  baselineContext: Driver[];
  /** Computed on the model sea-lane graph, never produced by the LLM. Empty when none is safer than the direct route. */
  alternativeRoutes: AlternativeRoute[];
  recommendation: string;
  baseRouteWaypoints: [number, number][];
}

/** Thrown when no live source answered and the DB has no recent live events. */
export class NoLiveDataError extends Error {
  constructor() {
    super("No live intelligence available: every live feed failed and no recent live events are stored.");
    this.name = "NoLiveDataError";
  }
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

async function callAgent<T>(opts: {
  agent: "athena" | "hermes";
  config: LLMConfig;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Validates the parsed JSON. A model that ignores the JSON schema throws here and takes the degraded path. */
  validate: z.ZodType<T>;
  route: { origin: string; destination: string };
}): Promise<T> {
  const start = Date.now();
  try {
    const response = await invokeLLM(
      {
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
        },
      },
      opts.config,
    );
    const parsed = opts.validate.parse(JSON.parse(String(response.choices[0]?.message?.content ?? "{}")));
    logAgentTelemetry({
      agent: opts.agent,
      model: response._model,
      latencyMs: response._latencyMs,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      success: true,
      route: opts.route,
    });
    return parsed;
  } catch (err) {
    logAgentTelemetry({
      agent: opts.agent,
      model: opts.config.model ?? ENV.RISKWISE_LLM_MODEL,
      latencyMs: Date.now() - start,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      route: opts.route,
    });
    throw err;
  }
}

const nonEmpty = z.string().trim().min(1);
const athenaOut = z.object({ intelligenceSummary: nonEmpty });
const hermesOut = z.object({ riskNarrative: nonEmpty });

const stringSchema = (key: string) => ({
  type: "object",
  properties: { [key]: { type: "string" } },
  required: [key],
  additionalProperties: false,
});

// ── Agent Athena – The Researcher ─────────────────────────────────────────────

/** `degraded` is true only when an LLM call was attempted and failed; skipping the call for an empty result is not degraded. */
export interface AgentText {
  text: string;
  degraded: boolean;
}

export async function runAthena(
  origin: string,
  destination: string,
  route: RouteGeometry,
  score: RiskScore,
): Promise<AgentText> {
  if (score.drivers.length === 0) {
    return { text: `No live events were found within range of the ${origin} to ${destination} route.`, degraded: false };
  }
  try {
    const { intelligenceSummary } = await callAgent<{ intelligenceSummary: string }>({
      agent: "athena",
      config: athenaConfig,
      system:
        "You are Athena, the logistics intelligence researcher for RiskWise. Summarize the threat landscape for a shipping route in 2-3 sentences using only the events provided. Do not invent events. Respond with valid JSON only.",
      user: `Route: ${origin} to ${destination}, passing ${route.via.join(", ")}.\n${UNTRUSTED_NOTE}\n${eventsBlock(score.drivers)}`,
      schemaName: "athena_summary",
      schema: stringSchema("intelligenceSummary"),
      validate: athenaOut,
      route: { origin, destination },
    });
    return { text: intelligenceSummary, degraded: false };
  } catch (err) {
    athenaLog.warn({ err }, "Athena summary failed, using template");
    return {
      text: `${score.drivers.length} live event(s) near the route. Closest: ${sanitizeForPrompt(score.drivers[0].title)} (${score.drivers[0].distanceKm} km).`,
      degraded: true,
    };
  }
}

// ── Agent Hermes – The Risk Modeler ──────────────────────────────────────────

export async function runHermes(
  origin: string,
  destination: string,
  score: RiskScore,
  days: number,
): Promise<AgentText> {
  const primary = score.primaryFactor ?? "none";
  const template = `Computed risk ${score.overall}/100 over about ${days} days. Primary factor: ${primary}.`;
  if (score.drivers.length === 0) return { text: template, degraded: false };
  try {
    const { riskNarrative } = await callAgent<{ riskNarrative: string }>({
      agent: "hermes",
      config: hermesConfig,
      system:
        "You are Hermes, the risk analyst for RiskWise. The risk score is already computed in code. Explain it in 3-4 sentences for a logistics manager. Do not change, recompute, or contradict any number. Respond with valid JSON only.",
      user: `Route: ${origin} to ${destination}, about ${days} days.
Computed risk score: ${score.overall}/100. Breakdown: ${JSON.stringify(score.breakdown)}. Primary factor: ${primary}.
${UNTRUSTED_NOTE}
${eventsBlock(score.drivers)}`,
      schemaName: "hermes_narrative",
      schema: stringSchema("riskNarrative"),
      validate: hermesOut,
      route: { origin, destination },
    });
    return { text: riskNarrative, degraded: false };
  } catch (err) {
    hermesLog.warn({ err }, "Hermes narrative failed, using template");
    return { text: template, degraded: true };
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

function titleKey(title: string): string {
  return title.toLowerCase().slice(0, 60);
}

function toScorable(e: LiveRiskEvent | DbEvent): ScorableEvent {
  return {
    title: e.title,
    category: e.category,
    severity: e.severity,
    affectedLocations: e.affectedLocations,
    coordinates: "coordinates" in e ? e.coordinates : undefined,
  };
}

/** Live events win over stored copies of the same event. */
export function mergeEvents(live: LiveRiskEvent[], stored: DbEvent[]): ScorableEvent[] {
  const seen = new Set<string>();
  const merged: ScorableEvent[] = [];
  for (const e of [...live, ...stored]) {
    const key = titleKey(e.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(toScorable(e));
  }
  return merged;
}

/**
 * `origin` and `destination` must be canonical names from shared/ports.ts.
 * `storedEvents` must already be live-sourced and recent (see getRecentLiveRiskEvents).
 */
export async function orchestrate(
  origin: string,
  destination: string,
  storedEvents: DbEvent[],
): Promise<OrchestrationResult> {
  const start = Date.now();
  orchestratorLog.info({ route: { origin, destination } }, `Starting orchestration: ${origin} -> ${destination}`);

  const route = buildRoute(origin, destination);
  const liveData = await fetchAllRealTimeIntelligence();
  const liveOk = liveData.sources.some((s) => s.kind === "live" && s.ok);
  if (!liveOk && storedEvents.length === 0) throw new NoLiveDataError();

  const isBaseline = (e: LiveRiskEvent) => e.sourceProvider === BASELINE_PROVIDER;
  const scoredEvents = mergeEvents(liveData.events.filter((e) => !isBaseline(e)), storedEvents);
  const score = scoreRoute(route.waypoints, scoredEvents);
  const baselineContext = scoreRoute(route.waypoints, liveData.events.filter(isBaseline).map(toScorable)).drivers;
  const days = transitDays(route.distanceKm);

  const athena = await runAthena(origin, destination, route, score);
  const hermes = await runHermes(origin, destination, score, days);

  const reroute = score.overall > REROUTE_THRESHOLD;
  const apollo = reroute
    ? await runApollo({ origin, destination, route, score, days, events: scoredEvents, config: apolloConfig })
    : { alternativeRoutes: [], recommendation: NO_REROUTE, degraded: false };

  const durationMs = Date.now() - start;
  logRouteEvaluation({
    origin,
    destination,
    overallRiskScore: score.overall,
    primaryRiskFactor: score.primaryFactor ?? "none",
    durationMs,
    agentsInvoked: reroute ? ["athena", "hermes", "apollo"] : ["athena", "hermes"],
    dataSourcesOk: liveData.sources.filter((s) => s.ok).length,
    dataSourcesFailed: liveData.sources.filter((s) => !s.ok).length,
  });

  return {
    overallRiskScore: score.overall,
    primaryRiskFactor: describeFactor(score.primaryFactor),
    breakdown: score.breakdown,
    baseTransitDays: days,
    riskNarrative: hermes.text,
    intelligenceSummary: athena.text,
    llmDegraded: athena.degraded || hermes.degraded || apollo.degraded,
    dataSources: liveData.sources,
    drivers: score.drivers,
    baselineContext,
    alternativeRoutes: apollo.alternativeRoutes,
    recommendation: apollo.recommendation,
    baseRouteWaypoints: route.waypoints,
  };
}

const FACTOR_LABEL: Record<Factor, string> = {
  weather: "Weather",
  labor: "Labor and strikes",
  geopolitical: "Geopolitical",
  congestion: "Port congestion",
};

function describeFactor(factor: Factor | null): string {
  return factor ? FACTOR_LABEL[factor] : "None identified";
}

// ── Athena Background Scan ────────────────────────────────────────────────────

/** Highest-severity live event, or null when no live source produced one. Baseline entries are skipped. */
export async function selectScanEvent(): Promise<LiveRiskEvent | null> {
  const liveData = await fetchAllRealTimeIntelligence();
  return liveData.events.find((e) => e.sourceProvider !== BASELINE_PROVIDER) ?? null;
}
