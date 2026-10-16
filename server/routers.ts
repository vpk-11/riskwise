import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { routesRouter, eventsRouter } from "./routers/riskwise";

export const appRouter = router({
  system: systemRouter,
  routes: routesRouter,
  events: eventsRouter,
});

export type AppRouter = typeof appRouter;
