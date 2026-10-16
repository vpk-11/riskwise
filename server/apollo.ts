/**
 * Apollo: a tool-using agent that proposes alternative routes, with every number computed in code.
 *
 * The model can only reach the world through two read-only tools. `route_options` runs the sea-lane graph with
 * named chokepoints blocked and returns the computed route, transit days, and risk score. `nearby_events` lists
 * live events near a sea node. The model picks among options the code produced and writes the reasoning. It cannot
 * invent a route: a pick must reference an option id the workspace issued, and the risk score, days, and geometry
 * on every returned alternative come from the workspace, never from the model. If the model is down, fails, or
 * picks nothing valid, a deterministic ranking of the same candidates stands in.
 */

import { z } from "zod";
import {
  avoidedChokepoints,
  buildRoute,
  candidateRoutes,
  describeAlternative,
  CHOKEPOINTS,
  eventPoints,
  haversineKm,
  SEA_NODES,
  type RouteGeometry,
} from "@shared/geo";
import type { LngLat } from "@shared/ports";
import { invokeLLM, type LLMConfig, type Message, type Tool } from "./_core/llm";
import { createLogger, logAgentTelemetry } from "./_core/logger";
import { eventsBlock, sanitizeForPrompt, UNTRUSTED_NOTE } from "./promptSafety";
import { scoreRoute, transitDays, type RiskScore, type ScorableEvent } from "./scoring";

const log = createLogger("apollo");

export const MAX_STEPS = 6;
const MAX_TOOL_CALLS_PER_STEP = 4;
const MAX_ALTERNATIVES = 3;
const MAX_OPTIONS = 12;
/** An alternative must lower the risk score by at least this much to count as safer. One point is noise. */
export const MIN_RISK_REDUCTION = 5;

export interface AlternativeRoute {
  optionId: string;
  name: string;
  via: string[];
  distanceKm: number;
  transitDays: number;
  /** Extra days versus the direct route. */
  extraDays: number;
  /** Computed with the same scoring as the direct route, on the same events. */
  riskScore: number;
  /** Direct route score minus this route's score. Always positive. */
  riskReduction: number;
  waypoints: LngLat[];
  rationale: string;
}

export interface ApolloResult {
  alternativeRoutes: AlternativeRoute[];
  recommendation: string;
  /** True when the model did not produce the result: it failed, or none of its picks were valid. */
  degraded: boolean;
  /** LLM calls made. */
  steps: number;
}

interface RouteOption {
  id: string;
  route: RouteGeometry;
  avoids: string[];
  score: RiskScore;
  days: number;
}

// ── Workspace: the only thing the tools can touch ────────────────────────────

export class RouteWorkspace {
  private byId = new Map<string, RouteOption>();
  private byLane = new Map<string, RouteOption>();

  constructor(
    readonly origin: string,
    readonly destination: string,
    readonly events: ScorableEvent[],
    readonly base: { score: number; days: number },
    /** The direct route, which alternatives are described against. */
    readonly direct: RouteGeometry,
  ) {}

  /** Registers a route and computes its score. Identical lanes share one option. */
  register(route: RouteGeometry, avoids: string[]): RouteOption {
    const lane = route.via.join(">");
    const existing = this.byLane.get(lane);
    if (existing) return existing;
    if (this.byId.size >= MAX_OPTIONS) throw new Error(`At most ${MAX_OPTIONS} routes can be explored`);
    const option: RouteOption = {
      id: `opt_${this.byId.size + 1}`,
      route,
      avoids,
      score: scoreRoute(route.waypoints, this.events),
      days: transitDays(route.distanceKm),
    };
    this.byId.set(option.id, option);
    this.byLane.set(lane, option);
    return option;
  }

  get(id: string): RouteOption | undefined {
    return this.byId.get(id);
  }

  all(): RouteOption[] {
    return Array.from(this.byId.values());
  }

