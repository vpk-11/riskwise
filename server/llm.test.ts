import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLlm, invokeLLM } from "./_core/llm";

afterEach(() => vi.unstubAllGlobals());

describe("invokeLLM", () => {
  it("sends the request with an abort signal so a hung endpoint cannot stall a request forever", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ id: "x", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchFn);
    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("checkLlm", () => {
  const models = (...ids: string[]) => vi.fn(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }));

  it("is ready when the model is listed", async () => {
    vi.stubGlobal("fetch", models("gpt-oss:20b"));
    const r = await checkLlm({ model: "gpt-oss:20b" });
    expect(r.status).toBe("ready");
    expect(r.installed).toEqual(["gpt-oss:20b"]);
  });

  it("matches a bare model name to its latest tag", async () => {
    vi.stubGlobal("fetch", models("mistral:latest"));
    expect((await checkLlm({ model: "mistral" })).status).toBe("ready");
  });

  it("does not treat a different model with the same prefix as a match", async () => {
    vi.stubGlobal("fetch", models("mistral-nemo:latest"));
    expect((await checkLlm({ model: "mistral" })).status).toBe("model_missing");
  });

  it("reports a missing model with what is installed", async () => {
    vi.stubGlobal("fetch", models("gpt-oss:20b", "llama3:8b"));
    const r = await checkLlm({ model: "mistral" });
    expect(r.status).toBe("model_missing");
    expect(r.detail).toContain("mistral");
    expect(r.detail).toContain("gpt-oss:20b");
    expect(r.detail).toContain("RISKWISE_LLM_MODEL");
  });

  it("reports an unreachable endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const r = await checkLlm({ model: "x" });
    expect(r.status).toBe("unreachable");
    expect(r.detail).toContain("fetch failed");
  });

  it("says unknown, not missing, when the endpoint has no model list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await checkLlm({ model: "x" })).status).toBe("unknown");
    vi.stubGlobal("fetch", models());
    expect((await checkLlm({ model: "x" })).status).toBe("unknown");
  });

  it("queries the configured base URL and sends the key", async () => {
    const fetchFn = models("m");
    vi.stubGlobal("fetch", fetchFn);
    await checkLlm({ model: "m", baseUrl: "https://llm.example/v1/", apiKey: "k" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/models");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });
});
