/**
 * RiskWise Multi-Agent Orchestration
 *
 * Three specialized LLM agents:
 *   Athena  – The Researcher: scans disruptions and extracts intelligence
 *   Hermes  – The Risk Modeler: calculates risk scores for routes
 *   Apollo  – The Route Optimizer: generates alternative routes when risk > 50
 */

import { invokeLLM } from "./_core/llm";
import { fetchAllRealTimeIntelligence, type LiveRiskEvent } from "./realtime";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiskBreakdown {
  weather: number;
  labor: number;
  geopolitical: number;
  congestion: number;
}

export interface AlternativeRoute {
  name: string;
  transitDays: number;
  riskScore: number;
  waypoints: [number, number][];
  costImpact: string;
  description: string;
}

export interface AthenaResult {
  relevantDisruptions: {
    title: string;
    category: string;
    severity: string;
    affectedLocations: string[];
    impactSummary: string;
  }[];
  intelligenceSummary: string;
}

export interface HermesResult {
  overallRiskScore: number;
  primaryRiskFactor: string;
  breakdown: RiskBreakdown;
  riskNarrative: string;
  baseTransitDays: number;
}

export interface ApolloResult {
  alternativeRoutes: AlternativeRoute[];
  recommendation: string;
}

export interface OrchestrationResult {
  overallRiskScore: number;
  primaryRiskFactor: string;
  breakdown: RiskBreakdown;
  baseTransitDays: number;
  riskNarrative: string;
  intelligenceSummary: string;
  dataSources: { name: string; count: number; ok: boolean }[];
  alternativeRoutes: AlternativeRoute[];
  recommendation: string;
  baseRouteWaypoints: [number, number][];
}

// ── Agent Athena – The Researcher ─────────────────────────────────────────────

export async function runAthena(
  origin: string,
  destination: string,
  activeDisruptions: { title: string; category: string; severity: string; affectedLocations: string[]; description: string }[]
): Promise<AthenaResult> {
  // Fetch real-time intelligence from live sources (RSS, NASA EONET, USGS, Country Risk)
  let liveEvents: LiveRiskEvent[] = [];
  let liveSourceSummary = "";
  try {
    const liveData = await fetchAllRealTimeIntelligence();
    liveEvents = liveData.events;
    const successfulSources = liveData.sources.filter((s) => s.ok).map((s) => `${s.name} (${s.count} events)`);
    liveSourceSummary = successfulSources.length > 0
      ? `Live intelligence fetched from: ${successfulSources.join(", ")} as of ${liveData.fetchedAt}`
      : "Live intelligence sources unavailable — using database events only.";
    console.log(`[Athena] Live data: ${liveEvents.length} events from ${successfulSources.length} sources`);
  } catch (e) {
    console.warn("[Athena] Real-time fetch failed, falling back to DB events:", e);
  }

  // Merge live events with DB events (live events take priority)
  const mergedDisruptions = [
    ...liveEvents.map((e) => ({
      title: e.title,
      category: e.category,
      severity: e.severity,
      affectedLocations: e.affectedLocations,
      description: `[${e.sourceProvider}] ${e.description}`,
    })),
    ...activeDisruptions.slice(0, 10), // Keep up to 10 DB events as supplementary context
  ].slice(0, 30); // Cap total context at 30 events

  const disruptionContext = mergedDisruptions
    .map((d) => `- [${d.severity}] ${d.title} (${d.category}): affects ${d.affectedLocations.join(", ")}\n  ${d.description.slice(0, 200)}`)
    .join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Athena, the logistics intelligence researcher for RiskWise. Your goal is to analyze real-world trade disruptions and identify which ones are relevant to a given shipping route. You extract key intelligence about port disruptions, geopolitical events, weather anomalies, and labor strikes that could impact the route. Always respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Analyze the shipping route from ${origin} to ${destination}.

${liveSourceSummary}

Current active global disruptions (merged from live sources + database):
${disruptionContext || "No disruptions currently in the database."}

Identify which disruptions are relevant to this route and provide an intelligence summary. Consider the typical geographic path between these ports. Note which events come from live news sources vs. database records.

Respond with JSON in this exact format:
{
  "relevantDisruptions": [
    {
      "title": "string",
      "category": "string",
      "severity": "string",
      "affectedLocations": ["string"],
      "impactSummary": "string - how this specifically affects the route"
    }
  ],
  "intelligenceSummary": "string - 2-3 sentence overview of the threat landscape for this route"
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "athena_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            relevantDisruptions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  category: { type: "string" },
                  severity: { type: "string" },
                  affectedLocations: { type: "array", items: { type: "string" } },
                  impactSummary: { type: "string" },
                },
                required: ["title", "category", "severity", "affectedLocations", "impactSummary"],
                additionalProperties: false,
              },
            },
            intelligenceSummary: { type: "string" },
          },
          required: ["relevantDisruptions", "intelligenceSummary"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(content) as AthenaResult;
}

// ── Agent Hermes – The Risk Modeler ──────────────────────────────────────────

