import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { riskEvents, routeEvaluations } from "../drizzle/schema";
import { activeRiskEventExists, getRecentLiveRiskEvents, getRouteTrend } from "./db";

const sql = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../drizzle", `${name}.sql`), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let db: ReturnType<typeof drizzle>;

const row = (over: Partial<typeof riskEvents.$inferInsert>): typeof riskEvents.$inferInsert => ({
  title: "t",
  description: "d",
  category: "Weather",
  severity: "High",
  affectedLocations: ["Red Sea"],
  sourceType: "live",
  isActive: true,
  createdAt: ago(1),
  ...over,
});

beforeAll(async () => {
  const client = new PGlite();
  for (const m of ["0000_init", "0001_risk_event_source_type", "0002_drop_users", "0003_risk_event_coordinates"]) {
    await client.exec(sql(m));
  }
  db = drizzle(client);
  await db.insert(riskEvents).values([
    row({ title: "recent live", sourceType: "live", createdAt: ago(1) }),
    row({ title: "recent live with coords", sourceType: "live", createdAt: ago(2), longitude: 142.5, latitude: 38.1 }),
    row({ title: "synthetic", sourceType: "llm-synthetic", createdAt: ago(1) }),
    row({ title: "baseline", sourceType: "baseline", createdAt: ago(1) }),
    row({ title: "old live", sourceType: "live", createdAt: ago(8) }),
    row({ title: "inactive live", sourceType: "live", isActive: false, createdAt: ago(1) }),
  ]);
  // 12 evaluations of one route, score = day index, plus one of another route
  await db.insert(routeEvaluations).values([
    ...Array.from({ length: 12 }, (_, i) => ({
      originPort: "Port of Shanghai",
      destinationPort: "Port of Rotterdam",
      overallRiskScore: i,
      primaryRiskFactor: "x",
      breakdown: {},
      baseTransitDays: 30,
      evaluatedAt: ago(20 - i),
    })),
    {
      originPort: "Port of Hamburg",
      destinationPort: "Port of New York",
      overallRiskScore: 99,
      primaryRiskFactor: "x",
      breakdown: {},
      baseTransitDays: 11,
      evaluatedAt: ago(1),
    },
  ]);
});

describe("getRecentLiveRiskEvents", () => {
  it("returns only active, live, recent rows, newest first", async () => {
    const titles = (await getRecentLiveRiskEvents(db)).map((e) => e.title);
    expect(titles).toEqual(["recent live", "recent live with coords"]);
  });

  it("never returns synthetic or baseline rows", async () => {
    const types = (await getRecentLiveRiskEvents(db)).map((e) => e.sourceType);
    expect(types.every((t) => t === "live")).toBe(true);
  });

  it("excludes rows older than 7 days", async () => {
    const titles = (await getRecentLiveRiskEvents(db)).map((e) => e.title);
    expect(titles).not.toContain("old live");
  });

  it("returns stored coordinates", async () => {
    const withCoords = (await getRecentLiveRiskEvents(db)).find((e) => e.title === "recent live with coords");
    expect([withCoords?.longitude, withCoords?.latitude]).toEqual([142.5, 38.1]);
  });
});

describe("getRouteTrend", () => {
  it("returns the latest evaluations of that route only, oldest first", async () => {
    const trend = await getRouteTrend("Port of Shanghai", "Port of Rotterdam", 10, db);
    expect(trend.map((t) => t.overallRiskScore)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("returns fewer rows when there are fewer evaluations", async () => {
    const trend = await getRouteTrend("Port of Hamburg", "Port of New York", 10, db);
    expect(trend.map((t) => t.overallRiskScore)).toEqual([99]);
  });
});

describe("activeRiskEventExists", () => {
  it("ignores a same-titled synthetic or baseline row, so it cannot block a live event", async () => {
    expect(await activeRiskEventExists("synthetic", db)).toBe(false);
    expect(await activeRiskEventExists("baseline", db)).toBe(false);
  });

  it("matches active rows by exact title only", async () => {
    expect(await activeRiskEventExists("recent live", db)).toBe(true);
    expect(await activeRiskEventExists("inactive live", db)).toBe(false);
    expect(await activeRiskEventExists("nothing like this", db)).toBe(false);
  });
});
