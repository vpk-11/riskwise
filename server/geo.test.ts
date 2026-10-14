import { describe, expect, it } from "vitest";
import { PORT_NAMES, resolvePort } from "@shared/ports";
import {
  buildRoute,
  distanceToSegmentKm,
  eventPoints,
  haversineKm,
  avoidedChokepoints,
  candidateRoutes,
  CHOKEPOINTS,
  describeAlternative,
  LOCATION_POINTS,
  NoRouteError,
  unwrapAntimeridian,
} from "@shared/geo";

describe("haversineKm", () => {
  it("matches a known distance", () => {
    // London to Paris is about 344 km
    expect(haversineKm([-0.1276, 51.5072], [2.3522, 48.8566])).toBeGreaterThan(340);
    expect(haversineKm([-0.1276, 51.5072], [2.3522, 48.8566])).toBeLessThan(348);
  });
  it("is zero for the same point", () => {
    expect(haversineKm([10, 10], [10, 10])).toBe(0);
  });
});

describe("distanceToSegmentKm", () => {
  it("measures perpendicular distance inside the segment", () => {
    const km = distanceToSegmentKm([5, 1], [0, 0], [10, 0]);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });
  it("falls back to the nearest endpoint past the segment", () => {
    const km = distanceToSegmentKm([12, 0], [0, 0], [10, 0]);
    expect(km).toBeCloseTo(haversineKm([12, 0], [10, 0]), 0);
  });
  it("is zero on the segment", () => {
    expect(distanceToSegmentKm([5, 0], [0, 0], [10, 0])).toBeLessThan(0.5);
  });
});

describe("ports", () => {
  it("resolves case and prefix variants to the canonical name", () => {
    expect(resolvePort("rotterdam")).toBe("Port of Rotterdam");
    expect(resolvePort("  Port of  SHANGHAI ")).toBe("Port of Shanghai");
  });
  it("rejects unknown ports", () => {
    expect(resolvePort("Atlantis")).toBeNull();
    expect(resolvePort("")).toBeNull();
  });
  it("has a sea path between every pair of ports", () => {
    for (const a of PORT_NAMES) {
      for (const b of PORT_NAMES) {
        expect(() => buildRoute(a, b)).not.toThrow();
      }
    }
  });
});

describe("buildRoute", () => {
  it("routes Shanghai to Rotterdam through Malacca, Bab-el-Mandeb and Suez", () => {
    const route = buildRoute("Port of Shanghai", "Port of Rotterdam");
    expect(route.via).toEqual(expect.arrayContaining(["malacca", "bab_el_mandeb", "red_sea", "suez"]));
    expect(route.waypoints[0]).toEqual([121.8, 30.6]);
    expect(route.waypoints.at(-1)).toEqual([4.5, 51.9]);
    expect(route.distanceKm).toBeGreaterThan(17_000);
    expect(route.distanceKm).toBeLessThan(24_000);
  });

  it("crosses the Pacific for Shanghai to Los Angeles", () => {
    const route = buildRoute("Port of Shanghai", "Port of Los Angeles");
    expect(route.via).toContain("north_pacific");
    expect(route.via).not.toContain("suez");
  });

  it("is symmetric in distance", () => {
    const ab = buildRoute("Port of Singapore", "Port of Hamburg").distanceKm;
    const ba = buildRoute("Port of Hamburg", "Port of Singapore").distanceKm;
    expect(ab).toBeCloseTo(ba, 3);
  });

  it("throws on an unknown port", () => {
    expect(() => buildRoute("Port of Nowhere", "Port of Rotterdam")).toThrow(/Unknown port/);
  });
});

