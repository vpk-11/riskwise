import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  InsertRiskEvent,
  InsertShippingRoute,
  InsertRouteEvaluation,
  heartbeatJobs,
  riskEvents,
  routeEvaluations,
  shippingRoutes,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── Users ─────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Risk Events ───────────────────────────────────────────────────────────────
export async function getActiveRiskEvents() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(riskEvents).where(eq(riskEvents.isActive, 1)).orderBy(desc(riskEvents.createdAt));
}

export async function insertRiskEvent(event: InsertRiskEvent) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(riskEvents).values(event);
  return result;
}

// ── Shipping Routes ───────────────────────────────────────────────────────────
export async function getAllShippingRoutes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(shippingRoutes).orderBy(desc(shippingRoutes.createdAt));
}

export async function findRoute(origin: string, destination: string) {
  const db = await getDb();
  if (!db) return null;
  const results = await db
    .select()
    .from(shippingRoutes)
    .where(eq(shippingRoutes.originPort, origin))
    .limit(1);
  return results[0] ?? null;
}

export async function insertShippingRoute(route: InsertShippingRoute) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(shippingRoutes).values(route);
  return result;
}

// ── Route Evaluations ─────────────────────────────────────────────────────────
export async function insertRouteEvaluation(evaluation: InsertRouteEvaluation) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(routeEvaluations).values(evaluation);
  return result;
}

export async function getRouteHistory(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(routeEvaluations)
    .orderBy(desc(routeEvaluations.evaluatedAt))
    .limit(limit);
}

export async function getEvaluationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(routeEvaluations).where(eq(routeEvaluations.id, id)).limit(1);
  return results[0] ?? null;
}

// ── Heartbeat Jobs ────────────────────────────────────────────────────────────
export async function upsertHeartbeatJob(name: string, taskUid: string, description?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(heartbeatJobs)
    .values({ name, taskUid, description: description ?? null, isActive: 1 })
    .onDuplicateKeyUpdate({ set: { taskUid, isActive: 1 } });
}

export async function getHeartbeatJobByName(name: string) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(heartbeatJobs).where(eq(heartbeatJobs.name, name)).limit(1);
  return results[0] ?? null;
}