export async function runHermes(
  origin: string,
  destination: string,
  athenaResult: AthenaResult
): Promise<HermesResult> {
  const disruptionContext = athenaResult.relevantDisruptions
    .map((d) => `- [${d.severity}] ${d.title}: ${d.impactSummary}`)
    .join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Hermes, the mathematical risk analyst for RiskWise. Your goal is to calculate a unified Risk Score (0-100) for a shipping route based on active disruptions, historical patterns, and geographic risk factors. You break down risk into four categories: weather (0-100), labor/strikes (0-100), geopolitical (0-100), and port congestion (0-100). The overall score is a weighted average. Always respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Calculate the risk score for the shipping route from ${origin} to ${destination}.

Intelligence from Agent Athena:
Summary: ${athenaResult.intelligenceSummary}

Relevant disruptions:
${disruptionContext || "No major disruptions identified for this route."}

Calculate:
1. Individual risk scores for weather, labor, geopolitical, and congestion (0-100 each)
2. Overall risk score (0-100) as weighted average
3. Primary risk factor (the single biggest threat)
4. Estimated base transit days for this route
5. A brief risk narrative

Respond with JSON in this exact format:
{
  "overallRiskScore": number,
  "primaryRiskFactor": "string",
  "breakdown": {
    "weather": number,
    "labor": number,
    "geopolitical": number,
    "congestion": number
  },
  "riskNarrative": "string",
  "baseTransitDays": number
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "hermes_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            overallRiskScore: { type: "number" },
            primaryRiskFactor: { type: "string" },
            breakdown: {
              type: "object",
              properties: {
                weather: { type: "number" },
                labor: { type: "number" },
                geopolitical: { type: "number" },
                congestion: { type: "number" },
              },
              required: ["weather", "labor", "geopolitical", "congestion"],
              additionalProperties: false,
            },
            riskNarrative: { type: "string" },
            baseTransitDays: { type: "number" },
          },
          required: ["overallRiskScore", "primaryRiskFactor", "breakdown", "riskNarrative", "baseTransitDays"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(content) as HermesResult;
}

// ── Agent Apollo – The Route Optimizer ───────────────────────────────────────

export async function runApollo(
  origin: string,
  destination: string,
  hermesResult: HermesResult
): Promise<ApolloResult> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Apollo, the logistics route optimizer for RiskWise. When Hermes flags a route with a Risk Score above 50, you calculate alternative routes with lower risk. You output routes with approximate waypoint coordinates (longitude, latitude pairs) and cost-benefit analysis. Always respond with valid JSON only. Coordinates must be realistic geographic positions on actual ocean shipping lanes.`,
      },
      {
        role: "user",
        content: `The route from ${origin} to ${destination} has been flagged with a Risk Score of ${hermesResult.overallRiskScore}/100.

Primary risk factor: ${hermesResult.primaryRiskFactor}
Base transit days: ${hermesResult.baseTransitDays}

Generate 2 alternative routes that avoid the primary risk areas. For each route:
1. Provide a descriptive name
2. Estimated transit days
3. Estimated risk score (should be lower than ${hermesResult.overallRiskScore})
4. Approximate waypoints as [longitude, latitude] pairs (6-12 points along realistic ocean shipping lanes)
5. Cost impact description (e.g., "+$45,000 fuel surcharge, +10 days")
6. Brief description of why this route is safer

Respond with JSON in this exact format:
{
  "alternativeRoutes": [
    {
      "name": "string",
      "transitDays": number,
      "riskScore": number,
      "waypoints": [[number, number]],
      "costImpact": "string",
      "description": "string"
    }
  ],
  "recommendation": "string - which route Apollo recommends and why"
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "apollo_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            alternativeRoutes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  transitDays: { type: "number" },
                  riskScore: { type: "number" },
                  waypoints: { type: "array", items: { type: "array", items: { type: "number" } } },
                  costImpact: { type: "string" },
                  description: { type: "string" },
                },
                required: ["name", "transitDays", "riskScore", "waypoints", "costImpact", "description"],
                additionalProperties: false,
              },
            },
            recommendation: { type: "string" },
          },
          required: ["alternativeRoutes", "recommendation"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(content) as ApolloResult;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function orchestrate(
  origin: string,
  destination: string,
  activeDisruptions: { title: string; category: string; severity: string; affectedLocations: string[]; description: string }[]
): Promise<OrchestrationResult> {
  // Step 1: Athena researches relevant disruptions (with live data)
  let liveDataSources: { name: string; count: number; ok: boolean }[] = [];
  try {
    const { fetchAllRealTimeIntelligence } = await import("./realtime");
    const liveData = await fetchAllRealTimeIntelligence();
    liveDataSources = liveData.sources;
  } catch {}
  const athenaResult = await runAthena(origin, destination, activeDisruptions);

  // Step 2: Hermes calculates risk score
  const hermesResult = await runHermes(origin, destination, athenaResult);

  // Step 3: Apollo generates alternatives if risk > 50
  let apolloResult: ApolloResult = { alternativeRoutes: [], recommendation: "Route risk is within acceptable parameters. No rerouting required." };
  if (hermesResult.overallRiskScore > 50) {
    apolloResult = await runApollo(origin, destination, hermesResult);
  }

  // Generate base route waypoints (simplified great-circle approximation)
  const baseRouteWaypoints = generateBaseWaypoints(origin, destination);

  return {
    overallRiskScore: Math.round(hermesResult.overallRiskScore),
    primaryRiskFactor: hermesResult.primaryRiskFactor,
    breakdown: {
      weather: Math.round(hermesResult.breakdown.weather),
      labor: Math.round(hermesResult.breakdown.labor),
      geopolitical: Math.round(hermesResult.breakdown.geopolitical),
      congestion: Math.round(hermesResult.breakdown.congestion),
    },
    baseTransitDays: hermesResult.baseTransitDays,
    riskNarrative: hermesResult.riskNarrative,
    intelligenceSummary: athenaResult.intelligenceSummary,
    dataSources: liveDataSources,
    alternativeRoutes: apolloResult.alternativeRoutes,
    recommendation: apolloResult.recommendation,
    baseRouteWaypoints,
  };
}

// ── Athena Background Scan ────────────────────────────────────────────────────

/**
 * Athena Background Scan — now uses real-time data from live sources.
 * Fetches live events first; if available, picks the most critical one to persist.
 * Falls back to LLM-generated synthetic event if all live sources fail.
 */
export async function runAthenaScan(): Promise<{
  title: string;
  description: string;
  category: "Weather" | "Strike" | "Geopolitical" | "Port Congestion";
  severity: "Low" | "Medium" | "High" | "Critical";
  affectedLocations: string[];
}> {
  // Try live sources first
  try {
    const liveData = await fetchAllRealTimeIntelligence();
    if (liveData.events.length > 0) {
      // Pick the highest-severity event that isn't already a country-risk entry
      const candidate = liveData.events.find((e) => e.sourceProvider !== "Osiris Country Risk Index") ?? liveData.events[0];
      console.log(`[Athena Scan] Using live event from ${candidate.sourceProvider}: ${candidate.title}`);
      return {
        title: candidate.title,
        description: `[Live — ${candidate.sourceProvider}] ${candidate.description}`,
        category: candidate.category,
        severity: candidate.severity,
        affectedLocations: candidate.affectedLocations,
      };
    }
  } catch (e) {
    console.warn("[Athena Scan] Live fetch failed, falling back to LLM generation:", e);
  }

  // Fallback: LLM-generated synthetic event
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Athena, the logistics intelligence researcher for RiskWise. Generate a realistic new supply chain disruption event that could affect global shipping. Base it on plausible real-world scenarios involving ports, shipping lanes, weather, labor disputes, or geopolitical events. Always respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Generate one new realistic supply chain disruption event for the current date. Make it specific, plausible, and impactful. Use one of these categories: Weather, Strike, Geopolitical, Port Congestion. Use one of these severities: Low, Medium, High, Critical.

Respond with JSON in this exact format:
{
  "title": "string - concise event title",
  "description": "string - 2-3 sentence detailed description",
  "category": "Weather|Strike|Geopolitical|Port Congestion",
  "severity": "Low|Medium|High|Critical",
  "affectedLocations": ["string - port or region names"]
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "athena_scan_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            category: { type: "string", enum: ["Weather", "Strike", "Geopolitical", "Port Congestion"] },
            severity: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
            affectedLocations: { type: "array", items: { type: "string" } },
          },
          required: ["title", "description", "category", "severity", "affectedLocations"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(content);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORT_COORDS: Record<string, [number, number]> = {
  "port of shanghai": [121.8, 30.6],
  "port of rotterdam": [4.5, 51.9],
  "port of singapore": [103.8, 1.3],
  "port of los angeles": [-118.2, 33.7],
  "port of long beach": [-118.2, 33.7],
  "port of shenzhen": [114.0, 22.5],
  "port of hong kong": [114.2, 22.3],
  "port of hamburg": [9.9, 53.5],
  "port of new york": [-74.0, 40.7],
  "port of dubai": [55.3, 25.3],
  "port of busan": [129.0, 35.1],
  "port of kaohsiung": [120.3, 22.6],
  "port of tokyo": [139.7, 35.6],
  "port of mumbai": [72.8, 18.9],
  "port of sydney": [151.2, -33.9],
};

function generateBaseWaypoints(origin: string, destination: string): [number, number][] {
  const originCoords = PORT_COORDS[origin.toLowerCase()] ?? [0, 0];
  const destCoords = PORT_COORDS[destination.toLowerCase()] ?? [0, 0];

  // Generate 8 interpolated points
  const points: [number, number][] = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const lng = originCoords[0] + (destCoords[0] - originCoords[0]) * t;
    const lat = originCoords[1] + (destCoords[1] - originCoords[1]) * t;
    points.push([lng, lat]);
  }
  return points;
}