describe("avoiding chokepoints", () => {
  it("avoiding Suez forces a longer lane, and avoiding Suez and Panama forces the Cape", () => {
    const direct = buildRoute("Port of Shanghai", "Port of Rotterdam");
    const noSuez = buildRoute("Port of Shanghai", "Port of Rotterdam", ["suez"]);
    expect(noSuez.via).not.toContain("suez");
    expect(noSuez.distanceKm).toBeGreaterThan(direct.distanceKm);
    const cape = buildRoute("Port of Shanghai", "Port of Rotterdam", ["suez", "panama_east", "panama_west"]);
    expect(cape.via).toContain("cape_good_hope");
    expect(cape.distanceKm).toBeGreaterThan(noSuez.distanceKm);
  });

  it("never passes through any avoided node", () => {
    for (const node of CHOKEPOINTS) {
      try {
        expect(buildRoute("Port of Singapore", "Port of Hamburg", [node]).via).not.toContain(node);
      } catch (err) {
        expect(err).toBeInstanceOf(NoRouteError);
      }
    }
  });

  it("throws NoRouteError when the avoided node is the only way, or where the route starts", () => {
    expect(() => buildRoute("Port of Singapore", "Port of Dubai", ["singapore_strait"])).toThrow(NoRouteError);
    expect(() => buildRoute("Port of Dubai", "Port of Singapore", ["hormuz"])).toThrow(NoRouteError);
  });

  it("candidateRoutes returns distinct lanes, nearest first, none identical to the direct route", () => {
    const direct = buildRoute("Port of Shanghai", "Port of Rotterdam");
    const cands = candidateRoutes("Port of Shanghai", "Port of Rotterdam");
    expect(cands.length).toBeGreaterThan(0);
    const keys = cands.map((c) => c.route.via.join(">"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(direct.via.join(">"));
    const km = cands.map((c) => c.route.distanceKm);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    for (const c of cands) for (const a of c.avoids) expect(c.route.via).not.toContain(a);
  });

  it("candidateRoutes finds the second-best lane too (Cape after Panama)", () => {
    const vias = candidateRoutes("Port of Shanghai", "Port of Rotterdam").map((c) => c.route.via.join(">"));
    expect(vias.some((v) => v.includes("cape_good_hope"))).toBe(true);
    expect(vias.some((v) => v.includes("panama_west"))).toBe(true);
  });

  it("describeAlternative names the lanes an alternative adds, avoidedChokepoints names what it drops", () => {
    const direct = buildRoute("Port of Shanghai", "Port of Rotterdam");
    const cape = buildRoute("Port of Shanghai", "Port of Rotterdam", ["suez", "panama_east", "panama_west"]);
    expect(describeAlternative(direct, cape)).toMatch(/Cape of Good Hope/);
    expect(avoidedChokepoints(direct, cape)).toEqual(expect.arrayContaining(["Suez Canal", "Red Sea"]));
    expect(describeAlternative(direct, direct)).toBe("Alternative lane");
  });

  it("candidateRoutes is empty when the route has no chokepoint to avoid", () => {
    expect(candidateRoutes("Port of Shanghai", "Port of Busan")).toEqual([]);
  });
});

describe("route lengths against typical sea distances", () => {
  // Rough typical port-to-port distances in km (about 10,500 nm for Shanghai to Rotterdam via Suez, and so on).
  // These are sanity bands of +/-20%, not authoritative figures: they catch a graph that is badly wrong, not one that is slightly off.
  const typical: [string, string, number][] = [
    ["Port of Shanghai", "Port of Rotterdam", 19500],
    ["Port of Singapore", "Port of Rotterdam", 15400],
    ["Port of Mumbai", "Port of Rotterdam", 11700],
    ["Port of Hamburg", "Port of New York", 6850],
    ["Port of Shanghai", "Port of Los Angeles", 10500],
    ["Port of Singapore", "Port of Dubai", 6100],
  ];
  for (const [o, d, km] of typical) {
    it(`${o} to ${d} is within 20% of about ${km} km`, () => {
      const got = buildRoute(o, d).distanceKm;
      expect(got).toBeGreaterThan(km * 0.8);
      expect(got).toBeLessThan(km * 1.2);
    });
  }

  it("the Cape lane for Asia to Europe is longer than Suez but not absurdly so", () => {
    const suez = buildRoute("Port of Shanghai", "Port of Rotterdam").distanceKm;
    const cape = buildRoute("Port of Shanghai", "Port of Rotterdam", ["suez", "panama_east", "panama_west"]);
    expect(cape.via).toContain("cape_good_hope");
    expect(cape.distanceKm / suez).toBeGreaterThan(1.1);
    expect(cape.distanceKm / suez).toBeLessThan(1.45);
  });

  it("candidateRoutes never offers a detour longer than 1.6x the direct route", () => {
    for (const [o, d] of [["Port of Shanghai", "Port of Rotterdam"], ["Port of Singapore", "Port of Hamburg"], ["Port of Mumbai", "Port of New York"]]) {
      const direct = buildRoute(o, d).distanceKm;
      for (const c of candidateRoutes(o, d)) expect(c.route.distanceKm).toBeLessThanOrEqual(direct * 1.6);
    }
  });
});

describe("unwrapAntimeridian", () => {
  it("keeps consecutive longitudes within 180 degrees across the date line", () => {
    const line = unwrapAntimeridian([[145, 35], [-170, 42], [-125, 34]]);
    expect(line).toEqual([[145, 35], [190, 42], [235, 34]]);
  });
  it("leaves a line that does not cross unchanged", () => {
    expect(unwrapAntimeridian([[0, 0], [10, 5]])).toEqual([[0, 0], [10, 5]]);
  });
  it("makes the real Shanghai to Los Angeles route continuous", () => {
    const line = unwrapAntimeridian(buildRoute("Port of Shanghai", "Port of Los Angeles").waypoints);
    for (let i = 1; i < line.length; i++) expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThanOrEqual(180);
  });
});

describe("eventPoints", () => {
  it("prefers exact coordinates", () => {
    expect(eventPoints({ coordinates: [1, 2], affectedLocations: ["Red Sea"] })).toEqual([[1, 2]]);
  });
  it("resolves region labels case-insensitively and drops unknown ones", () => {
    expect(eventPoints({ affectedLocations: ["Red Sea", "Port Operations"] })).toEqual([LOCATION_POINTS["red sea"]]);
  });
});
