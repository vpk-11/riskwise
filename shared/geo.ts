/**
 * Route geometry. Pure functions, no I/O.
 *
 * A route is the shortest path through a small graph of sea nodes (chokepoints and
 * open-water hubs), not real AIS or lane data. Good enough to tell whether an event
 * is near a route; not good enough for navigation.
 */

import { PORTS, type LngLat } from "./ports";

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(from: LngLat, to: LngLat): number {
  const dLng = rad(to[0] - from[0]);
  const y = Math.sin(dLng) * Math.cos(rad(to[1]));
  const x =
    Math.cos(rad(from[1])) * Math.sin(rad(to[1])) -
    Math.sin(rad(from[1])) * Math.cos(rad(to[1])) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/** Distance in km from point p to the great-circle segment a-b. */
export function distanceToSegmentKm(p: LngLat, a: LngLat, b: LngLat): number {
  const segLen = haversineKm(a, b);
  if (segLen === 0) return haversineKm(p, a);
  const dAP = haversineKm(a, p) / EARTH_RADIUS_KM;
  const crossTrack = Math.asin(Math.sin(dAP) * Math.sin(bearing(a, p) - bearing(a, b)));
  const alongTrack = Math.acos(Math.min(1, Math.cos(dAP) / Math.cos(crossTrack))) * EARTH_RADIUS_KM;
  const behindStart = Math.cos(bearing(a, p) - bearing(a, b)) < 0;
  if (behindStart || alongTrack > segLen) return Math.min(haversineKm(p, a), haversineKm(p, b));
  return Math.abs(crossTrack) * EARTH_RADIUS_KM;
}

export function distanceToPolylineKm(p: LngLat, line: LngLat[]): number {
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    min = Math.min(min, distanceToSegmentKm(p, line[i], line[i + 1]));
  }
  return min;
}

/** Shifts longitudes by multiples of 360 so consecutive points never jump more than 180 degrees. For map rendering only. */
export function unwrapAntimeridian(line: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const [lng, lat] of line) {
    let x = lng;
    if (out.length > 0) {
      const prev = out[out.length - 1][0];
      while (x - prev > 180) x -= 360;
      while (x - prev < -180) x += 360;
    }
    out.push([x, lat]);
  }
  return out;
}

