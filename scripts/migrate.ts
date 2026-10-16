/**
 * Applies drizzle/NNNN_*.sql in order, recording each in a _migrations table.
 * Usage: DATABASE_URL=... tsx scripts/migrate.ts   (bundled to dist/migrate.js by `pnpm build`)
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const dir = path.resolve("drizzle");
const sql = postgres(url, { max: 1 });

await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamp DEFAULT now() NOT NULL)`;
const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name as string));

// A database built by hand from 0000_init.sql predates the tracking table
if (applied.size === 0 && (await sql`SELECT to_regclass('risk_events') AS t`)[0].t) {
  await sql`INSERT INTO _migrations (name) VALUES ('0000_init')`;
  applied.add("0000_init");
}

const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
for (const file of files) {
  const name = file.replace(/\.sql$/, "");
  if (applied.has(name)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(path.join(dir, file), "utf8"));
    await tx`INSERT INTO _migrations (name) VALUES (${name})`;
  });
  console.log(`applied ${name}`);
}
console.log("migrations up to date");
await sql.end();