  /** Tool: the best route avoiding the named chokepoints, with its computed risk. */
  routeOptions(args: unknown) {
    const { avoid } = routeOptionsArgs.parse(args);
    const option = this.register(buildRoute(this.origin, this.destination, avoid), avoid);
    return {
      optionId: option.id,
      via: option.route.via,
      distanceKm: Math.round(option.route.distanceKm),
      transitDays: option.days,
      extraDaysVsDirect: option.days - this.base.days,
      riskScore: option.score.overall,
      directRiskScore: this.base.score,
      topDrivers: option.score.drivers.slice(0, 3).map((d) => ({
        title: sanitizeForPrompt(d.title),
        severity: d.severity,
        category: d.category,
        distanceKm: d.distanceKm,
      })),
    };
  }

  /** Tool: live events within `radiusKm` of a sea node. */
  nearbyEvents(args: unknown) {
    const { node, radiusKm } = nearbyArgs.parse(args);
    const center = SEA_NODES[node];
    const found = this.events
      .map((e) => ({ e, km: Math.min(...eventPoints(e).map((p) => haversineKm(p, center)), Infinity) }))
      .filter((x) => x.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 6);
    return {
      note: UNTRUSTED_NOTE,
      node,
      radiusKm,
      events: found.map(({ e, km }) => ({
        title: sanitizeForPrompt(e.title),
        severity: e.severity,
        category: e.category,
        distanceKm: Math.round(km),
      })),
    };
  }

  /** Runs a tool call. Bad arguments or unknown tools come back as an error the model can react to. */
  dispatch(name: string, rawArguments: string): unknown {
    try {
      const args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
      if (name === "route_options") return this.routeOptions(args);
      if (name === "nearby_events") return this.nearbyEvents(args);
      return { error: `Unknown tool: ${name}` };
    } catch (err) {
      return { error: err instanceof z.ZodError ? `Invalid arguments: ${err.issues.map((i) => i.message).join("; ")}` : String(err instanceof Error ? err.message : err) };
    }
  }
}

const routeOptionsArgs = z.object({
  avoid: z.array(z.enum(CHOKEPOINTS)).min(1).max(4),
});

const nodeNames = Object.keys(SEA_NODES) as [string, ...string[]];
const nearbyArgs = z.object({
  node: z.enum(nodeNames),
  radiusKm: z.number().min(50).max(3000).default(1500),
});

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "route_options",
      description:
        "Compute the best route for this voyage that avoids the named chokepoints. Returns the route's via nodes, distance, transit days, computed risk score, and its top risk drivers. Call it once per idea.",
      parameters: {
        type: "object",
        properties: {
          avoid: { type: "array", items: { type: "string", enum: [...CHOKEPOINTS] }, minItems: 1, maxItems: 4 },
        },
        required: ["avoid"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nearby_events",
      description: "List live events within a radius of a sea node, to check what is happening around a chokepoint.",
      parameters: {
        type: "object",
        properties: {
          node: { type: "string", enum: nodeNames },
          radiusKm: { type: "number", minimum: 50, maximum: 3000 },
        },
        required: ["node"],
      },
    },
  },
];

// ── Final answer ─────────────────────────────────────────────────────────────

const finalAnswer = z.object({
  picks: z
    .array(z.object({ optionId: z.string(), name: z.string().trim().min(1), rationale: z.string().trim().min(1) }))
    .max(5),
  recommendation: z.string().trim().min(1),
});

type FinalAnswer = z.infer<typeof finalAnswer>;

/** The model's reply as JSON: the whole text, or the outermost braces if it wrapped the JSON in prose. */
export function parseFinalAnswer(content: unknown): FinalAnswer {
  const text = typeof content === "string" ? content : "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("No JSON in the final answer");
    json = JSON.parse(text.slice(start, end + 1));
  }
  return finalAnswer.parse(json);
}

/** Model prose that mentions the tools or option ids was not written for a logistics manager. It is replaced, never edited. */
const TOOLING = /route_options|nearby_events|\bopt_\d+\b|tool call/i;

const fmtDays = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