function polylineLengthKm(line: LngLat[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += haversineKm(line[i], line[i + 1]);
  return total;
}

// ── Sea graph ────────────────────────────────────────────────────────────────

export const SEA_NODES: Record<string, LngLat> = {
  // East Asia
  east_china_sea: [125, 30],
  kyushu_south: [132, 29.5],
  japan_pacific: [145, 35],
  tokyo_approach: [139.8, 34.6],
  taiwan_strait: [119.5, 23.5],
  pearl_river: [114.5, 21],
  shenzhen_approach: [114.2, 22],
  luzon_west: [119.5, 14.6],
  scs: [112, 12],
  // Southeast Asia and Oceania
  singapore_strait: [104.4, 1.2],
  malacca_south: [101.9, 2.4],
  malacca: [98, 5.5],
  java_sea: [112, -5.3],
  bali_sea: [115.3, -7.4],
  lombok: [115.6, -8.8],
  timor_sea: [125, -12],
  arafura_sea: [135, -10],
  torres_strait: [142.2, -10.3],
  gbr_north: [147, -12.5],
  coral_sea: [156, -28],
  sydney_sea: [152.5, -33.5],
  solomon_sea: [158, -4.5],
  micronesia: [155, 8],
  // Indian Ocean, Gulf, Red Sea
  bay_bengal: [88, 10],
  lanka_se: [82.5, 5.4],
  sri_lanka: [80, 5.5],
  arabian_sea: [66, 17],
  gulf_oman: [58, 24.5],
  hormuz_east: [57, 25.9],
  hormuz: [56.6, 26.7],
  persian_gulf: [53.5, 26.2],
  gulf_aden: [48, 12],
  bab_el_mandeb: [43.3, 12.6],
  red_sea: [38, 20],
  red_sea_n: [36.6, 24],
  gulf_suez_mouth: [34, 27.5],
  gulf_suez: [32.8, 29.4],
  suez: [32.5, 30.4],
  port_said: [32.3, 31.6],
  s_indian: [60, -30],
  cape_good_hope: [18.5, -35],
  // Mediterranean
  med_east: [29, 33.5],
  sicily_south: [13.5, 36.2],
  sicily_west: [12, 37.35],
  tunisia_north: [9.5, 38.2],
  med_west: [5, 38],
  valencia_sea: [0.8, 39.2],
  alboran: [-2, 35.8],
  gibraltar: [-5.5, 35.95],
  // Atlantic Europe and Africa
  gulf_cadiz: [-7.5, 36],
  st_vincent: [-9.8, 36.8],
  lisbon_sea: [-10.5, 38.7],
  finisterre: [-10, 43.4],
  ushant: [-6, 48.5],
  channel_west: [-2.5, 50.1],
  channel: [0.5, 50.3],
  dover: [1.6, 51],
  scheldt_mouth: [3.4, 51.5],
  north_sea: [3, 53],
  german_bight: [7.5, 54.2],
  celtic_sea: [-9, 49],
  atlantic_mid: [-40, 40],
  canary: [-18, 28],
  mauritania_sea: [-19, 20],
  senegal_sea: [-19.5, 12],
  guinea_sea: [-12, 4],
  gulf_guinea: [3, 2],
  angola_sea: [8, -8],
  namibia_sea: [10, -20],
  south_atlantic: [-2, -18],
  cabo_verde: [-25, 16],
  // Americas
  us_east: [-72, 38],
  savannah_sea: [-78.8, 31.2],
  mona: [-67.8, 18.4],
  caribbean: [-75, 16],
  panama_east: [-79.9, 9.7],
  panama_west: [-79.5, 8.6],
  panama_gulf: [-79.6, 6.8],
  azuero_south: [-81.5, 6.6],
  costa_rica_sea: [-86.5, 8.5],
  guatemala_sea: [-93, 12.5],
  mexico_sea: [-101, 15.5],
  cabo: [-110.5, 21.5],
  baja_sea: [-117.5, 30],
  socal_sea: [-119.5, 33],
  us_west: [-125, 34],
  north_pacific: [-170, 42],
};

export const SEA_EDGES: [string, string][] = [
  // East Asia
  ["east_china_sea", "taiwan_strait"],
  ["east_china_sea", "kyushu_south"],
  ["kyushu_south", "japan_pacific"],
  ["japan_pacific", "tokyo_approach"],
  ["taiwan_strait", "pearl_river"],
  ["taiwan_strait", "scs"],
  ["pearl_river", "scs"],
  ["pearl_river", "shenzhen_approach"],
  ["scs", "singapore_strait"],
  ["scs", "luzon_west"],
  // Strait of Malacca and the Indian Ocean
  ["singapore_strait", "malacca_south"],
  ["malacca_south", "malacca"],
  ["malacca", "sri_lanka"],
  ["malacca", "bay_bengal"],
  ["bay_bengal", "lanka_se"],
  ["lanka_se", "sri_lanka"],
  ["sri_lanka", "arabian_sea"],
  ["sri_lanka", "s_indian"],
  ["s_indian", "cape_good_hope"],
  // Gulf, Gulf of Aden, Red Sea, Suez
  ["arabian_sea", "gulf_oman"],
  ["gulf_oman", "hormuz_east"],
  ["hormuz_east", "hormuz"],
  ["hormuz", "persian_gulf"],
  ["arabian_sea", "gulf_aden"],
  ["gulf_aden", "bab_el_mandeb"],
  ["bab_el_mandeb", "red_sea"],
  ["red_sea", "red_sea_n"],
  ["red_sea_n", "gulf_suez_mouth"],
  ["gulf_suez_mouth", "gulf_suez"],
  ["gulf_suez", "suez"],
  ["suez", "port_said"],
  ["port_said", "med_east"],
  // Mediterranean to the Atlantic
  ["med_east", "sicily_south"],
  ["sicily_south", "sicily_west"],
  ["sicily_west", "tunisia_north"],
  ["tunisia_north", "med_west"],
  ["valencia_sea", "med_west"],
  ["med_west", "alboran"],
  ["alboran", "gibraltar"],
  ["gibraltar", "gulf_cadiz"],
  ["gulf_cadiz", "st_vincent"],
  ["st_vincent", "lisbon_sea"],
  ["lisbon_sea", "finisterre"],
  ["finisterre", "ushant"],
  ["ushant", "channel_west"],
  ["channel_west", "channel"],
  ["channel", "dover"],
  ["dover", "scheldt_mouth"],
  ["scheldt_mouth", "north_sea"],
  ["dover", "north_sea"],
  ["north_sea", "german_bight"],
  ["ushant", "celtic_sea"],
  ["celtic_sea", "atlantic_mid"],
  ["gulf_cadiz", "atlantic_mid"],
  ["canary", "atlantic_mid"],
  ["st_vincent", "canary"],
  // Around Africa
  ["canary", "mauritania_sea"],
  ["mauritania_sea", "senegal_sea"],
  ["senegal_sea", "guinea_sea"],
  ["guinea_sea", "gulf_guinea"],
  ["gulf_guinea", "angola_sea"],
  ["angola_sea", "namibia_sea"],
  ["namibia_sea", "cape_good_hope"],
  // Offshore lane: ships do not hug the African bulge
  ["cape_good_hope", "south_atlantic"],
  ["south_atlantic", "cabo_verde"],
  ["cabo_verde", "canary"],
  ["cabo_verde", "atlantic_mid"],
  // Atlantic and Americas
  ["atlantic_mid", "us_east"],
  ["us_east", "mona"],
  ["savannah_sea", "us_east"],
  ["mona", "caribbean"],
  ["caribbean", "panama_east"],
  ["panama_east", "panama_west"],
  ["panama_west", "panama_gulf"],
  ["panama_gulf", "azuero_south"],
  ["azuero_south", "costa_rica_sea"],
  ["costa_rica_sea", "guatemala_sea"],
  ["guatemala_sea", "mexico_sea"],
  ["mexico_sea", "cabo"],
  ["cabo", "baja_sea"],
  ["baja_sea", "socal_sea"],
  ["socal_sea", "us_west"],
  ["us_west", "north_pacific"],
  ["north_pacific", "japan_pacific"],
  // Southeast Asia to Australia
  ["singapore_strait", "java_sea"],
  ["java_sea", "bali_sea"],
  ["bali_sea", "lombok"],
  ["lombok", "timor_sea"],
  ["timor_sea", "arafura_sea"],
  ["arafura_sea", "torres_strait"],
  ["torres_strait", "gbr_north"],
  ["gbr_north", "coral_sea"],
  ["coral_sea", "sydney_sea"],
  ["coral_sea", "solomon_sea"],
  ["solomon_sea", "micronesia"],
  ["micronesia", "japan_pacific"],
];

const ADJACENCY = new Map<string, { to: string; km: number }[]>();
for (const [a, b] of SEA_EDGES) {
  const km = haversineKm(SEA_NODES[a], SEA_NODES[b]);
  ADJACENCY.set(a, [...(ADJACENCY.get(a) ?? []), { to: b, km }]);
  ADJACENCY.set(b, [...(ADJACENCY.get(b) ?? []), { to: a, km }]);
}

/** Ports whose nearest node is on the wrong side of a landmass: Dubai is inside the Gulf, so it must pass Hormuz. */
const PORT_NODE: Record<string, string> = {
  "Port of Dubai": "persian_gulf",
};

/** The sea node a port attaches to: an explicit override, else the nearest node. */
export function attachNode(portName: string): string {
  const override = PORT_NODE[portName];
  if (override) return override;
  const p = PORTS[portName];
  if (!p) throw new Error(`Unknown port: ${portName}`);
  return nearestNode(p);
}

function nearestNode(p: LngLat): string {
  let best = "";
  let bestKm = Infinity;
  for (const [name, coord] of Object.entries(SEA_NODES)) {
    const km = haversineKm(p, coord);
    if (km < bestKm) {
      best = name;
      bestKm = km;
    }
  }
  return best;
}

export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRouteError";
  }
}

