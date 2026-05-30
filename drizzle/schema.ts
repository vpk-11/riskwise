import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Risk Events ───────────────────────────────────────────────────────────────
export const riskEvents = mysqlTable("risk_events", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  category: mysqlEnum("category", ["Weather", "Strike", "Geopolitical", "Port Congestion"]).notNull(),
  severity: mysqlEnum("severity", ["Low", "Medium", "High", "Critical"]).notNull(),
  affectedLocations: json("affectedLocations").notNull(), // string[]
  sourceUrl: text("sourceUrl"),
  isActive: int("isActive").default(1).notNull(), // 1 = active, 0 = resolved
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RiskEvent = typeof riskEvents.$inferSelect;
export type InsertRiskEvent = typeof riskEvents.$inferInsert;

// ── Shipping Routes ───────────────────────────────────────────────────────────
export const shippingRoutes = mysqlTable("shipping_routes", {
  id: int("id").autoincrement().primaryKey(),
  originPort: varchar("originPort", { length: 100 }).notNull(),
  destinationPort: varchar("destinationPort", { length: 100 }).notNull(),
  waypoints: json("waypoints").notNull(), // GeoJSON LineString coordinates [[lng,lat],...]
  baseTransitDays: int("baseTransitDays").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShippingRoute = typeof shippingRoutes.$inferSelect;
export type InsertShippingRoute = typeof shippingRoutes.$inferInsert;

// ── Route Evaluations ─────────────────────────────────────────────────────────
export const routeEvaluations = mysqlTable("route_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  routeId: int("routeId").references(() => shippingRoutes.id),
  originPort: varchar("originPort", { length: 100 }).notNull(),
  destinationPort: varchar("destinationPort", { length: 100 }).notNull(),
  overallRiskScore: int("overallRiskScore").notNull(), // 0-100
  primaryRiskFactor: text("primaryRiskFactor").notNull(),
  breakdown: json("breakdown").notNull(), // { weather: n, labor: n, geopolitical: n, congestion: n }
  baseTransitDays: int("baseTransitDays").notNull(),
  alternativeRoutes: json("alternativeRoutes"), // [{name, transitDays, riskScore, waypoints, costImpact}]
  riskNarrative: text("riskNarrative"), // full agent narrative from Hermes
  intelligenceSummary: text("intelligenceSummary"), // Athena's intelligence summary
  dataSources: json("dataSources"), // [{name, count, ok}] provenance
  queryText: text("queryText"), // original NL query if from terminal
  evaluatedAt: timestamp("evaluatedAt").defaultNow().notNull(),
});

export type RouteEvaluation = typeof routeEvaluations.$inferSelect;
export type InsertRouteEvaluation = typeof routeEvaluations.$inferInsert;

// ── Heartbeat Jobs ────────────────────────────────────────────────────────────
export const heartbeatJobs = mysqlTable("heartbeat_jobs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  taskUid: varchar("taskUid", { length: 65 }),
  description: text("description"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HeartbeatJob = typeof heartbeatJobs.$inferSelect;
