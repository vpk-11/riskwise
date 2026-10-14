import { describe, expect, it } from "vitest";
import type { LngLat } from "@shared/ports";
import { distanceToPolylineKm } from "@shared/geo";
import { DEDUPE_KM, PROXIMITY_CUTOFF_KM, scoreRoute, transitDays, type ScorableEvent } from "./scoring";

// A route along the equator from 0E to 10E.
const ROUTE: LngLat[] = [
  [0, 0],
  [10, 0],
];

const event = (over: Partial<ScorableEvent>): ScorableEvent => ({
  title: "Event",
  category: "Geopolitical",
  severity: "Critical",
  affectedLocations: [],
  coordinates: [5, 0],
  ...over,
});

describe("scoreRoute", () => {
  it("scores zero with no events", () => {
    const score = scoreRoute(ROUTE, []);
    expect(score.overall).toBe(0);
    expect(score.breakdown).toEqual({ weather: 0, labor: 0, geopolitical: 0, congestion: 0 });
    expect(score.primaryFactor).toBeNull();
    expect(score.drivers).toEqual([]);
  });

  it("pins exact scores for fixed events", () => {
    // Critical geopolitical on the route: 0.9 x 1.0 x 1.0 = 90
    expect(scoreRoute(ROUTE, [event({})]).overall).toBe(90);
    // Medium weather on the route: 0.3 x 0.9 x 1.0 = 27
    expect(scoreRoute(ROUTE, [event({ category: "Weather", severity: "Medium" })]).overall).toBe(27);
    // Both: noisy-OR 100 x (1 - 0.1 x 0.73) = 92.7
    const both = scoreRoute(ROUTE, [event({}), event({ title: "Storm", category: "Weather", severity: "Medium" })]);
    expect(both.overall).toBe(93);
    expect(both.breakdown).toEqual({ weather: 27, labor: 0, geopolitical: 90, congestion: 0 });
    expect(both.primaryFactor).toBe("geopolitical");
  });

  it("maps categories to factors", () => {
    const strike = scoreRoute(ROUTE, [event({ category: "Strike", severity: "High" })]);
    expect(strike.breakdown.labor).toBe(48); // 0.6 x 0.8
    expect(strike.primaryFactor).toBe("labor");
    const congestion = scoreRoute(ROUTE, [event({ category: "Port Congestion", severity: "High" })]);
    expect(congestion.breakdown.congestion).toBe(42); // 0.6 x 0.7
  });

  it("lowers the score when the same event moves farther from the route", () => {
    const at = (latDeg: number) => scoreRoute(ROUTE, [event({ coordinates: [5, latDeg] })]).overall;
    // 1 degree of latitude is about 111 km
    expect(at(0)).toBeGreaterThan(at(3));
    expect(at(3)).toBeGreaterThan(at(8));
    expect(at(8)).toBeGreaterThan(at(12));
  });

  it("scores zero at and beyond the proximity cutoff", () => {
    const farLat = (PROXIMITY_CUTOFF_KM / 111.195) + 0.5;
    expect(scoreRoute(ROUTE, [event({ coordinates: [5, farLat] })]).overall).toBe(0);
  });

  it("halves the contribution at half the cutoff distance", () => {
    const halfLat = PROXIMITY_CUTOFF_KM / 2 / 111.195;
    expect(scoreRoute(ROUTE, [event({ coordinates: [5, halfLat] })]).overall).toBe(45);
  });

  it("is deterministic", () => {
    const events = [event({}), event({ title: "B", category: "Strike", severity: "Low", coordinates: [2, 1] })];
    expect(scoreRoute(ROUTE, events)).toEqual(scoreRoute(ROUTE, events));
  });

  it("counts same-category events in one region once, at the highest severity", () => {
    const route: LngLat[] = [[30, 30], [35, 30]];
    const loc = { coordinates: undefined, affectedLocations: ["Suez Canal"] };
    const one = scoreRoute(route, [event({ ...loc, severity: "High" })]);
    const many = scoreRoute(route, [
      event({ ...loc, title: "A", severity: "High" }),
      event({ ...loc, title: "B", severity: "High" }),
      event({ ...loc, title: "C", severity: "Medium" }),
    ]);
    expect(many.overall).toBe(one.overall);
    expect(many.drivers).toHaveLength(1);
  });

  it("counts two reports of one physical event once, even with different titles", () => {
    const one = scoreRoute(ROUTE, [event({ title: "M6.1 Earthquake: Off coast", coordinates: [5, 0.2] })]);
    const two = scoreRoute(ROUTE, [
      event({ title: "M6.1 Earthquake: Off coast", coordinates: [5, 0.2] }),
      event({ title: "Strong quake strikes near shore", coordinates: [5.1, 0.2] }),
    ]);
    expect(two.overall).toBe(one.overall);
    expect(two.drivers).toHaveLength(1);
  });

  it("merges reports straddling a whole-degree line (5.49 and 5.51 are 2 km apart)", () => {
    const one = scoreRoute(ROUTE, [event({ title: "A", coordinates: [5.49, 0.3] })]);
    const two = scoreRoute(ROUTE, [event({ title: "A", coordinates: [5.49, 0.3] }), event({ title: "B", coordinates: [5.51, 0.3] })]);
    expect(two.overall).toBe(one.overall);
    expect(two.drivers).toHaveLength(1);
  });

  it(`counts same-category events farther apart than ${DEDUPE_KM} km separately`, () => {
    // 1.5 degrees of longitude on the equator is about 167 km
    const far = scoreRoute(ROUTE, [event({ title: "A", coordinates: [4, 0] }), event({ title: "B", coordinates: [5.5, 0] })]);
    expect(far.drivers).toHaveLength(2);
    expect(far.overall).toBeGreaterThan(scoreRoute(ROUTE, [event({ title: "A", coordinates: [4, 0] })]).overall);
  });

  it("never merges events of different categories, even at the same spot", () => {
    const score = scoreRoute(ROUTE, [event({ title: "Storm", category: "Weather" }), event({ title: "Attack", category: "Geopolitical" })]);
    expect(score.drivers).toHaveLength(2);
  });

  it("gives the same result whatever order the events arrive in", () => {
    const events = [
      event({ title: "A", coordinates: [3, 0.1], severity: "High" }),
      event({ title: "B", coordinates: [3.4, 0.2], severity: "Critical" }),
      event({ title: "C", coordinates: [7, 0.3], severity: "Medium" }),
      event({ title: "D", coordinates: [7.3, 0.3], severity: "Low" }),
    ];
    const forward = scoreRoute(ROUTE, events);
    const backward = scoreRoute(ROUTE, [...events].reverse());
    expect(backward).toEqual(forward);
    // the strongest report of each cluster represents it
    expect(forward.drivers.map((d) => d.title).sort()).toEqual(["B", "C"]);
  });

  it("represents a chain by its strongest report and keeps a report beyond the radius of it", () => {
    // A to B 80 km, B to C 80 km, A to C 160 km. A is strongest: B is merged into A, C survives.
    const km = (x: number) => x / 111.195; // degrees of longitude on the equator
    const score = scoreRoute(ROUTE, [
      event({ title: "A", coordinates: [5, 0], severity: "Critical" }),
      event({ title: "B", coordinates: [5 + km(80), 0], severity: "High" }),
      event({ title: "C", coordinates: [5 + km(160), 0], severity: "High" }),
    ]);
    expect(score.drivers.map((d) => d.title).sort()).toEqual(["A", "C"]);
  });

  it("never lets a non-finite coordinate produce a NaN score", () => {
    const bad = [
      event({ coordinates: [NaN, 0] }),
      event({ title: "inf", coordinates: [Infinity, 0] }),
      event({ title: "short", coordinates: [5] as unknown as [number, number] }),
    ];
    const score = scoreRoute(ROUTE, bad);
    expect(Number.isNaN(score.overall)).toBe(false);
    expect(score.overall).toBe(0);
    expect(Object.values(score.breakdown).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("ignores events whose location cannot be resolved", () => {
    const score = scoreRoute(ROUTE, [event({ coordinates: undefined, affectedLocations: ["Port Operations"] })]);
    expect(score.overall).toBe(0);
  });

  it("never exceeds 100 and orders drivers by contribution", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      event({ title: `E${i}`, coordinates: [i / 2, 0], severity: i % 2 ? "Critical" : "High" }),
    );
    const score = scoreRoute(ROUTE, many);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.drivers.length).toBeLessThanOrEqual(5);
    const contributions = score.drivers.map((d) => d.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });

  it("reports distance to the route in each driver", () => {
    const score = scoreRoute(ROUTE, [event({ coordinates: [5, 1] })]);
    const expected = Math.round(distanceToPolylineKm([5, 1], ROUTE));
    expect(score.drivers[0].distanceKm).toBe(expected);
  });
});

describe("transitDays", () => {
  it("converts distance at 14 knots", () => {
    expect(transitDays(0)).toBe(0);
    expect(transitDays(622)).toBe(1);
    expect(transitDays(18_700)).toBe(30);
  });
});
