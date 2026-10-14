import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolvePort } from "@shared/ports";
import { categoryEnum, severityEnum } from "../../drizzle/schema";
import { middleware, publicProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { notifyOwner } from "../_core/notification";
import {
  getActiveRiskEvents,
  getRecentLiveRiskEvents,
  getRouteHistory,
  insertRouteEvaluation,
  getEvaluationById,
  getAllShippingRoutes,
  getRouteTrend,
} from "../db";
import { NoLiveDataError, orchestrate, type DbEvent } from "../agents";
import { createRateLimiter } from "../rateLimit";

const CRITICAL_SCORE = 75;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const evaluationLimiter = createRateLimiter(ENV.RISKWISE_EVAL_LIMIT_PER_HOUR, RATE_WINDOW_MS);

const rateLimited = middleware(({ ctx, next }) => {
  if (!evaluationLimiter.allow(ctx.req.ip ?? "unknown")) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Evaluation limit reached. Try again later." });
  }
  return next();
});

const evaluationProcedure = publicProcedure.use(rateLimited);

function canonicalPort(input: string): string {
  const port = resolvePort(input);
  if (!port) throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported port: "${input.slice(0, 60)}"` });
  return port;
}

async function evaluate(origin: string, destination: string, queryText: string | null) {
  const stored: DbEvent[] = (await getRecentLiveRiskEvents()).map((d) => ({
    title: d.title,
    category: d.category,
    severity: d.severity,
    affectedLocations: d.affectedLocations,
    coordinates: d.longitude !== null && d.latitude !== null ? ([d.longitude, d.latitude] as [number, number]) : undefined,
  }));

  let result;
  try {
    result = await orchestrate(origin, destination, stored);
  } catch (err) {
    if (err instanceof NoLiveDataError) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: err.message });
    }
    throw err;
  }

  await insertRouteEvaluation({
    originPort: origin,
    destinationPort: destination,
    overallRiskScore: result.overallRiskScore,
    primaryRiskFactor: result.primaryRiskFactor,
    breakdown: result.breakdown,
    baseTransitDays: result.baseTransitDays,
    alternativeRoutes: result.alternativeRoutes,
    riskNarrative: result.riskNarrative,
    intelligenceSummary: result.intelligenceSummary,
    dataSources: result.dataSources,
    queryText,
  });

  if (result.overallRiskScore > CRITICAL_SCORE) {
    await notifyOwner({
      title: `Critical Risk Alert: ${origin} to ${destination}`,
      content: `Route evaluation returned a Critical Risk Score of ${result.overallRiskScore}/100.\n\nPrimary Risk Factor: ${result.primaryRiskFactor}\n\nRisk Narrative: ${result.riskNarrative}`,
    });
  }

  return result;
}

// ── Routes Router ─────────────────────────────────────────────────────────────
export const routesRouter = router({
  evaluate: evaluationProcedure
    .input(
      z.object({
        origin: z.string().min(2).max(100),
        destination: z.string().min(2).max(100),
        queryText: z.string().max(500).optional(),
      })
    )
    .mutation(({ input }) =>
      evaluate(canonicalPort(input.origin), canonicalPort(input.destination), input.queryText ?? null),
    ),

  history: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      return getRouteHistory(input?.limit ?? 20);
    }),

  rerun: evaluationProcedure
    .input(z.object({ evaluationId: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await getEvaluationById(input.evaluationId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Evaluation not found" });
      return evaluate(
        canonicalPort(existing.originPort),
        canonicalPort(existing.destinationPort),
        `Re-run of evaluation #${input.evaluationId}`,
      );
    }),

  allRoutes: publicProcedure.query(async () => {
    return getAllShippingRoutes();
  }),

  trend: publicProcedure
    .input(z.object({ originPort: z.string().max(100), destinationPort: z.string().max(100) }))
    .query(async ({ input }) => {
      return getRouteTrend(input.originPort, input.destinationPort, 10);
    }),
});

// ── Events Router ─────────────────────────────────────────────────────────────
export const eventsRouter = router({
  active: publicProcedure
    .input(
      z
        .object({
          category: z.enum(categoryEnum.enumValues).optional(),
          severity: z.enum(severityEnum.enumValues).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const events = await getActiveRiskEvents();
      let filtered = events;
      if (input?.category) filtered = filtered.filter((e) => e.category === input.category);
      if (input?.severity) filtered = filtered.filter((e) => e.severity === input.severity);
      return filtered;
    }),
});
