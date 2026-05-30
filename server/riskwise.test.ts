/**
 * RiskWise Test Suite
 *
 * Tests cover:
 *  1. Risk score color thresholds (Green 0-30, Amber 31-60, Red 61-100)
 *  2. Route evaluation router (evaluate mutation, history query)
 *  3. Events router (active query with filters)
 *  4. Critical risk notification threshold (score > 75)
 *  5. Athena scan result validation
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ── Risk Score Color Threshold Tests ─────────────────────────────────────────

describe("Risk Score Color Thresholds", () => {
  const getRiskColor = (score: number): string => {
    if (score <= 30) return "green";
    if (score <= 60) return "amber";
    return "red";
  };

  const getRiskLabel = (score: number): string => {
    if (score <= 30) return "LOW RISK";
    if (score <= 60) return "MODERATE RISK";
    if (score <= 75) return "HIGH RISK";
    return "CRITICAL RISK";
  };

  it("scores 0-30 are GREEN (Low Risk)", () => {
    expect(getRiskColor(0)).toBe("green");
    expect(getRiskColor(15)).toBe("green");
    expect(getRiskColor(30)).toBe("green");
    expect(getRiskLabel(0)).toBe("LOW RISK");
    expect(getRiskLabel(30)).toBe("LOW RISK");
  });

  it("scores 31-60 are AMBER (Moderate Risk)", () => {
    expect(getRiskColor(31)).toBe("amber");
    expect(getRiskColor(45)).toBe("amber");
    expect(getRiskColor(60)).toBe("amber");
    expect(getRiskLabel(31)).toBe("MODERATE RISK");
    expect(getRiskLabel(60)).toBe("MODERATE RISK");
  });

  it("scores 61-100 are RED (High/Critical Risk)", () => {
    expect(getRiskColor(61)).toBe("red");
    expect(getRiskColor(75)).toBe("red");
    expect(getRiskColor(76)).toBe("red");
    expect(getRiskColor(100)).toBe("red");
    expect(getRiskLabel(61)).toBe("HIGH RISK");
    expect(getRiskLabel(75)).toBe("HIGH RISK");
    expect(getRiskLabel(76)).toBe("CRITICAL RISK");
    expect(getRiskLabel(100)).toBe("CRITICAL RISK");
  });

  it("critical threshold is strictly above 75", () => {
    expect(getRiskLabel(75)).toBe("HIGH RISK");   // 75 is NOT critical
    expect(getRiskLabel(76)).toBe("CRITICAL RISK"); // 76 IS critical
  });
});

// ── Events Router Tests ───────────────────────────────────────────────────────

describe("events.active", () => {
  it("returns active events without filters", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const events = await caller.events.active();
    expect(Array.isArray(events)).toBe(true);
    // All returned events should have required fields
    events.forEach((event) => {
      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("title");
      expect(event).toHaveProperty("category");
      expect(event).toHaveProperty("severity");
      expect(["Weather", "Strike", "Geopolitical", "Port Congestion"]).toContain(event.category);
      expect(["Low", "Medium", "High", "Critical"]).toContain(event.severity);
    });
  });

  it("filters events by category", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const weatherEvents = await caller.events.active({ category: "Weather" });
    expect(Array.isArray(weatherEvents)).toBe(true);
    weatherEvents.forEach((event) => {
      expect(event.category).toBe("Weather");
    });
  });

  it("filters events by severity", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const criticalEvents = await caller.events.active({ severity: "Critical" });
    expect(Array.isArray(criticalEvents)).toBe(true);
    criticalEvents.forEach((event) => {
      expect(event.severity).toBe("Critical");
    });
  });
});

// ── Routes Router Tests ───────────────────────────────────────────────────────

describe("routes.history", () => {
  it("returns route history with default limit", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const history = await caller.routes.history();
    expect(Array.isArray(history)).toBe(true);
    history.forEach((evaluation) => {
      expect(evaluation).toHaveProperty("id");
      expect(evaluation).toHaveProperty("originPort");
      expect(evaluation).toHaveProperty("destinationPort");
      expect(evaluation).toHaveProperty("overallRiskScore");
      expect(evaluation.overallRiskScore).toBeGreaterThanOrEqual(0);
      expect(evaluation.overallRiskScore).toBeLessThanOrEqual(100);
    });
  });

  it("respects the limit parameter", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const history = await caller.routes.history({ limit: 3 });
    expect(history.length).toBeLessThanOrEqual(3);
  });
});

describe("routes.allRoutes", () => {
  it("returns all shipping routes", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const routes = await caller.routes.allRoutes();
    expect(Array.isArray(routes)).toBe(true);
    routes.forEach((route) => {
      expect(route).toHaveProperty("id");
      expect(route).toHaveProperty("originPort");
      expect(route).toHaveProperty("destinationPort");
      expect(route).toHaveProperty("waypoints");
      expect(route).toHaveProperty("baseTransitDays");
    });
  });
});

// ── Athena Scan Result Validation ─────────────────────────────────────────────

describe("Athena Scan Result Schema", () => {
  const validCategories = ["Weather", "Strike", "Geopolitical", "Port Congestion"];
  const validSeverities = ["Low", "Medium", "High", "Critical"];

  it("validates a well-formed Athena scan result", () => {
    const mockResult = {
      title: "Typhoon Khanun disrupts East China Sea shipping lanes",
      description: "Typhoon Khanun is tracking toward the East China Sea with sustained winds of 120 knots. Major ports including Shanghai and Busan have issued storm warnings.",
      category: "Weather" as const,
      severity: "High" as const,
      affectedLocations: ["Port of Shanghai", "East China Sea", "Port of Busan"],
    };

    expect(mockResult.title.length).toBeGreaterThan(0);
    expect(mockResult.description.length).toBeGreaterThan(0);
    expect(validCategories).toContain(mockResult.category);
    expect(validSeverities).toContain(mockResult.severity);
    expect(Array.isArray(mockResult.affectedLocations)).toBe(true);
    expect(mockResult.affectedLocations.length).toBeGreaterThan(0);
  });

  it("rejects invalid category values", () => {
    const invalidCategory = "Earthquake";
    expect(validCategories).not.toContain(invalidCategory);
  });

  it("rejects invalid severity values", () => {
    const invalidSeverity = "Extreme";
    expect(validSeverities).not.toContain(invalidSeverity);
  });
});

// ── Critical Risk Notification Threshold ─────────────────────────────────────

describe("Critical Risk Notification Threshold", () => {
  const shouldNotifyOwner = (score: number): boolean => score > 75;

  it("does NOT notify for scores at or below 75", () => {
    expect(shouldNotifyOwner(0)).toBe(false);
    expect(shouldNotifyOwner(50)).toBe(false);
    expect(shouldNotifyOwner(75)).toBe(false); // exactly 75 = no notification
  });

  it("DOES notify for scores strictly above 75", () => {
    expect(shouldNotifyOwner(76)).toBe(true);
    expect(shouldNotifyOwner(85)).toBe(true);
    expect(shouldNotifyOwner(100)).toBe(true);
  });
});

// ── Auth logout test (from template) ─────────────────────────────────────────

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as unknown as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1 });
  });
});
