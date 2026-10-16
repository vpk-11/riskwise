import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ activeRiskEventExists: vi.fn(), insertRiskEvent: vi.fn() }));
vi.mock("./db", () => db);

const realtime = vi.hoisted(() => ({ fetchAllRealTimeIntelligence: vi.fn() }));
vi.mock("./realtime", async (importOriginal) => ({ ...(await importOriginal<typeof import("./realtime")>()), ...realtime }));

const llm = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/llm", () => llm);

import { athenaHourlyScan } from "./scheduledHandlers";
import { BASELINE_PROVIDER, type LiveRiskEvent } from "./realtime";

const live = (over: Partial<LiveRiskEvent> = {}): LiveRiskEvent => ({
  title: "M6.1 Earthquake: Taiwan",
  description: "USGS report",
  category: "Weather",
  severity: "High",
  affectedLocations: ["Taiwan Strait"],
  sourceProvider: "USGS Earthquake Hazards",
  sourceUrl: "https://earthquake.usgs.gov/x",
  fetchedAt: "2026-10-13T00:00:00Z",
  coordinates: [142.5, 38.1],
  ...over,
});

const feed = (events: LiveRiskEvent[]) => ({ events, fetchedAt: "now", sources: [] });

beforeEach(() => {
  vi.clearAllMocks();
  db.activeRiskEventExists.mockResolvedValue(false);
  db.insertRiskEvent.mockResolvedValue(undefined);
});

describe("athenaHourlyScan", () => {
  it("stores the top live event labelled as live", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([live()]));
    await athenaHourlyScan();
    expect(db.insertRiskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "M6.1 Earthquake: Taiwan", sourceType: "live", sourceUrl: "https://earthquake.usgs.gov/x" }),
    );
    expect(db.insertRiskEvent.mock.calls[0][0].description).toMatch(/^\[Live - USGS Earthquake Hazards\]/);
  });

  it("stores the exact coordinates the source provided", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([live()]));
    await athenaHourlyScan();
    expect(db.insertRiskEvent).toHaveBeenCalledWith(expect.objectContaining({ longitude: 142.5, latitude: 38.1 }));
  });

  it("stores null coordinates when the source has none", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([live({ coordinates: undefined })]));
    await athenaHourlyScan();
    expect(db.insertRiskEvent).toHaveBeenCalledWith(expect.objectContaining({ longitude: null, latitude: null }));
  });

  it("never stores a baseline entry as a live event", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(
      feed([live({ sourceProvider: BASELINE_PROVIDER, title: "Elevated Country Risk: Yemen" })]),
    );
    await athenaHourlyScan();
    expect(db.insertRiskEvent).not.toHaveBeenCalled();
  });

  it("stores nothing and never calls the LLM when no live event exists", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([]));
    await athenaHourlyScan();
    expect(db.insertRiskEvent).not.toHaveBeenCalled();
    expect(llm.invokeLLM).not.toHaveBeenCalled();
  });

  it("skips an event that is already stored", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([live()]));
    db.activeRiskEventExists.mockResolvedValue(true);
    await athenaHourlyScan();
    expect(db.insertRiskEvent).not.toHaveBeenCalled();
  });

  it("rethrows insert failures", async () => {
    realtime.fetchAllRealTimeIntelligence.mockResolvedValue(feed([live()]));
    db.insertRiskEvent.mockRejectedValue(new Error("db down"));
    await expect(athenaHourlyScan()).rejects.toThrow("db down");
  });
});
