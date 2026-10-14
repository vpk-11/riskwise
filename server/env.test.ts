import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return (await import("./_core/env")).ENV;
  } finally {
    process.env = saved;
  }
}

afterEach(() => vi.resetModules());

describe("ENV", () => {
  it("treats blank values as unset so defaults apply", async () => {
    const env = await loadEnv({
      RISKWISE_LLM_API_KEY: "",
      RISKWISE_LLM_MODEL: "",
      RISKWISE_ATHENA_LLM_API_KEY: "",
      LOG_LEVEL: "",
    });
    expect(env.RISKWISE_LLM_API_KEY).toBe("ollama");
    expect(env.RISKWISE_LLM_MODEL).toBe("mistral");
    expect(env.RISKWISE_ATHENA_LLM_API_KEY).toBeUndefined();
    expect(env.LOG_LEVEL).toBeUndefined();
  });

  it("keeps real values", async () => {
    const env = await loadEnv({ RISKWISE_LLM_MODEL: "gpt-oss:20b", RISKWISE_EVAL_LIMIT_PER_HOUR: "3" });
    expect(env.RISKWISE_LLM_MODEL).toBe("gpt-oss:20b");
    expect(env.RISKWISE_EVAL_LIMIT_PER_HOUR).toBe(3);
  });

  it("exits when DATABASE_URL is missing", async () => {
    vi.resetModules();
    const saved = { ...process.env };
    delete process.env.DATABASE_URL;
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(import("./_core/env")).rejects.toThrow("exit");
      expect(err.mock.calls.flat().join(" ")).toContain("DATABASE_URL");
    } finally {
      process.env = saved;
      exit.mockRestore();
      err.mockRestore();
    }
  });
});
