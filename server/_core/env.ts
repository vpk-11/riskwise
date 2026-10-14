import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Global LLM config — used by all agents unless overridden below
  RISKWISE_LLM_BASE_URL: z.string().default("http://localhost:11434/v1"),
  RISKWISE_LLM_API_KEY: z.string().default("ollama"),
  RISKWISE_LLM_MODEL: z.string().default("mistral"),

  // Per-agent LLM overrides — fall back to global if not set
  // Athena (intelligence researcher) — fast/cheap model is fine
  RISKWISE_ATHENA_LLM_BASE_URL: z.string().optional(),
  RISKWISE_ATHENA_LLM_API_KEY: z.string().optional(),
  RISKWISE_ATHENA_LLM_MODEL: z.string().optional(),

  // Hermes (risk modeler) — use best model for accuracy
  RISKWISE_HERMES_LLM_BASE_URL: z.string().optional(),
  RISKWISE_HERMES_LLM_API_KEY: z.string().optional(),
  RISKWISE_HERMES_LLM_MODEL: z.string().optional(),

  // Apollo (route optimizer) — medium capability sufficient
  RISKWISE_APOLLO_LLM_BASE_URL: z.string().optional(),
  RISKWISE_APOLLO_LLM_API_KEY: z.string().optional(),
  RISKWISE_APOLLO_LLM_MODEL: z.string().optional(),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  RISKWISE_ALERT_WEBHOOK_URL: z.string().optional(),
  PORT: z.string().optional(),

  // Max route evaluations per client IP per hour (each one costs LLM calls). 0 disables the limit.
  RISKWISE_EVAL_LIMIT_PER_HOUR: z.coerce.number().int().min(0).default(10),
});

// A blank assignment such as RISKWISE_LLM_API_KEY= in a dotenv file must mean "unset", not an empty override of the default.
const nonEmpty = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));

const parsed = envSchema.safeParse(nonEmpty);

if (!parsed.success) {
  console.error("[Env] Invalid or missing environment variables:");
  for (const [key, issues] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${issues?.join(", ")}`);
  }
  process.exit(1);
}

export const ENV = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
};
