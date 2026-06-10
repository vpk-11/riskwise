import {
  boolean,
  integer,
  json,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const categoryEnum = pgEnum("risk_category", [
  "Weather",
  "Strike",
  "Geopolitical",
  "Port Congestion",
]);
export const severityEnum = pgEnum("risk_severity", [
  "Low",
  "Medium",
  "High",
  "Critical",
]);

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: text("name"),
  passwordHash: varchar("password_hash", { length: 255 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Risk Events ───────────────────────────────────────────────────────────────

export const riskEvents = pgTable("risk_events", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  category: categoryEnum("category").notNull(),
  severity: severityEnum("severity").notNull(),
  affectedLocations: json("affected_locations").notNull().$type<string[]>(),
  sourceUrl: text("source_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RiskEvent = typeof riskEvents.$inferSelect;
export type InsertRiskEvent = typeof riskEvents.$inferInsert;

// ── Shipping Routes ───────────────────────────────────────────────────────────

export const shippingRoutes = pgTable("shipping_routes", {
  id: serial("id").primaryKey(),
  originPort: varchar("origin_port", { length: 100 }).notNull(),
  destinationPort: varchar("destination_port", { length: 100 }).notNull(),
  waypoints: json("waypoints").notNull().$type<[number, number][]>(),
  baseTransitDays: integer("base_transit_days").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ShippingRoute = typeof shippingRoutes.$inferSelect;
export type InsertShippingRoute = typeof shippingRoutes.$inferInsert;

// ── Route Evaluations ─────────────────────────────────────────────────────────

export const routeEvaluations = pgTable("route_evaluations", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").references(() => shippingRoutes.id),
  originPort: varchar("origin_port", { length: 100 }).notNull(),
  destinationPort: varchar("destination_port", { length: 100 }).notNull(),
  overallRiskScore: integer("overall_risk_score").notNull(),
  primaryRiskFactor: text("primary_risk_factor").notNull(),
  breakdown: json("breakdown").notNull(),
  baseTransitDays: integer("base_transit_days").notNull(),
  alternativeRoutes: json("alternative_routes"),
  riskNarrative: text("risk_narrative"),
  intelligenceSummary: text("intelligence_summary"),
  dataSources: json("data_sources"),
  queryText: text("query_text"),
  evaluatedAt: timestamp("evaluated_at").defaultNow().notNull(),
});

export type RouteEvaluation = typeof routeEvaluations.$inferSelect;
export type InsertRouteEvaluation = typeof routeEvaluations.$inferInsert;
