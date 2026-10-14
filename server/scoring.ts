/**
 * Deterministic route risk scoring. Pure functions, same input gives the same score.
 *
 * Per event: contribution = severity weight x category weight x proximity, in 0-1.
 * Proximity falls linearly from 1 (on the route) to 0 at PROXIMITY_CUTOFF_KM.
 * Events with the same category and region count once, at their highest contribution,
 * so ten articles about one crisis do not saturate the score.
 * Scores combine as a noisy-OR: 100 x (1 - product(1 - contribution)). It is monotonic,
 * bounded at 100, and a second event adds less than the first.
 * Events with no resolvable location cannot be placed relative to the route and score 0.
 */

import type { LngLat } from "@shared/ports";
import { categoryEnum, severityEnum } from "../drizzle/schema";
import { distanceToPolylineKm, eventPoints, haversineKm } from "@shared/geo";

/** The DB enums are the single source for these lists. */
export type Category = (typeof categoryEnum.enumValues)[number];
export type Severity = (typeof severityEnum.enumValues)[number];
export type Factor = "weather" | "labor" | "geopolitical" | "congestion";

const SEVERITY_WEIGHT: Record<Severity, number> = { Low: 0.1, Medium: 0.3, High: 0.6, Critical: 0.9 };
const CATEGORY_WEIGHT: Record<Category, number> = {
  Geopolitical: 1.0,
  Weather: 0.9,
  Strike: 0.8,
  "Port Congestion": 0.7,
};
const CATEGORY_FACTOR: Record<Category, Factor> = {
  Weather: "weather",
  Strike: "labor",
  Geopolitical: "geopolitical",
  "Port Congestion": "congestion",
};
export const PROXIMITY_CUTOFF_KM = 1500;

export interface ScorableEvent {
  title: string;
  category: Category;
  severity: Severity;
  affectedLocations: string[];
  coordinates?: LngLat;
}

export interface Driver {
  title: string;
  category: Category;
  severity: Severity;
  distanceKm: number;
  contribution: number;
}

export interface RiskScore {
  overall: number;
  breakdown: Record<Factor, number>;
  primaryFactor: Factor | null;
  drivers: Driver[];
}

const FACTOR_ORDER: Factor[] = ["geopolitical", "weather", "labor", "congestion"];
const MAX_DRIVERS = 5;

function noisyOr(contributions: number[]): number {
  return 100 * (1 - contributions.reduce((acc, c) => acc * (1 - c), 1));
}

/** Same-category events closer than this are reports of one thing (a quake covered twice) and count once. */
export const DEDUPE_KM = 100;

export function scoreRoute(route: LngLat[], events: ScorableEvent[]): RiskScore {
  const candidates: { driver: Driver; point: LngLat }[] = [];

  for (const event of events) {
    const points = eventPoints(event);
    if (points.length === 0) continue;
    // The point of the event nearest the route stands for it
    const [distanceKm, point] = points
      .map((p): [number, LngLat] => [distanceToPolylineKm(p, route), p])
      .reduce((a, b) => (b[0] < a[0] ? b : a));
    const proximity = Math.max(0, 1 - distanceKm / PROXIMITY_CUTOFF_KM);
    const contribution = SEVERITY_WEIGHT[event.severity] * CATEGORY_WEIGHT[event.category] * proximity;
    if (!(contribution > 0)) continue; // also rejects NaN
    candidates.push({
      point,
      driver: { title: event.title, category: event.category, severity: event.severity, distanceKm: Math.round(distanceKm), contribution },
    });
  }

  // Strongest first, so each cluster is represented by its strongest report whatever order events arrive in.
  candidates.sort((a, b) => b.driver.contribution - a.driver.contribution || a.driver.title.localeCompare(b.driver.title));
  const kept: typeof candidates = [];
  for (const c of candidates) {
    const duplicate = kept.some((k) => k.driver.category === c.driver.category && haversineKm(k.point, c.point) <= DEDUPE_KM);
    if (!duplicate) kept.push(c);
  }
  const drivers = kept.map((k) => k.driver);
  const breakdown: Record<Factor, number> = { weather: 0, labor: 0, geopolitical: 0, congestion: 0 };
  for (const factor of FACTOR_ORDER) {
    const cs = drivers.filter((d) => CATEGORY_FACTOR[d.category] === factor).map((d) => d.contribution);
    breakdown[factor] = Math.round(noisyOr(cs));
  }

  const overall = Math.round(noisyOr(drivers.map((d) => d.contribution)));
  const primaryFactor =
    overall === 0 ? null : FACTOR_ORDER.reduce((a, b) => (breakdown[b] > breakdown[a] ? b : a));

  return { overall, breakdown, primaryFactor, drivers: drivers.slice(0, MAX_DRIVERS) };
}

/** Typical container ship cruising speed, 14 knots in km per day. */
const KM_PER_DAY = 14 * 1.852 * 24;

export function transitDays(distanceKm: number): number {
  return Math.round(distanceKm / KM_PER_DAY);
}