/** Name and rationale built only from computed values. Used when the model's prose is missing or leaks tooling. */
function templateProse(ws: RouteWorkspace, o: RouteOption) {
  const avoided = avoidedChokepoints(ws.direct, o.route);
  return {
    name: describeAlternative(ws.direct, o.route),
    rationale: `${avoided.length > 0 ? `Avoids ${avoided.join(", ")}. ` : ""}Computed risk ${o.score.overall} versus ${ws.base.score} for the direct route, ${fmtDays(o.days - ws.base.days)} days.`,
  };
}

const usableProse = (text: string | undefined, fallback: string, max: number) =>
  text && !TOOLING.test(text) ? sanitizeForPrompt(text, max) : fallback;

function toAlternative(ws: RouteWorkspace, option: RouteOption, prose?: { name: string; rationale: string }): AlternativeRoute {
  const template = templateProse(ws, option);
  return {
    optionId: option.id,
    name: usableProse(prose?.name, template.name, 80),
    via: option.route.via,
    distanceKm: Math.round(option.route.distanceKm),
    transitDays: option.days,
    extraDays: option.days - ws.base.days,
    riskScore: option.score.overall,
    riskReduction: ws.base.score - option.score.overall,
    waypoints: option.route.waypoints,
    rationale: usableProse(prose?.rationale, template.rationale, 300),
  };
}

const NO_SAFER_LANE = `No materially safer lane: no option lowers the risk score by at least ${MIN_RISK_REDUCTION} points.`;

function recommendationFor(alternatives: AlternativeRoute[], ws: RouteWorkspace): string {
  const best = alternatives[0];
  return best
    ? `Lowest computed risk: ${best.name} (risk ${best.riskScore} versus ${ws.base.score}, ${fmtDays(best.extraDays)} days).`
    : NO_SAFER_LANE;
}

/**
 * Deterministic ranking of the candidate lanes: lowest computed risk first, only materially safer ones.
 * `degraded` says whether the model failed to produce the result this stands in for.
 */
export function deterministicAlternatives(ws: RouteWorkspace, degraded: boolean): ApolloResult {
  for (const c of candidateRoutes(ws.origin, ws.destination)) {
    try {
      ws.register(c.route, c.avoids);
    } catch {
      break; // the model already filled the workspace; rank what exists
    }
  }
  const alternativeRoutes = ws
    .all()
    .filter((o) => o.avoids.length > 0 && ws.base.score - o.score.overall >= MIN_RISK_REDUCTION)
    .sort((a, b) => a.score.overall - b.score.overall || a.days - b.days)
    .slice(0, 2)
    .map((o) => toAlternative(ws, o));
  return { alternativeRoutes, recommendation: recommendationFor(alternativeRoutes, ws), degraded, steps: 0 };
}

// ── Agent loop ───────────────────────────────────────────────────────────────

const SYSTEM = `You are Apollo, the route advisor for RiskWise. A shipping route has a computed risk score. Find safer alternatives using your tools.

Rules:
- You may only recommend routes returned by the route_options tool. Never describe a route that a tool did not return.
- Allowed chokepoints to avoid: ${CHOKEPOINTS.join(", ")}.
- Call route_options for each idea (usually avoid one or two chokepoints on the current route). Use nearby_events only if you need to check what is happening around a chokepoint.
- Prefer routes with a lower riskScore than the direct route, and only recommend one that lowers it by at least ${MIN_RISK_REDUCTION} points. Weigh the extra transit days.
- Write names and rationales for a logistics manager. Do not mention tool names, call numbers, or option ids in them; just state the lane and the numbers.
- Stop after at most a few tool calls. Then reply with JSON only, no other text:
{"picks":[{"optionId":"opt_1","name":"short name","rationale":"one or two sentences using the tool numbers"}],"recommendation":"one sentence"}
- If no option is safer than the direct route, reply with {"picks":[],"recommendation":"..."} explaining that.`;

interface ApolloInput {
  origin: string;
  destination: string;
  route: RouteGeometry;
  score: RiskScore;
  days: number;
  events: ScorableEvent[];
  config: LLMConfig;
}