/** Nodes a route can be told to avoid. Open-water hubs are not offered: blocking one rarely forces a different lane. */
export const CHOKEPOINTS = [
  "suez",
  "red_sea",
  "bab_el_mandeb",
  "gulf_aden",
  "hormuz",
  "malacca",
  "singapore_strait",
  "taiwan_strait",
  "panama_east",
  "panama_west",
  "gibraltar",
  "channel",
] as const;

const CHOKE_SET = new Set<string>(CHOKEPOINTS);

/**
 * Dijkstra over the sea graph, never entering a node in `avoid`.
 * ponytail: O(n^2) scan, fine for ~90 nodes (a build is well under a millisecond); use a heap if the graph grows past a few hundred.
 */
function shortestNodePath(from: string, to: string, avoid: ReadonlySet<string> = new Set()): string[] {
  if (avoid.has(from) || avoid.has(to)) throw new NoRouteError(`Cannot avoid ${avoid.has(from) ? from : to}: it is where the route starts or ends`);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>(Object.keys(SEA_NODES));
  while (open.size > 0) {
    let current = "";
    let currentKm = Infinity;
    for (const node of Array.from(open)) {
      const km = dist.get(node) ?? Infinity;
      if (km < currentKm) {
        current = node;
        currentKm = km;
      }
    }
    if (!current) break;
    open.delete(current);
    if (current === to) break;
    for (const edge of ADJACENCY.get(current) ?? []) {
      if (avoid.has(edge.to)) continue;
      const next = currentKm + edge.km;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, current);
      }
    }
  }
  if (!dist.has(to)) throw new NoRouteError(`No sea path from ${from} to ${to}`);
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

