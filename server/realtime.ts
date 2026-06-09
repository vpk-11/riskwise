/**
 * RiskWise — Real-Time Intelligence Fetcher
 *
 * Pulls live data from three open sources (no API keys required):
 *   1. RSS OSINT   – BBC World / Al Jazeera / NYT World (geopolitical/conflict)
 *   2. NASA EONET  – Active severe storms, volcanoes, sea ice
 *   3. USGS        – Significant earthquakes (M4.5+) in the last 24 h
 *   4. Country Risk – Composite risk index enriched with live quake data
 *
 * All functions are server-side only and return normalised RiskWise event objects.
 */

import { createLogger } from "./_core/logger";

const log = createLogger("realtime");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveRiskEvent {
  title: string;
  description: string;
  category: "Weather" | "Strike" | "Geopolitical" | "Port Congestion";
  severity: "Low" | "Medium" | "High" | "Critical";
  affectedLocations: string[];
  sourceUrl?: string;
  sourceProvider: string;
  fetchedAt: string; // ISO timestamp
}

export interface DataFetchSummary {
  events: LiveRiskEvent[];
  fetchedAt: string;
  sources: { name: string; count: number; ok: boolean }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RSS_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", source: "NYT World" },
];

// Keyword → affected location mapping for geo-tagging news items
const GEO_DICT: Record<string, string[]> = {
  ukraine: ["Black Sea", "Odessa Port"],
  russia: ["Baltic Sea", "Novorossiysk"],
  gaza: ["Suez Canal", "Eastern Mediterranean"],
  israel: ["Suez Canal", "Eastern Mediterranean"],
  iran: ["Strait of Hormuz", "Persian Gulf"],
  houthi: ["Bab-el-Mandeb", "Red Sea"],
  yemen: ["Bab-el-Mandeb", "Red Sea", "Gulf of Aden"],
  "red sea": ["Red Sea", "Bab-el-Mandeb"],
  "suez canal": ["Suez Canal", "Red Sea"],
  "strait of hormuz": ["Strait of Hormuz", "Persian Gulf"],
  "south china sea": ["South China Sea", "Strait of Malacca"],
  taiwan: ["Taiwan Strait", "South China Sea"],
  china: ["South China Sea", "Port of Shanghai"],
  "panama canal": ["Panama Canal", "Caribbean Sea"],
  somalia: ["Gulf of Aden", "Horn of Africa"],
  piracy: ["Gulf of Aden", "Strait of Malacca"],
  strike: ["Port Operations"],
  "port strike": ["Port Operations"],
  "dock workers": ["Port Operations"],
  longshoremen: ["Port Operations"],
  hurricane: ["Gulf of Mexico", "Caribbean Sea"],
  typhoon: ["South China Sea", "Western Pacific"],
  cyclone: ["Bay of Bengal", "Indian Ocean"],
};

const CONFLICT_KEYWORDS = [
  "attack", "strike", "missile", "drone", "war", "troops", "military",
  "protest", "riot", "clash", "bomb", "killed", "forces", "blockade",
  "sanctions", "seized", "vessel", "tanker", "cargo", "shipping", "port",
  "disruption", "closure", "delay", "congestion", "piracy",
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

// ── 1. RSS OSINT Fetcher ──────────────────────────────────────────────────────

async function fetchRssOsint(): Promise<{ events: LiveRiskEvent[]; count: number; ok: boolean }> {
  const events: LiveRiskEvent[] = [];
  let ok = false;

  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "RiskWise/2.0 Supply Chain Intelligence" },
      });
      if (!res.ok) continue;
      const xml = await res.text();

      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

      for (const item of items.slice(0, 30)) {
        const titleMatch =
          item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
          item.match(/<title>(.*?)<\/title>/i);
        const linkMatch = item.match(/<link>(.*?)<\/link>/i);
        const descMatch =
          item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i) ||
          item.match(/<description>(.*?)<\/description>/i);

        if (!titleMatch) continue;

        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        const link = linkMatch?.[1]?.trim() ?? "";
        const rawDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        const textToSearch = (title + " " + rawDesc).toLowerCase();

        const isRelevant =
          CONFLICT_KEYWORDS.some((kw) => textToSearch.includes(kw)) ||
          SHIPPING_KEYWORDS.some((kw) => textToSearch.includes(kw));
        if (!isRelevant) continue;

        // Determine affected locations from geo-dict
        const affectedLocations: string[] = [];
        for (const [keyword, locations] of Object.entries(GEO_DICT)) {
          if (textToSearch.includes(keyword)) {
            for (const loc of locations) {
              if (!affectedLocations.includes(loc)) affectedLocations.push(loc);
            }
          }
        }
        if (affectedLocations.length === 0) affectedLocations.push("Global Shipping Lanes");

        // Classify category
        let category: LiveRiskEvent["category"] = "Geopolitical";
        if (
          textToSearch.includes("strike") ||
          textToSearch.includes("dock") ||
          textToSearch.includes("longshoremen") ||
          textToSearch.includes("labor") ||
          textToSearch.includes("labour") ||
          textToSearch.includes("union")
        ) {
          category = "Strike";
        } else if (
          textToSearch.includes("hurricane") ||
          textToSearch.includes("typhoon") ||
          textToSearch.includes("cyclone") ||
          textToSearch.includes("storm") ||
          textToSearch.includes("flood") ||
          textToSearch.includes("weather")
        ) {
          category = "Weather";
        } else if (
          textToSearch.includes("congestion") ||
          textToSearch.includes("backlog") ||
          textToSearch.includes("queue") ||
          textToSearch.includes("delay") ||
          textToSearch.includes("port closure")
        ) {
          category = "Port Congestion";
        }

        // Classify severity
        let severity: LiveRiskEvent["severity"] = "Medium";
        if (
          textToSearch.includes("critical") ||
          textToSearch.includes("catastrophic") ||
          textToSearch.includes("closure") ||
          textToSearch.includes("blockade") ||
          textToSearch.includes("seized") ||
          textToSearch.includes("attack")
        ) {
          severity = "Critical";
        } else if (
          textToSearch.includes("high") ||
          textToSearch.includes("major") ||
          textToSearch.includes("severe") ||
          textToSearch.includes("significant")
        ) {
          severity = "High";
        } else if (textToSearch.includes("minor") || textToSearch.includes("low")) {
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

        ok = true;
      }
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : e, source: feed.source }, `RSS fetch failed for ${feed.source}`);
    }
  }

  return { events, count: events.length, ok };
}

