import { eq, and, asc, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  type InsertRiskEvent,
  type InsertShippingRoute,
  type InsertRouteEvaluation,
  riskEvents,
  routeEvaluations,
  shippingRoutes,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!_db) {
    const client = postgres(ENV.DATABASE_URL);
    _db = drizzle(client);
  }
  return _db;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUserById(id: number) {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? null;
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
    .where(eq(shippingRoutes.originPort, origin))
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

export async function getRouteTrend(originPort: string, destinationPort: string, limit = 10) {
  const db = getDb();
  return db
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
    .orderBy(asc(routeEvaluations.evaluatedAt))
    .limit(limit);
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