export interface RouteGeometry {
  /** Origin, sea nodes, destination. */
  waypoints: LngLat[];
  /** Named sea nodes passed through, for display. */
  via: string[];
  distanceKm: number;
}

/** Route between two canonical port names from `shared/ports.ts`, optionally avoiding named sea nodes. */
export function buildRoute(origin: string, destination: string, avoid: readonly string[] = []): RouteGeometry {
  const start = PORTS[origin];
  const end = PORTS[destination];
  if (!start || !end) throw new Error(`Unknown port: ${!start ? origin : destination}`);
  const via = shortestNodePath(attachNode(origin), attachNode(destination), new Set(avoid));
  const waypoints = [start, ...via.map((n) => SEA_NODES[n]), end];
  return { waypoints, via, distanceKm: polylineLengthKm(waypoints) };
}

const NODE_LABELS: Record<string, string> = {
  suez: "Suez Canal",
  red_sea: "Red Sea",
  bab_el_mandeb: "Bab-el-Mandeb",
  gulf_aden: "Gulf of Aden",
  hormuz: "Strait of Hormuz",
  malacca: "Strait of Malacca",
  singapore_strait: "Singapore Strait",
  taiwan_strait: "Taiwan Strait",
  panama_east: "Panama Canal",
  panama_west: "Panama Canal",
  gibraltar: "Strait of Gibraltar",
  channel: "English Channel",
  cape_good_hope: "Cape of Good Hope",
  north_pacific: "North Pacific",
  atlantic_mid: "mid-Atlantic",
  med_east: "Eastern Mediterranean",
  med_west: "Western Mediterranean",
};

const label = (node: string) => NODE_LABELS[node] ?? node.replace(/_/g, " ");
const unique = (xs: string[]) => Array.from(new Set(xs));

/** Short name for an alternative: the notable lanes it uses that the direct route does not. */
export function describeAlternative(direct: RouteGeometry, alt: RouteGeometry): string {
  const notable = unique(alt.via.filter((n) => !direct.via.includes(n) && n in NODE_LABELS).map(label));
  return notable.length > 0 ? `Via ${notable.slice(0, 3).join(", ")}` : "Alternative lane";
}

/** Chokepoints the direct route uses that the alternative avoids. */
export function avoidedChokepoints(direct: RouteGeometry, alt: RouteGeometry): string[] {
  return unique(direct.via.filter((n) => CHOKE_SET.has(n) && !alt.via.includes(n)).map(label));
}

/** A detour longer than this multiple of the direct route is not an alternative anyone would take. */
const MAX_DETOUR_FACTOR = 1.6;
const MAX_CANDIDATES = 4;

/**
 * Alternative routes to the direct one. Starts by avoiding each chokepoint on it (and all of them), then avoids the
 * chokepoints of each new route in turn, so a second-best lane (the Cape after Panama) is found too.
 * Distinct, shortest first. The avoid list is what was blocked to find the route.
 */