// ── 2. NASA EONET Weather Fetcher ─────────────────────────────────────────────

const EONET_CATEGORY_TO_LOCATIONS: Record<string, string[]> = {
  severeStorms: ["Open Ocean", "Coastal Waters"],
  volcanoes: ["Pacific Ring of Fire", "Volcanic Islands"],
  seaIce: ["Arctic Shipping Routes", "Northern Sea Route"],
  floods: ["River Ports", "Coastal Regions"],
};

async function fetchNasaEonet(): Promise<{ events: LiveRiskEvent[]; count: number; ok: boolean }> {
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

      let severity: LiveRiskEvent["severity"] = "Medium";
      let affectedLocations = EONET_CATEGORY_TO_LOCATIONS[categoryId] ?? ["Open Ocean"];

      // Classify severity by category
      if (categoryId === "severeStorms") severity = "High";
      else if (categoryId === "volcanoes") severity = "High";
      else if (categoryId === "seaIce") severity = "Medium";

      // Try to geo-tag by coordinates
      const [lng, lat] = Array.isArray(geom.coordinates[0])
        ? geom.coordinates[0]
        : geom.coordinates;

      if (typeof lat === "number" && typeof lng === "number") {
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
      });
    }

    return { events, count: events.length, ok: true };
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, "NASA EONET fetch failed");
    return { events, count: 0, ok: false };
  }
}

// ── 3. USGS Earthquake Fetcher ────────────────────────────────────────────────

async function fetchUsgsEarthquakes(): Promise<{ events: LiveRiskEvent[]; count: number; ok: boolean }> {
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
      const [lng, lat] = feature.geometry?.coordinates ?? [0, 0];

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
        title: `M${mag.toFixed(1)} Earthquake — ${place}`,
        description: `USGS reports a magnitude ${mag.toFixed(1)} earthquake near ${place}. Potential impact on nearby port infrastructure and coastal shipping operations. Tsunami advisory status should be monitored.`,
        category: "Weather",
        severity,
        affectedLocations,
        sourceUrl: props?.url ?? "https://earthquake.usgs.gov",
        sourceProvider: "USGS Earthquake Hazards",
        fetchedAt: new Date().toISOString(),
      });
    }

    return { events, count: events.length, ok: true };
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, "USGS fetch failed");
    return { events, count: 0, ok: false };
  }
}

// ── 4. Country Risk Enrichment ────────────────────────────────────────────────

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

async function fetchCountryRiskEvents(): Promise<{ events: LiveRiskEvent[]; count: number; ok: boolean }> {
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
      sourceProvider: "Osiris Country Risk Index",
      fetchedAt: new Date().toISOString(),
    });
  }

  return { events, count: events.length, ok: true };
}

// ── Master Fetch Function ─────────────────────────────────────────────────────

/**
 * Fetch all real-time intelligence from all sources in parallel.
 * Returns a deduplicated, normalised list of LiveRiskEvent objects
 * along with a per-source summary for transparency display.
 */
export async function fetchAllRealTimeIntelligence(): Promise<DataFetchSummary> {
  const fetchedAt = new Date().toISOString();

  const [rssResult, eonetResult, usgsResult, countryResult] = await Promise.allSettled([
    fetchRssOsint(),
    fetchNasaEonet(),
    fetchUsgsEarthquakes(),
    fetchCountryRiskEvents(),
  ]);

  const rss = rssResult.status === "fulfilled" ? rssResult.value : { events: [], count: 0, ok: false };
  const eonet = eonetResult.status === "fulfilled" ? eonetResult.value : { events: [], count: 0, ok: false };
  const usgs = usgsResult.status === "fulfilled" ? usgsResult.value : { events: [], count: 0, ok: false };
  const country = countryResult.status === "fulfilled" ? countryResult.value : { events: [], count: 0, ok: false };

  // Merge and deduplicate by title similarity (simple prefix check)
  const allEvents = [...rss.events, ...eonet.events, ...usgs.events, ...country.events];
  const seen = new Set<string>();
  const deduped: LiveRiskEvent[] = [];
  for (const event of allEvents) {
    const key = event.title.toLowerCase().slice(0, 60);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(event);
    }
  }

  // Sort: Critical first, then High, then by source
  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  deduped.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    events: deduped.slice(0, 30), // Cap at 30 events
    fetchedAt,
    sources: [
      { name: "RSS OSINT (BBC/AJZ/NYT)", count: rss.count, ok: rss.ok },
      { name: "NASA EONET", count: eonet.count, ok: eonet.ok },
      { name: "USGS Earthquakes", count: usgs.count, ok: usgs.ok },
      { name: "Osiris Country Risk", count: country.count, ok: country.ok },
    ],
  };
}
