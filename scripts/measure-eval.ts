/**
 * End-to-end evaluation latency over N runs on the configured LLM.
 * Usage: DATABASE_URL=postgresql://unused RISKWISE_LLM_MODEL=<model> pnpm tsx scripts/measure-eval.ts [runs=20] ["Port of Shanghai" "Port of Rotterdam"]
 * Feeds are cached after the first run, so later runs mostly time the LLM calls.
 */
import { orchestrate } from "../server/agents";
import { ENV } from "../server/_core/env";

const runs = Number(process.argv[2] ?? 20);
// The route must score above 50 for the Apollo agent (most of the LLM calls) to run. A score of 0 skips every LLM call.
const route = [process.argv[3] ?? "Port of Shanghai", process.argv[4] ?? "Port of Rotterdam"] as const;

// Only runs where every LLM call answered count toward latency. A failed run returns in milliseconds and would skew the percentiles.
const wall: number[] = [];
let failed = 0;
for (let i = 0; i < runs; i++) {
  const start = Date.now();
  const r = await orchestrate(route[0], route[1], []);
  const ms = Date.now() - start;
  if (r.llmDegraded) failed++;
  else wall.push(ms);
  console.log(`run ${i + 1}/${runs}: ${ms} ms score=${r.overallRiskScore} apollo=${r.alternativeRoutes.length > 0} ${r.llmDegraded ? "LLM FAILED (excluded)" : "ok"}`);
}

const sorted = [...wall].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
console.log(`date=${new Date().toISOString()} model=${ENV.RISKWISE_LLM_MODEL} runs=${runs} valid=${wall.length} route=${route.join(" -> ")}`);
console.log(wall.length === 0 ? "no valid runs" : `p50=${pct(0.5)} ms p95=${pct(0.95)} ms min=${sorted[0]} ms max=${sorted.at(-1)} ms llm_failures=${failed}`);
