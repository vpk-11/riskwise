/**
 * Per-source fetch latency (p50/p95) and failure rate over N forced runs.
 * Usage: DATABASE_URL=postgresql://unused pnpm tsx scripts/measure-feeds.ts [runs=50] [gapMs=2000]
 * DATABASE_URL only satisfies env validation; no connection is made.
 */
import { fetchAllRealTimeIntelligence } from "../server/realtime";

const runs = Number(process.argv[2] ?? 50);
const gapMs = Number(process.argv[3] ?? 2000);

const samples = new Map<string, { latency: number[]; failures: number }>();
for (let i = 0; i < runs; i++) {
  const { sources } = await fetchAllRealTimeIntelligence({ force: true });
  for (const s of sources) {
    const entry = samples.get(s.name) ?? { latency: [], failures: 0 };
    entry.latency.push(s.latencyMs);
    if (!s.ok) entry.failures++;
    samples.set(s.name, entry);
  }
  await new Promise((r) => setTimeout(r, gapMs));
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
console.log(`date=${new Date().toISOString()} runs=${runs} gapMs=${gapMs}`);
console.log("source | p50 ms | p95 ms | failures");
for (const [name, { latency, failures }] of samples) {
  const sorted = [...latency].sort((a, b) => a - b);
  console.log(`${name} | ${pct(sorted, 0.5)} | ${pct(sorted, 0.95)} | ${failures}/${runs}`);
}
