import pino, { type Logger } from "pino";
import { ENV } from "./env";

const level = ENV.LOG_LEVEL ?? (ENV.isProduction ? "info" : "debug");

const baseOptions: pino.LoggerOptions = {
  level,
  base: { service: "riskwise", env: ENV.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive fields anywhere in the log object
  redact: {
    paths: [
      "req.headers.authorization",
      "*.password",
      "*.password_hash",
      "*.jwt",
      "*.api_key",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
};

export const logger: Logger = ENV.isProduction
  ? pino(baseOptions)
  : pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, ignore: "pid,hostname" },
      },
    });

/**
 * Create a child logger scoped to a named component.
 * Use this at the top of each module: `const log = createLogger("realtime")`
 */
export function createLogger(component: string): Logger {
  return logger.child({ component });
}

/**
 * Audit logger — always emits JSON (never pretty-printed), always at info+.
 * Filter on `audit: true` in your log aggregator to route to a separate sink:
 *   AWS: separate CloudWatch log group via subscription filter
 *   GCP: separate Log Router sink on jsonPayload.audit=true
 *   Azure: separate Log Analytics table via DCR transformation
 */
export const auditLogger = logger.child({ component: "audit", audit: true });

// ── Agent telemetry ───────────────────────────────────────────────────────────

export interface AgentTelemetry {
  agent: "athena" | "hermes" | "apollo" | "athena-scan";
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  success: boolean;
  error?: string;
  route?: { origin: string; destination: string };
}

const telemetryLogger = createLogger("agent-telemetry");

export function logAgentTelemetry(t: AgentTelemetry): void {
  const entry = { event: "llm_call", ...t };
  if (t.success) {
    telemetryLogger.info(entry, `[${t.agent}] done in ${t.latencyMs}ms model=${t.model}`);
  } else {
    telemetryLogger.error(entry, `[${t.agent}] failed after ${t.latencyMs}ms model=${t.model}`);
  }
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

export function logRouteEvaluation(data: {
  requestId?: string;
  origin: string;
  destination: string;
  overallRiskScore: number;
  primaryRiskFactor: string;
  durationMs: number;
  agentsInvoked: string[];
  dataSourcesOk: number;
  dataSourcesFailed: number;
}): void {
  auditLogger.info(
    { event: "route_evaluation", ...data },
    `EVAL ${data.origin} -> ${data.destination} score=${data.overallRiskScore} [${data.durationMs}ms]`,
  );
}

export function logAthenaScan(data: {
  source: "live" | "llm-fallback";
  provider?: string;
  title: string;
  severity: string;
  category: string;
  durationMs: number;
  success: boolean;
  error?: string;
}): void {
  auditLogger.info(
    { event: "athena_scan", ...data },
    `SCAN source=${data.source} severity=${data.severity} [${data.durationMs}ms]`,
  );
}
