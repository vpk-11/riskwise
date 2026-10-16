import { eq, and, asc, desc, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase } from "drizzle-orm/pg-core";
import postgres from "postgres";
import {
  type InsertRiskEvent,
  type InsertShippingRoute,
  type InsertRouteEvaluation,
  riskEvents,
  routeEvaluations,
  shippingRoutes,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

/** Any Drizzle Postgres database. Query helpers take one so tests can pass an in-process Postgres. */
export type Db = PgDatabase<any, any, any>;

let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!_db) {
    const client = postgres(ENV.DATABASE_URL);
    _db = drizzle(client);
  }
  return _db;
}

// ── Risk Events ───────────────────────────────────────────────────────────────

export async function getActiveRiskEvents() {
  const db = getDb();
  return db
    .select()
    .from(riskEvents)
    .where(eq(riskEvents.isActive, true))
    .orderBy(desc(riskEvents.createdAt));
}

/** Live-sourced events from the last EVENT_MAX_AGE_DAYS. Synthetic and baseline rows never feed scoring. */
export const EVENT_MAX_AGE_DAYS = 7;

export async function getRecentLiveRiskEvents(db: Db = getDb()) {
  const since = new Date(Date.now() - EVENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(riskEvents)
    .where(
      and(
        eq(riskEvents.isActive, true),
        eq(riskEvents.sourceType, "live"),
        gte(riskEvents.createdAt, since),
      ),
    )
    .orderBy(desc(riskEvents.createdAt));
}

export async function activeRiskEventExists(title: string, db: Db = getDb()) {
  const rows = await db
    .select({ id: riskEvents.id })
    .from(riskEvents)
    .where(and(eq(riskEvents.isActive, true), eq(riskEvents.sourceType, "live"), eq(riskEvents.title, title)))
    .limit(1);
  return rows.length > 0;
}

export async function insertRiskEvent(event: InsertRiskEvent) {
  const db = getDb();
  return db.insert(riskEvents).values(event);
}

// ── Shipping Routes ───────────────────────────────────────────────────────────

export async function getAllShippingRoutes() {
  const db = getDb();
  return db.select().from(shippingRoutes).orderBy(desc(shippingRoutes.createdAt));
}

export async function findRoute(origin: string, destination: string) {
  const db = getDb();
  const results = await db
    .select()
    .from(shippingRoutes)
    .where(and(eq(shippingRoutes.originPort, origin), eq(shippingRoutes.destinationPort, destination)))
    .limit(1);
  return results[0] ?? null;
}

export async function insertShippingRoute(route: InsertShippingRoute) {
  const db = getDb();
  return db.insert(shippingRoutes).values(route);
}

// ── Route Evaluations ─────────────────────────────────────────────────────────

export async function insertRouteEvaluation(evaluation: InsertRouteEvaluation) {
  const db = getDb();
  return db.insert(routeEvaluations).values(evaluation);
}

export async function getRouteHistory(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(routeEvaluations)
    .orderBy(desc(routeEvaluations.evaluatedAt))
    .limit(limit);
}

/** The latest `limit` evaluations of a route, oldest first (for the sparkline). */
export async function getRouteTrend(originPort: string, destinationPort: string, limit = 10, db: Db = getDb()) {
  const latest = await db
    .select({
      id: routeEvaluations.id,
      overallRiskScore: routeEvaluations.overallRiskScore,
      evaluatedAt: routeEvaluations.evaluatedAt,
    })
    .from(routeEvaluations)
    .where(
      and(
        eq(routeEvaluations.originPort, originPort),
        eq(routeEvaluations.destinationPort, destinationPort)
      )
    )
    .orderBy(desc(routeEvaluations.evaluatedAt))
    .limit(limit);
  return latest.reverse();
}

export async function getEvaluationById(id: number) {
  const db = getDb();
  const results = await db
    .select()
    .from(routeEvaluations)
    .where(eq(routeEvaluations.id, id))
    .limit(1);
  return results[0] ?? null;
}