export function candidateRoutes(origin: string, destination: string): { route: RouteGeometry; avoids: string[] }[] {
  const base = buildRoute(origin, destination);
  const isChoke = (n: string) => CHOKE_SET.has(n);
  const endpoints = new Set([base.via[0], base.via[base.via.length - 1]]); // blocking where the route starts or ends is never possible
  const onPath = base.via.filter((n) => isChoke(n) && !endpoints.has(n));
  const seenRoutes = new Set([base.via.join(">")]);
  const triedAvoids = new Set<string>();
  const frontier: string[][] = [...onPath.map((n) => [n]), onPath];
  const out: { route: RouteGeometry; avoids: string[] }[] = [];

  for (let builds = 0; frontier.length > 0 && builds < 30; builds++) {
    const avoids = frontier.shift()!;
    const key = [...avoids].sort().join(",");
    if (avoids.length === 0 || triedAvoids.has(key)) continue;
    triedAvoids.add(key);
    try {
      const route = buildRoute(origin, destination, avoids);
      const routeKey = route.via.join(">");
      if (!seenRoutes.has(routeKey) && route.distanceKm <= base.distanceKm * MAX_DETOUR_FACTOR) {
        seenRoutes.add(routeKey);
        out.push({ route, avoids });
      }
      const deeper = unique([...avoids, ...route.via.filter((n) => isChoke(n) && !endpoints.has(n) && !base.via.includes(n))]);
      if (deeper.length > avoids.length) frontier.push(deeper);
    } catch (err) {
      if (!(err instanceof NoRouteError)) throw err;
    }
  }
  return out.sort((a, b) => a.route.distanceKm - b.route.distanceKm).slice(0, MAX_CANDIDATES);
}

// ── Event locations ──────────────────────────────────────────────────────────

/** Region labels used by the feed parsers, mapped to a representative point. */
export const LOCATION_POINTS: Record<string, LngLat> = {
  "black sea": [34, 43.5],
  "odessa port": [30.7, 46.5],
  "baltic sea": [19, 58],
  novorossiysk: [37.8, 44.7],
  "suez canal": [32.5, 30.5],
  "suez canal region": [32.5, 30.5],
  "eastern mediterranean": [29, 33.5],
  "mediterranean sea": [15, 35],
  "strait of hormuz": [56.5, 26.5],
  "persian gulf": [51, 27],
  "bab-el-mandeb": [43.3, 12.6],
  "red sea": [38, 20],
  "gulf of aden": [48, 12],
  "horn of africa": [49, 9],
  "south china sea": [112, 12],
  "strait of malacca": [100, 3.5],
  "taiwan strait": [119.5, 23.5],
  "panama canal": [-79.8, 9],
  "caribbean sea": [-75, 16],
  "gulf of mexico": [-90, 25],
  "western pacific": [140, 25],
  "east china sea": [125, 30],
  "japan sea routes": [135, 40],
  "bay of bengal": [88, 12],
  "indian ocean": [75, -5],
  "arabian sea": [66, 17],
  "us west coast ports": [-122, 36],
  "pacific routes": [-150, 38],
  "south pacific": [-120, -25],
  "cape horn routes": [-67, -56],
  "arctic shipping routes": [90, 76],
  europoort: [4.1, 51.9],
  "yangshan deep water port": [122.1, 30.6],
  "port of aden": [45, 12.8],
  "port of fujairah": [56.3, 25.1],
  "korea strait": [129, 34.5],
  "yellow sea": [123, 35],
  "north sea": [3, 56],
  "north atlantic ocean": [-35, 45],
  "singapore strait": [104, 1.2],
  "malacca strait": [101, 3],
  "bab-el-mandeb strait": [43.5, 12.5],
  "gulf of panama": [-79, 8.5],
  "northern sea route": [90, 76],
  ...Object.fromEntries(Object.entries(PORTS).map(([name, p]) => [name.toLowerCase(), p])),
};

/** Points for an event: its own coordinates if known, else the labelled regions that resolve. */
export function eventPoints(event: { coordinates?: LngLat; affectedLocations: string[] }): LngLat[] {
  if (event.coordinates) {
    const [lng, lat] = event.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [event.coordinates] : [];
  }
  return event.affectedLocations
    .map((label) => LOCATION_POINTS[label.trim().toLowerCase()])
    .filter((p): p is LngLat => p !== undefined);
}