async function chat(messages: Message[], tools: Tool[] | undefined, input: ApolloInput) {
  const response = await invokeLLM({ messages, ...(tools ? { tools, tool_choice: "auto" as const } : {}) }, input.config);
  logAgentTelemetry({
    agent: "apollo",
    model: response._model,
    latencyMs: response._latencyMs,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    totalTokens: response.usage?.total_tokens,
    success: true,
    route: { origin: input.origin, destination: input.destination },
  });
  return response.choices[0]?.message;
}

async function agentLoop(ws: RouteWorkspace, input: ApolloInput): Promise<{ answer: FinalAnswer; steps: number }> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Voyage: ${input.origin} to ${input.destination}. Direct route passes ${input.route.via.join(", ")}: about ${input.days} days, computed risk ${input.score.overall}/100, primary factor ${input.score.primaryFactor}.
${UNTRUSTED_NOTE}
${eventsBlock(input.score.drivers)}

Find up to ${MAX_ALTERNATIVES} alternatives that lower the risk.`,
    },
  ];

  let steps = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const message = await chat(messages, TOOLS, input);
    steps++;
    const calls = message?.tool_calls ?? [];
    if (calls.length === 0) return { answer: parseFinalAnswer(message?.content), steps };

    messages.push({ role: "assistant", content: typeof message?.content === "string" ? message.content : "", tool_calls: calls });
    calls.forEach((call, index) => {
      const result =
        index < MAX_TOOL_CALLS_PER_STEP
          ? ws.dispatch(call.function.name, call.function.arguments)
          : { error: `Only ${MAX_TOOL_CALLS_PER_STEP} tool calls are run per step` };
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
    });
  }

  // Step limit: ask for the answer with no tools available.
  messages.push({ role: "user", content: "Step limit reached. Reply now with the final JSON only." });
  const message = await chat(messages, undefined, input);
  steps++;
  return { answer: parseFinalAnswer(message?.content), steps };
}

export async function runApollo(input: ApolloInput): Promise<ApolloResult> {
  const ws = new RouteWorkspace(input.origin, input.destination, input.events, { score: input.score.overall, days: input.days }, input.route);

  try {
    const { answer, steps } = await agentLoop(ws, input);

    const seen = new Set<string>();
    const alternativeRoutes: AlternativeRoute[] = [];
    let unknownPicks = 0;
    for (const pick of answer.picks) {
      const option = ws.get(pick.optionId);
      if (!option) {
        unknownPicks++; // the model named a route no tool returned
        continue;
      }
      // Only options the workspace issued, only materially safer ones, each once.
      if (seen.has(option.id) || ws.base.score - option.score.overall < MIN_RISK_REDUCTION) continue;
      seen.add(option.id);
      alternativeRoutes.push(toAlternative(ws, option, pick));
      if (alternativeRoutes.length === MAX_ALTERNATIVES) break;
    }
    alternativeRoutes.sort((a, b) => a.riskScore - b.riskScore);

    if (alternativeRoutes.length === 0 && answer.picks.length > 0) {
      if (unknownPicks > 0) {
        log.warn({ picks: answer.picks.map((p) => p.optionId) }, "The model named routes no tool returned, using the deterministic ranking");
        return { ...deterministicAlternatives(ws, true), steps };
      }
      // Real options, just not materially safer: an honest negative, not a model failure.
      return { alternativeRoutes: [], recommendation: NO_SAFER_LANE, degraded: false, steps };
    }
    return { alternativeRoutes, recommendation: usableProse(answer.recommendation, recommendationFor(alternativeRoutes, ws), 300), degraded: false, steps };
  } catch (err) {
    log.warn({ err }, "Apollo agent failed, using the deterministic ranking");
    logAgentTelemetry({
      agent: "apollo",
      model: input.config.model ?? "unknown",
      latencyMs: 0,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      route: { origin: input.origin, destination: input.destination },
    });
    return deterministicAlternatives(ws, true);
  }
}
