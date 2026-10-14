import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ checkLlm: vi.fn() }));
vi.mock("./_core/llm", () => llm);

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const caller = () => appRouter.createCaller({ req: { ip: "1.1.1.1", headers: {} }, res: {} } as unknown as TrpcContext);

beforeEach(() => vi.clearAllMocks());

describe("system.llm", () => {
  it("reports the LLM status and caches it for the polling UI", async () => {
    llm.checkLlm.mockResolvedValue({ status: "model_missing", model: "mistral", baseUrl: "http://x/v1", installed: ["gpt-oss:20b"], detail: "missing" });
    const first = await caller().system.llm();
    const second = await caller().system.llm();
    expect(first.status).toBe("model_missing");
    expect(second).toEqual(first);
    expect(llm.checkLlm).toHaveBeenCalledTimes(1);
  });
});

describe("system.health", () => {
  it("answers without touching the LLM", async () => {
    expect(await caller().system.health({ timestamp: 1 })).toEqual({ ok: true });
    expect(llm.checkLlm).not.toHaveBeenCalled();
  });
});
