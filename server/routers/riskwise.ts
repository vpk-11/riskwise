import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
import {
  getActiveRiskEvents,
  getRouteHistory,
  insertRouteEvaluation,
  getEvaluationById,
  getAllShippingRoutes,
} from "../db";
import { orchestrate } from "../agents";

// ── Routes Router ─────────────────────────────────────────────────────────────
export const routesRouter = router({
  evaluate: publicProcedure
    .input(
      z.object({
        origin: z.string().min(2),
        destination: z.string().min(2),
        queryText: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Fetch active disruptions for context
      const disruptions = await getActiveRiskEvents();
      const disruptionContext = disruptions.map((d) => ({
        title: d.title,
        category: d.category,
        severity: d.severity,
        affectedLocations: (d.affectedLocations as string[]) ?? [],
        description: d.description,
      }));

      // Run multi-agent orchestration
      const result = await orchestrate(input.origin, input.destination, disruptionContext);

      // Persist evaluation
      await insertRouteEvaluation({
        originPort: input.origin,
        destinationPort: input.destination,
        overallRiskScore: result.overallRiskScore,
        primaryRiskFactor: result.primaryRiskFactor,
        breakdown: result.breakdown,
        baseTransitDays: result.baseTransitDays,
        alternativeRoutes: result.alternativeRoutes,
        queryText: input.queryText ?? null,
      });

      // Notify owner if critical risk (score > 75)
      if (result.overallRiskScore > 75) {
        await notifyOwner({
          title: `🚨 Critical Risk Alert: ${input.origin} → ${input.destination}`,
          content: `Route evaluation returned a Critical Risk Score of ${result.overallRiskScore}/100.\n\nPrimary Risk Factor: ${result.primaryRiskFactor}\n\nRisk Narrative: ${result.riskNarrative}\n\nImmediate rerouting is recommended.`,
        });
      }

      return result;
    }),

  history: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      return getRouteHistory(input?.limit ?? 20);
    }),

  rerun: publicProcedure
    .input(z.object({ evaluationId: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await getEvaluationById(input.evaluationId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Evaluation not found" });

      const disruptions = await getActiveRiskEvents();
      const disruptionContext = disruptions.map((d) => ({
        title: d.title,
        category: d.category,
        severity: d.severity,
        affectedLocations: (d.affectedLocations as string[]) ?? [],
        description: d.description,
      }));

      const result = await orchestrate(existing.originPort, existing.destinationPort, disruptionContext);

      await insertRouteEvaluation({
        originPort: existing.originPort,
        destinationPort: existing.destinationPort,
        overallRiskScore: result.overallRiskScore,
        primaryRiskFactor: result.primaryRiskFactor,
        breakdown: result.breakdown,
        baseTransitDays: result.baseTransitDays,
        alternativeRoutes: result.alternativeRoutes,
        queryText: `Re-run of evaluation #${input.evaluationId}`,
      });

      if (result.overallRiskScore > 75) {
        await notifyOwner({
          title: `🚨 Critical Risk Alert: ${existing.originPort} → ${existing.destinationPort}`,
          content: `Re-run evaluation returned a Critical Risk Score of ${result.overallRiskScore}/100.\n\nPrimary Risk Factor: ${result.primaryRiskFactor}`,
        });
      }

      return result;
    }),

  allRoutes: publicProcedure.query(async () => {
    return getAllShippingRoutes();
  }),
});

// ── Events Router ─────────────────────────────────────────────────────────────
export const eventsRouter = router({
  active: publicProcedure
    .input(
      z
        .object({
          category: z.enum(["Weather", "Strike", "Geopolitical", "Port Congestion"]).optional(),
          severity: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
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
