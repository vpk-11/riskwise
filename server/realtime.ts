/**
 * RiskWise: Real-Time Intelligence Fetcher
 *
 * Pulls live data from three open sources (no API keys required):
 *   1. RSS news    – gCaptain and Seatrade Maritime (trade press), BBC World / Al Jazeera / NYT World
 *   2. NASA EONET  – Active severe storms, volcanoes, sea ice
 *   3. USGS        – Significant earthquakes (M5.0+) in the last 24 h
 * Plus a static country-risk baseline (hand-maintained table, not a live feed).
 *
 * All functions are server-side only and return normalised RiskWise event objects.
 */

import { z } from "zod";
import { PORT_NAMES, type LngLat } from "@shared/ports";
import { categoryEnum, severityEnum } from "../drizzle/schema";
import { createLogger } from "./_core/logger";
import { stripInvisible } from "./promptSafety";
import type { Category, Severity } from "./scoring";

const log = createLogger("realtime");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveRiskEvent {
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  affectedLocations: string[];
  sourceUrl?: string;
  sourceProvider: string;
  fetchedAt: string; // ISO timestamp
  coordinates?: LngLat; // exact [lng, lat] when the source provides one
}

export type SourceKind = "live" | "baseline";

/** Provider name on events from the static country-risk table. These are never persisted as live. */
export const BASELINE_PROVIDER = "Country Risk Baseline";

export interface SourceSummary {
  name: string;
  count: number;
  ok: boolean;
  kind: SourceKind;
  latencyMs: number;
}

interface FetcherResult {
  events: LiveRiskEvent[];
  count: number;
  ok: boolean;
}

const liveEventSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  category: z.enum(categoryEnum.enumValues),
  severity: z.enum(severityEnum.enumValues),
  affectedLocations: z.array(z.string()).min(1),
  sourceProvider: z.string().min(1),
  fetchedAt: z.string(),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
});

