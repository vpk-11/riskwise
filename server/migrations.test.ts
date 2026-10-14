import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../drizzle", `${name}.sql`), "utf8");

async function dbAt0000() {
  const db = new PGlite();
  await db.exec(read("0000_init"));
  return db;
}

describe("migration 0001_risk_event_source_type", () => {
  it("backfills existing rows by description prefix and enforces NOT NULL", async () => {
    const db = await dbAt0000();
    const insert = (title: string, description: string) =>
      db.query(
        `INSERT INTO risk_events (title, description, category, severity, affected_locations) VALUES ($1, $2, 'Weather', 'High', '[]')`,
        [title, description],
      );
    await insert("rss", "[Live - BBC World] real headline");
    await insert("rss legacy", "[Live — NASA EONET] older format");
    await insert("osiris", "[Live - Osiris Country Risk Index] baseline");
    await insert("fabricated", "Typhoon Khanun disrupts shipping (LLM output, no prefix)");

    await db.exec(read("0001_risk_event_source_type"));

    const rows = (await db.query<{ title: string; source_type: string }>(`SELECT title, source_type FROM risk_events ORDER BY id`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.title, r.source_type]))).toEqual({
      rss: "live",
      "rss legacy": "live",
      osiris: "baseline",
      fabricated: "llm-synthetic",
    });

    await expect(
      db.query(`INSERT INTO risk_events (title, description, category, severity, affected_locations) VALUES ('x','y','Weather','High','[]')`),
    ).rejects.toThrow(/source_type/);
  });

  it("applies cleanly on an empty table", async () => {
    const db = await dbAt0000();
    await db.exec(read("0001_risk_event_source_type"));
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM risk_events`);
    expect(rows[0].n).toBe(0);
  });
});

describe("migration 0003_risk_event_coordinates", () => {
  it("adds nullable coordinates and keeps existing rows", async () => {
    const db = await dbAt0000();
    await db.exec(read("0001_risk_event_source_type"));
    await db.query(
      `INSERT INTO risk_events (title, description, category, severity, affected_locations, source_type) VALUES ('old','[Live - x] d','Weather','High','[]','live')`,
    );
    await db.exec(read("0003_risk_event_coordinates"));
    await db.query(
      `INSERT INTO risk_events (title, description, category, severity, affected_locations, source_type, longitude, latitude) VALUES ('new','[Live - x] d','Weather','High','[]','live', 142.5, 38.1)`,
    );
    const { rows } = await db.query<{ title: string; longitude: number | null; latitude: number | null }>(
      `SELECT title, longitude, latitude FROM risk_events ORDER BY id`,
    );
    expect(rows).toEqual([
      { title: "old", longitude: null, latitude: null },
      { title: "new", longitude: 142.5, latitude: 38.1 },
    ]);
  });
});

describe("migration 0002_drop_users", () => {
  it("drops an empty users table and role type, leaving events intact", async () => {
    const db = await dbAt0000();
    await db.exec(read("0001_risk_event_source_type"));
    await db.query(
      `INSERT INTO risk_events (title, description, category, severity, affected_locations, source_type) VALUES ('a','[Live - x] d','Weather','High','[]','live')`,
    );
    await db.exec(read("0002_drop_users"));
    await expect(db.query(`SELECT 1 FROM users`)).rejects.toThrow();
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM risk_events`);
    expect(rows[0].n).toBe(1);
  });

  it("leaves a users table that has rows in place", async () => {
    const db = await dbAt0000();
    await db.query(`INSERT INTO users (email) VALUES ('keep@example.com')`);
    await db.exec(read("0002_drop_users"));
    const { rows } = await db.query<{ email: string }>(`SELECT email FROM users`);
    expect(rows).toEqual([{ email: "keep@example.com" }]);
  });

  it("is safe to run twice", async () => {
    const db = await dbAt0000();
    await db.exec(read("0002_drop_users"));
    await db.exec(read("0002_drop_users"));
  });
});
