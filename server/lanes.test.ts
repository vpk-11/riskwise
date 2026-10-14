import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PORTS, type LngLat } from "@shared/ports";
import { attachNode, SEA_EDGES, SEA_NODES } from "@shared/geo";

/**
 * Lane geometry against real coastlines (Natural Earth 110m land, public domain, server/testdata).
 * 110m is coarse: it drops small islands and fills narrow straits, so this catches lanes that cross a continent,
 * not a headland. Canals are crossings by design.
 */
type Ring = LngLat[];
const land: Ring[][] = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "testdata/land-110m.geojson"), "utf8")).features.map(
  (f: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }) =>
    (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((poly) => poly as Ring[]),
);

function inRing([x, y]: LngLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const onLand = (p: LngLat) => land.some((rings) => inRing(p, rings[0]) && !rings.slice(1).some((hole) => inRing(p, hole)));

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Points along the great circle a-b, `steps` intervals. */
function greatCircle(a: LngLat, b: LngLat, steps: number): LngLat[] {
  const toVec = ([lng, lat]: LngLat) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k1 = omega === 0 ? 1 - t : Math.sin((1 - t) * omega) / Math.sin(omega);
    const k2 = omega === 0 ? t : Math.sin(t * omega) / Math.sin(omega);
    const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    out.push([deg(Math.atan2(v[1], v[0])), deg(Math.atan2(v[2], Math.hypot(v[0], v[1])))]);
  }
  return out;
}

const km = (a: LngLat, b: LngLat) => {
  const [dLng, dLat] = [rad(b[0] - a[0]), rad(b[1] - a[1])];
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** Approximate km of a segment over land, from 200 samples. */
const landKm = (a: LngLat, b: LngLat) => {
  const pts = greatCircle(a, b, 200);
  return (pts.filter(onLand).length / pts.length) * km(a, b);
};

/**
 * Narrow straits, canals, and reef passages that the 110m coastline fills in. These nodes may read as land, and
 * these edges are allowed this many km over land (measured). Every other edge must be clear water.
 */
const STRAIT_NODES = new Set(["suez", "gulf_suez", "gulf_suez_mouth", "port_said", "gibraltar", "dover", "panama_east", "panama_west", "malacca_south", "singapore_strait", "hormuz", "mona", "lombok", "torres_strait", "bab_el_mandeb", "channel", "scheldt_mouth"]);
const NARROW_EDGES: Record<string, number> = {
  "singapore_strait - malacca_south": 300, // Singapore Strait and the south end of the Malacca Strait, tens of km wide
  "hormuz - persian_gulf": 160,
  "malacca_south - malacca": 80,
  "bali_sea - lombok": 25,
  "gulf_suez_mouth - gulf_suez": 230, // the Gulf of Suez is about 50 km wide
  "gulf_suez - suez": 200,
  "suez - port_said": 200,
  "red_sea - red_sea_n": 0,
  "panama_east - panama_west": 200,
  "caribbean - panama_east": 120,
  "dover - scheldt_mouth": 120,
  "med_west - alboran": 60,
  "alboran - gibraltar": 60,
  "gibraltar - gulf_cadiz": 60,
};
const MAX_PORT_CONNECTOR_LAND_KM = 120; // Hamburg is about 100 km up the Elbe; ports are on land by definition

/**
 * Where each port joins the lane graph, written out on purpose. "Nearest node" is the default but it ignores landmasses
 * (Dubai is inside the Gulf), so every port's attachment is pinned here and a change must be deliberate.
 */
const EXPECTED_ATTACH: Record<string, string> = {
  "Port of Shanghai": "east_china_sea",
  "Port of Shenzhen": "shenzhen_approach",
  "Port of Hong Kong": "shenzhen_approach",
  "Port of Kaohsiung": "taiwan_strait",
  "Port of Busan": "east_china_sea",
  "Port of Tokyo": "tokyo_approach",
  "Port of Singapore": "singapore_strait",
  "Port of Mumbai": "arabian_sea",
  "Port of Dubai": "persian_gulf",
  "Port of Rotterdam": "scheldt_mouth",
  "Port of Hamburg": "german_bight",
  "Port of Antwerp": "scheldt_mouth",
  "Port of New York": "us_east",
  "Port of Los Angeles": "socal_sea",
  "Port of Long Beach": "socal_sea",
  "Port of Sydney": "sydney_sea",
  "Port of Felixstowe": "dover",
  "Port of Valencia": "valencia_sea",
  "Port of Jeddah": "red_sea",
  "Port of Colombo": "sri_lanka",
  "Port Klang": "malacca_south",
  "Port of Savannah": "savannah_sea",
  "Port of Manila": "luzon_west",
  "Port of Cai Mep": "scs",
};

describe("lane graph geometry against coastlines", () => {
  it("pins every port to its intended attachment node", () => {
    expect(Object.keys(EXPECTED_ATTACH).sort()).toEqual(Object.keys(PORTS).sort());
    for (const name of Object.keys(PORTS)) expect(attachNode(name), name).toBe(EXPECTED_ATTACH[name]);
  });

  it("has no lane edge crossing land, except short crossings at straits and canals", () => {
    const offenders = SEA_EDGES.map(([a, b]) => {
      const edge = `${a} - ${b}`;
      return { edge, landKm: Math.round(landKm(SEA_NODES[a], SEA_NODES[b])), tolerated: NARROW_EDGES[edge] ?? 0 };
    }).filter((e) => e.landKm > e.tolerated);
    expect(offenders).toEqual([]);
  });

  it("keeps every sea node in water, except the strait and canal nodes", () => {
    const onShore = Object.entries(SEA_NODES).filter(([n, p]) => !STRAIT_NODES.has(n) && onLand(p)).map(([n]) => n);
    expect(onShore).toEqual([]);
  });

  it("attaches each port to a node with at most a short land connector", () => {
    const bad = Object.entries(PORTS)
      .map(([name, p]) => ({ name, node: attachNode(name), landKm: Math.round(landKm(p, SEA_NODES[attachNode(name)])) }))
      .filter((x) => x.landKm > MAX_PORT_CONNECTOR_LAND_KM);
    expect(bad).toEqual([]);
  });

  it("the land check itself works: a known land point is land, a known sea point is not", () => {
    expect(onLand([2, 47])).toBe(true); // France
    expect(onLand([-40, 40])).toBe(false); // mid-Atlantic
    expect(landKm([-10, 35], [30, 35]) + landKm([2, 40], [2, 55])).toBeGreaterThan(0);
  });
});
