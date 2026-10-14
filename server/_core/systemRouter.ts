import { z } from "zod";
import { checkLlm, type LlmStatus } from "./llm";
import { publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /** Whether the configured LLM endpoint is up and has the configured model. Cached briefly: the UI polls it. */
  llm: publicProcedure.query((): Promise<LlmStatus> => cachedLlmStatus()),
});

const LLM_STATUS_TTL_MS = 30_000;
let llmStatus: { at: number; value: Promise<LlmStatus> } | null = null;

export function cachedLlmStatus(): Promise<LlmStatus> {
  if (!llmStatus || Date.now() - llmStatus.at > LLM_STATUS_TTL_MS) llmStatus = { at: Date.now(), value: checkLlm() };
  return llmStatus.value;
}