/** First [lng, lat] of a GeoJSON coordinates value (Point, or the first vertex of a Polygon or Line), or null. */
export function firstPoint(coordinates: unknown): LngLat | null {
  let c = coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c;
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

export interface DataFetchSummary {
  events: LiveRiskEvent[];
  fetchedAt: string;
  sources: SourceSummary[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

interface RssFeed {
  url: string;
  source: string;
  /** Trade press: every item is already about shipping, so a disruption term alone is enough. */
  maritime?: boolean;
}

const RSS_FEEDS: RssFeed[] = [
  { url: "https://gcaptain.com/feed/", source: "gCaptain", maritime: true },
  { url: "https://www.seatrade-maritime.com/rss.xml", source: "Seatrade Maritime", maritime: true },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", source: "NYT World" },
];

// Keyword → affected location mapping for geo-tagging news items
const GEO_DICT: Record<string, string[]> = {
  ukraine: ["Black Sea", "Odessa Port"],
  novorossiysk: ["Novorossiysk", "Black Sea"],
  "ust-luga": ["Baltic Sea"],
  primorsk: ["Baltic Sea"],
  gaza: ["Suez Canal", "Eastern Mediterranean"],
  israel: ["Suez Canal", "Eastern Mediterranean"],
  iran: ["Strait of Hormuz", "Persian Gulf"],
  houthi: ["Bab-el-Mandeb", "Red Sea"],
  yemen: ["Bab-el-Mandeb", "Red Sea", "Gulf of Aden"],
  "red sea": ["Red Sea", "Bab-el-Mandeb"],
  "black sea": ["Black Sea"],
  hormuz: ["Strait of Hormuz", "Persian Gulf"],
  "gulf of oman": ["Strait of Hormuz"],
  baltic: ["Baltic Sea"],
  malacca: ["Strait of Malacca"],
  "suez canal": ["Suez Canal", "Red Sea"],
  "strait of hormuz": ["Strait of Hormuz", "Persian Gulf"],
  "south china sea": ["South China Sea", "Strait of Malacca"],
  taiwan: ["Taiwan Strait", "South China Sea"],
  "panama canal": ["Panama Canal", "Caribbean Sea"],
  somalia: ["Gulf of Aden", "Horn of Africa"],
  piracy: ["Gulf of Aden", "Strait of Malacca"],
  hurricane: ["Gulf of Mexico", "Caribbean Sea"],
  typhoon: ["South China Sea", "Western Pacific"],
  cyclone: ["Bay of Bengal", "Indian Ocean"],
};

// An RSS item must mention shipping AND a disruption. Conflict words alone match generic world news.
const DISRUPTION_KEYWORDS = [
  "attack", "strike", "missile", "drone", "war", "protest", "riot", "clash", "bomb", "killed",
  "blockade", "sanctions", "seize", "seized", "hijack", "collision", "grounded", "closure", "closed",
  "suspend", "halt", "shut", "disruption", "delay", "congestion", "backlog", "piracy",
];

/** An incident word in the headline itself is enough to count, even from a general-news feed. */
const STRONG_INCIDENT_KEYWORDS = [
  "attack", "missile", "drone", "seize", "seized", "hijack", "blockade", "collision", "grounded",
  "aground", "sank", "sinking", "explosion", "piracy",
];

/** Headline words that mark market, corporate, or feature stories ("spot rates surge", "container shipping trial"). */
const BUSINESS_KEYWORDS = [
  "rates", "earnings", "profit", "quarter", "dividend", "stock", "shares", "contract", "orders", "delivery",
  "newbuild", "charter", "auction", "appoints", "appointed", "ceo", "trial", "forecast", "outlook", "revenue",
  "acquisition", "merger", "tender", "results",
];

const SHIPPING_KEYWORDS = [
  "shipping", "vessel", "tanker", "cargo", "port", "freight", "container",
  "maritime", "seafarer", "dock", "harbor", "harbour", "canal", "strait",
];

// Country code → port/region mapping for country risk enrichment
const COUNTRY_TO_REGIONS: Record<string, string[]> = {
  UA: ["Black Sea", "Odessa Port"],
  RU: ["Baltic Sea", "Novorossiysk", "Black Sea"],
  IL: ["Eastern Mediterranean", "Suez Canal"],
  PS: ["Eastern Mediterranean"],
  SY: ["Eastern Mediterranean"],
  YE: ["Bab-el-Mandeb", "Red Sea", "Gulf of Aden"],
  MM: ["Bay of Bengal", "Strait of Malacca"],
  IR: ["Strait of Hormuz", "Persian Gulf"],
  SO: ["Gulf of Aden", "Horn of Africa"],
  LY: ["Mediterranean Sea"],
  SD: ["Red Sea"],
};

/** Shown for a news item that names no place we can map. It cannot be placed relative to a route, so it scores 0. */
export const UNLOCATED_LABEL = "Location unknown (not scored)";

const termPatterns = new Map<string, RegExp>();

const LABOR_TERMS = ["dock workers", "dockworkers", "longshoremen", "stevedores", "labor", "labour", "walkout", "work stoppage", "port strike", "trade union", "workers"];
/** Unambiguous labor terms: these win even when the text also has military words. */
const STRONG_LABOR_TERMS = ["dock workers", "dockworkers", "longshoremen", "stevedores", "walkout", "work stoppage", "port strike", "trade union"];
const MILITARY_TERMS = ["attack", "missile", "drone", "war", "killed", "navy", "forces", "houthi", "airstrike", "targets", "troops", "military", "bomb", "iran", "israel"];

/** A labor dispute, not a military strike: "Dock workers strike" yes, "Saudi Arabia strikes Houthi targets" no. */
export function isLaborDispute(text: string): boolean {
  if (STRONG_LABOR_TERMS.some((t) => hasTerm(text, t))) return true;
  if (MILITARY_TERMS.some((t) => hasTerm(text, t))) return false; // "Houthi attack kills port workers" is not a labor dispute
  return LABOR_TERMS.some((t) => hasTerm(text, t)) || hasTerm(text, "strike");
}

/** Inner text of an RSS element, across newlines, with any CDATA wrapper removed. Null if absent. */
export function rssField(item: string, name: string): string | null {
  const m = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "") : null;
}

/**
 * Feed text as safe plain text: tags removed, entities decoded, then any angle brackets the decoding
 * produced removed too. Entity-encoded markup must not survive, because this text is stored and shown.
 */
export function plainText(raw: string): string {
  return stripInvisible(decodeEntities(raw.replace(/<[^>]+>/g, "")))
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decodes the HTML entities feeds put in titles and descriptions. */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

/** Whole-word match with simple plural and verb suffixes, so "war" does not match "award". */
export function hasTerm(text: string, term: string): boolean {
  let re = termPatterns.get(term);
  if (!re) {
    re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es|ed|ing)?\\b`);
    termPatterns.set(term, re);
  }
  return re.test(text);
}

// ── 1. RSS OSINT Fetcher ──────────────────────────────────────────────────────

async function fetchRssFeed(feed: RssFeed): Promise<{ events: LiveRiskEvent[]; ok: boolean }> {
  const events: LiveRiskEvent[] = [];
  let ok = false;

  try {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "RiskWise/2.0 Supply Chain Intelligence" },
    });
    if (!res.ok) return { events, ok };
    const xml = await res.text();
    ok = true; // feed responded; zero relevant items is still a healthy feed

    const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const item of items.slice(0, 30)) {
      const titleField = rssField(item, "title");
      if (!titleField) continue;

      const title = plainText(titleField);
      const link = rssField(item, "link")?.trim() ?? "";
      const rawDesc = plainText(rssField(item, "description") ?? "");
      const textToSearch = (title + " " + rawDesc).toLowerCase();

      const headline = title.toLowerCase();
      const aboutShipping = feed.maritime || SHIPPING_KEYWORDS.some((kw) => hasTerm(textToSearch, kw));
      const incidentInHeadline = STRONG_INCIDENT_KEYWORDS.some((kw) => hasTerm(headline, kw));
      const businessHeadline = BUSINESS_KEYWORDS.some((kw) => hasTerm(headline, kw));
      const disruptive = DISRUPTION_KEYWORDS.some((kw) => hasTerm(textToSearch, kw));
      // A strong incident in the headline wins; otherwise a disruption word counts unless the headline is a market or feature story.
      const isRelevant = aboutShipping && (incidentInHeadline || (disruptive && !businessHeadline));
      if (!isRelevant) continue;

      // Determine affected locations from geo-dict
      const affectedLocations: string[] = [];
      for (const [keyword, locations] of Object.entries(GEO_DICT)) {
        if (hasTerm(textToSearch, keyword)) {
          for (const loc of locations) {
            if (!affectedLocations.includes(loc)) affectedLocations.push(loc);
          }
        }
      }
      // Name a supported port when the text mentions its city, so strike and congestion news can be placed.
      for (const portName of PORT_NAMES) {
        const city = portName.replace(/^Port of /, "").toLowerCase();
        if (hasTerm(textToSearch, city) && !affectedLocations.includes(portName)) affectedLocations.push(portName);
      }
      if (affectedLocations.length === 0) affectedLocations.push(UNLOCATED_LABEL);

      // Classify category
      let category: LiveRiskEvent["category"] = "Geopolitical";
      if (isLaborDispute(textToSearch)) {
        category = "Strike";
      } else if (
        hasTerm(textToSearch, "hurricane") ||
        hasTerm(textToSearch, "typhoon") ||
        hasTerm(textToSearch, "cyclone") ||
        hasTerm(textToSearch, "storm") ||
        hasTerm(textToSearch, "flood") ||
        hasTerm(textToSearch, "weather")
      ) {
        category = "Weather";
      } else if (
        hasTerm(textToSearch, "congestion") ||
        hasTerm(textToSearch, "backlog") ||
        hasTerm(textToSearch, "queue") ||
        hasTerm(textToSearch, "delay") ||
        hasTerm(textToSearch, "port closure")
      ) {
        category = "Port Congestion";
      }

      // Classify severity
      let severity: LiveRiskEvent["severity"] = "Medium";
      if (
        hasTerm(textToSearch, "critical") ||
        hasTerm(textToSearch, "catastrophic") ||
        hasTerm(textToSearch, "closure") ||
        hasTerm(textToSearch, "blockade") ||
        hasTerm(textToSearch, "seized") ||
        hasTerm(textToSearch, "attack")
      ) {
        severity = "Critical";
      } else if (
        hasTerm(textToSearch, "high") ||
        hasTerm(textToSearch, "major") ||
        hasTerm(textToSearch, "severe") ||
        hasTerm(textToSearch, "significant")
      ) {
        severity = "High";
      } else if (hasTerm(textToSearch, "minor") || hasTerm(textToSearch, "low")) {
        severity = "Low";
      }

      const description =
        rawDesc.length > 20
          ? rawDesc.slice(0, 280) + (rawDesc.length > 280 ? "..." : "")
          : `${feed.source} reports: ${title}`;

      events.push({
        title: title.slice(0, 200),
        description,
        category,
        severity,
        affectedLocations,
        sourceUrl: link,
        sourceProvider: feed.source,
        fetchedAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e, source: feed.source }, `RSS fetch failed for ${feed.source}`);
  }

  return { events, ok };
}

async function fetchRssOsint(): Promise<FetcherResult> {
  const results = await Promise.all(RSS_FEEDS.map(fetchRssFeed));
  const events = results.flatMap((r) => r.events);
  return { events, count: events.length, ok: results.some((r) => r.ok) };
}

// ── 2. NASA EONET Weather Fetcher ─────────────────────────────────────────────

const EONET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const EONET_CATEGORY_TO_LOCATIONS: Record<string, string[]> = {
  severeStorms: ["Open Ocean", "Coastal Waters"],
  volcanoes: ["Pacific Ring of Fire", "Volcanic Islands"],
  seaIce: ["Arctic Shipping Routes", "Northern Sea Route"],
  floods: ["River Ports", "Coastal Regions"],
};

async function fetchNasaEonet(): Promise<FetcherResult> {
  const events: LiveRiskEvent[] = [];
  try {
    const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50&days=7", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "RiskWise/2.0 Supply Chain Intelligence" },
    });
    if (!res.ok) return { events, count: 0, ok: false };

    const data = await res.json();

    for (const event of (data.events || []).slice(0, 20)) {
      const categoryId = event.categories?.[0]?.id || "unknown";
      if (categoryId === "wildfires" || categoryId === "earthquakes") continue;

      const geom = event.geometry?.at(-1);
      if (!geom?.coordinates) continue;
      // EONET keeps long-finished events "open"; only the latest observation date tells.
      const observedAt = Date.parse(geom.date ?? "");
      if (!Number.isFinite(observedAt) || Date.now() - observedAt > EONET_MAX_AGE_MS) continue;

      let severity: LiveRiskEvent["severity"] = "Medium";
      let affectedLocations = EONET_CATEGORY_TO_LOCATIONS[categoryId] ?? ["Open Ocean"];

      // Classify severity by category
      if (categoryId === "severeStorms") severity = "High";
      else if (categoryId === "volcanoes") severity = "High";
      else if (categoryId === "seaIce") severity = "Medium";

      // Try to geo-tag by coordinates
      const point = firstPoint(geom.coordinates);
      const [lng, lat] = point ?? [NaN, NaN];

      if (point) {
        // Rough region tagging by coordinate ranges
        if (lat > 0 && lat < 30 && lng > 40 && lng < 80) affectedLocations = ["Arabian Sea", "Indian Ocean"];
        else if (lat > -10 && lat < 25 && lng > 95 && lng < 130) affectedLocations = ["South China Sea", "Bay of Bengal"];
        else if (lat > 20 && lat < 40 && lng > 120 && lng < 145) affectedLocations = ["Western Pacific", "East China Sea"];
        else if (lat > 5 && lat < 25 && lng > -100 && lng < -60) affectedLocations = ["Caribbean Sea", "Gulf of Mexico"];
        else if (lat > 60) affectedLocations = ["Arctic Shipping Routes", "Northern Sea Route"];
      }

      events.push({
        title: event.title,
        description: `NASA EONET active event: ${event.title}. Category: ${event.categories?.[0]?.title ?? categoryId}. Last updated: ${geom.date ?? "recent"}.`,
        category: "Weather",
        severity,
        affectedLocations,
        sourceUrl: event.sources?.[0]?.url ?? "https://eonet.gsfc.nasa.gov",
        sourceProvider: "NASA EONET",
        fetchedAt: new Date().toISOString(),
        coordinates: point ?? undefined,
      });
    }

    return { events, count: events.length, ok: true };
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, "NASA EONET fetch failed");
    return { events, count: 0, ok: false };
  }
}

// ── 3. USGS Earthquake Fetcher ────────────────────────────────────────────────

async function fetchUsgsEarthquakes(): Promise<FetcherResult> {
  const events: LiveRiskEvent[] = [];
  try {
    const res = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { events, count: 0, ok: false };

    const data = await res.json();

    for (const feature of (data.features || []).slice(0, 15)) {
      const props = feature.properties;
      const mag: number = props?.mag ?? 0;
      if (mag < 5.0) continue; // Only significant quakes

      const place: string = props?.place ?? "Unknown region";
      const point = firstPoint(feature.geometry?.coordinates);
      if (!point) continue; // no usable location: skip rather than guess [0, 0]
      const [lng, lat] = point;

      // Determine affected shipping locations by coordinate proximity
      let affectedLocations: string[] = ["Regional Shipping Lanes"];
      if (lat > 20 && lat < 45 && lng > 120 && lng < 150) affectedLocations = ["Western Pacific", "Japan Sea Routes"];
      else if (lat > -10 && lat < 20 && lng > 95 && lng < 130) affectedLocations = ["South China Sea", "Strait of Malacca"];
      else if (lat > 0 && lat < 40 && lng > 25 && lng < 65) affectedLocations = ["Eastern Mediterranean", "Suez Canal Region"];
      else if (lat > -50 && lat < 0 && lng > -80 && lng < -60) affectedLocations = ["South Pacific", "Cape Horn Routes"];
      else if (lat > 0 && lat < 20 && lng > 40 && lng < 60) affectedLocations = ["Red Sea", "Gulf of Aden"];
      else if (lat > 30 && lat < 50 && lng > -130 && lng < -110) affectedLocations = ["US West Coast Ports", "Pacific Routes"];

      const severity: LiveRiskEvent["severity"] =
        mag >= 7.0 ? "Critical" : mag >= 6.0 ? "High" : "Medium";

      events.push({
        title: `M${mag.toFixed(1)} Earthquake: ${place}`,
        description: `USGS reports a magnitude ${mag.toFixed(1)} earthquake near ${place}. Potential impact on nearby port infrastructure and coastal shipping operations. Tsunami advisory status should be monitored.`,
        category: "Weather",
        severity,
        affectedLocations,
        sourceUrl: props?.url ?? "https://earthquake.usgs.gov",
        sourceProvider: "USGS Earthquake Hazards",
        fetchedAt: new Date().toISOString(),
        coordinates: point,
      });
    }

    return { events, count: events.length, ok: true };
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, "USGS fetch failed");
    return { events, count: 0, ok: false };
  }
}

// ── 4. Country risk baseline (static, hand-maintained, not a live feed) ──────

const COUNTRY_RISK_BASE: Record<string, { base: number; tags: string[]; name: string }> = {
  UA: { base: 85, tags: ["active_conflict", "infrastructure_damage"], name: "Ukraine" },
  RU: { base: 72, tags: ["sanctions", "military_mobilization"], name: "Russia" },
  IL: { base: 78, tags: ["active_conflict", "regional_instability"], name: "Israel" },
  PS: { base: 90, tags: ["active_conflict", "humanitarian_crisis"], name: "Palestine" },
  YE: { base: 88, tags: ["active_conflict", "humanitarian_crisis"], name: "Yemen" },
  IR: { base: 68, tags: ["sanctions", "nuclear_program", "regional_proxy"], name: "Iran" },
  SO: { base: 82, tags: ["terrorism", "state_fragility"], name: "Somalia" },
  LY: { base: 72, tags: ["divided_government", "militia_control"], name: "Libya" },
  MM: { base: 76, tags: ["civil_unrest", "military_junta"], name: "Myanmar" },
  SD: { base: 84, tags: ["active_conflict", "humanitarian_crisis"], name: "Sudan" },
};

async function fetchCountryRiskEvents(): Promise<FetcherResult> {
  const events: LiveRiskEvent[] = [];

  // Only emit country risk events for HIGH/CRITICAL countries that affect shipping
  const criticalCountries = Object.entries(COUNTRY_RISK_BASE)
    .filter(([code, data]) => data.base >= 72 && COUNTRY_TO_REGIONS[code])
    .sort(([, a], [, b]) => b.base - a.base)
    .slice(0, 5); // Top 5 most critical

  for (const [code, data] of criticalCountries) {
    const regions = COUNTRY_TO_REGIONS[code] ?? ["Regional Shipping Lanes"];
    const severity: LiveRiskEvent["severity"] =
      data.base >= 85 ? "Critical" : data.base >= 72 ? "High" : "Medium";

    events.push({
      title: `Elevated Country Risk: ${data.name} (Score ${data.base}/100)`,
      description: `${data.name} carries a composite country risk score of ${data.base}/100. Active risk factors: ${data.tags.join(", ")}. Shipping routes passing through or near ${regions.join(", ")} may face elevated security, regulatory, or operational risk.`,
      category: "Geopolitical",
      severity,
      affectedLocations: regions,
      sourceUrl: "https://github.com/simplifaisoul/osiris",
      sourceProvider: BASELINE_PROVIDER,
      fetchedAt: new Date().toISOString(),
    });
  }

  return { events, count: events.length, ok: true };
}

// ── Master Fetch Function ─────────────────────────────────────────────────────

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

let cached: { at: number; value: DataFetchSummary } | null = null;
let inFlight: Promise<DataFetchSummary> | null = null;
let generation = 0; // bumped on clear so a fetch started before it cannot repopulate the cache

export function clearFeedCache(): void {
  cached = null;
  inFlight = null;
  generation++;
}

async function timed(name: string, kind: SourceKind, fn: () => Promise<FetcherResult>) {
  const start = Date.now();
  const result = await fn().catch((): FetcherResult => ({ events: [], count: 0, ok: false }));
  const summary: SourceSummary = { name, count: result.count, ok: result.ok, kind, latencyMs: Date.now() - start };
  return { events: result.events, summary };
}

async function fetchFresh(): Promise<DataFetchSummary> {
  const fetchedAt = new Date().toISOString();
  const results = await Promise.all([
    timed("RSS news (maritime press + BBC/AJZ/NYT)", "live", fetchRssOsint),
    timed("NASA EONET", "live", fetchNasaEonet),
    timed("USGS Earthquakes", "live", fetchUsgsEarthquakes),
    timed("Country Risk Baseline (static)", "baseline", fetchCountryRiskEvents),
  ]);

  // Drop events that fail the schema, then dedupe by title prefix
  const seen = new Set<string>();
  const events: LiveRiskEvent[] = [];
  for (const event of results.flatMap((r) => r.events)) {
    if (!liveEventSchema.safeParse(event).success) {
      log.warn({ title: event.title, provider: event.sourceProvider }, "Dropped event failing schema");
      continue;
    }
    const key = event.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
  events.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    events: events.slice(0, 30),
    fetchedAt,
    sources: results.map((r) => r.summary),
  };
}

/**
 * Fetch all sources in parallel. Results are cached for FEED_CACHE_TTL_MS (feeds update
 * slowly and every evaluation would otherwise hit five remote hosts), and concurrent
 * callers share one in-flight fetch. A fetch where every live source failed is not cached.
 * `force` bypasses the cache (used by the measurement script).
 */
export async function fetchAllRealTimeIntelligence(opts: { force?: boolean } = {}): Promise<DataFetchSummary> {
  if (!opts.force && cached && Date.now() - cached.at < FEED_CACHE_TTL_MS) return cached.value;
  if (!opts.force && inFlight) return inFlight;

  const startedIn = generation;
  const pending = fetchFresh()
    .then((value) => {
      if (startedIn === generation && value.sources.some((s) => s.kind === "live" && s.ok)) {
        cached = { at: Date.now(), value };
      }
      return value;
    })
    .finally(() => {
      if (inFlight === pending) inFlight = null;
    });
  if (!opts.force) inFlight = pending;
  return pending;
}
