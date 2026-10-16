import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASELINE_PROVIDER, clearFeedCache, fetchAllRealTimeIntelligence, UNLOCATED_LABEL } from "./realtime";
import { scoreRoute } from "./scoring";

const GCAPTAIN = "gcaptain.com";
const SEATRADE = "seatrade-maritime.com";
const BBC = "feeds.bbci.co.uk";
const AJZ = "aljazeera.com";
const NYT = "nytimes.com";
const EONET = "eonet.gsfc.nasa.gov";
const USGS = "earthquake.usgs.gov";

const rssItem = (title: string, desc = "Details of the incident at sea") =>
  `<item><title><![CDATA[${title}]]></title><link>https://x.test/${encodeURIComponent(title)}</link><description><![CDATA[${desc}]]></description></item>`;
const rss = (...items: string[]) => `<rss><channel>${items.join("")}</channel></rss>`;

const eonet = (events: unknown[]) => JSON.stringify({ events });
const usgs = (features: unknown[]) => JSON.stringify({ features });

type Handler = () => Response | Promise<Response>;
const ok = (body: string) => () => new Response(body, { status: 200 });
const status = (code: number) => () => new Response("err", { status: code });
const down = () => {
  throw new TypeError("fetch failed");
};
const timeout = () => {
  throw new DOMException("The operation timed out", "TimeoutError");
};

function mockFetch(handlers: Partial<Record<string, Handler>>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const host = Object.keys(handlers).find((h) => url.includes(h));
    if (!host) throw new Error(`unexpected fetch ${url}`);
    return handlers[host]!();
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const allHandlers = (over: Partial<Record<string, Handler>> = {}) => ({
  [GCAPTAIN]: ok(rss()),
  [SEATRADE]: ok(rss()),
  [BBC]: ok(rss()),
  [AJZ]: ok(rss()),
  [NYT]: ok(rss()),
  [EONET]: ok(eonet([])),
  [USGS]: ok(usgs([])),
  ...over,
});

const source = (summary: Awaited<ReturnType<typeof fetchAllRealTimeIntelligence>>, name: string) =>
  summary.sources.find((s) => s.name.startsWith(name))!;

beforeEach(() => clearFeedCache());
afterEach(() => vi.unstubAllGlobals());

describe("fetchAllRealTimeIntelligence degradation", () => {
  it("with every live feed unreachable, flags them failed and returns only baseline events", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: down, [SEATRADE]: down, [BBC]: down, [AJZ]: down, [NYT]: down, [EONET]: down, [USGS]: down }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.sources.filter((s) => s.kind === "live").every((s) => !s.ok)).toBe(true);
    expect(source(r, "Country Risk").ok).toBe(true);
    expect(source(r, "Country Risk").kind).toBe("baseline");
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.every((e) => e.sourceProvider === BASELINE_PROVIDER)).toBe(true);
  });

  it("treats HTTP 500 as a failed source", async () => {
    mockFetch(allHandlers({ [EONET]: status(500), [USGS]: status(503) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(source(r, "NASA EONET").ok).toBe(false);
    expect(source(r, "USGS").ok).toBe(false);
    expect(source(r, "RSS").ok).toBe(true);
  });

  it("treats a timeout as a failed source without failing the others", async () => {
    mockFetch(allHandlers({ [USGS]: timeout }));
    const r = await fetchAllRealTimeIntelligence();
    expect(source(r, "USGS").ok).toBe(false);
    expect(source(r, "NASA EONET").ok).toBe(true);
  });

  it("keeps a healthy feed with malformed XML as ok with zero events", async () => {
    mockFetch(allHandlers({ [BBC]: ok("<<<not xml"), [AJZ]: ok("garbage"), [NYT]: ok("") }));
    const r = await fetchAllRealTimeIntelligence();
    expect(source(r, "RSS").ok).toBe(true);
    expect(source(r, "RSS").count).toBe(0);
  });

  it("survives malformed JSON from EONET", async () => {
    mockFetch(allHandlers({ [EONET]: ok("{not json") }));
    const r = await fetchAllRealTimeIntelligence();
    expect(source(r, "NASA EONET").ok).toBe(false);
  });

  it("records per-source latency", async () => {
    mockFetch(allHandlers());
    const r = await fetchAllRealTimeIntelligence();
    for (const s of r.sources) expect(s.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchAllRealTimeIntelligence parsing", () => {
  it("classifies an RSS shipping incident and geo-tags it", async () => {
    mockFetch(allHandlers({ [BBC]: ok(rss(rssItem("Houthi attack on tanker in the Red Sea"))) }));
    const r = await fetchAllRealTimeIntelligence();
    const e = r.events.find((x) => x.title.includes("Houthi"))!;
    expect(e.category).toBe("Geopolitical");
    expect(e.severity).toBe("Critical");
    expect(e.affectedLocations).toEqual(expect.arrayContaining(["Red Sea", "Bab-el-Mandeb"]));
  });

  it("accepts a maritime trade-press item on a disruption term alone, but not a general-news one", async () => {
    mockFetch(
      allHandlers({
        [GCAPTAIN]: ok(rss(rssItem("Houthi attack on Red Sea convoy", "Escalation continues"))),
        [BBC]: ok(rss(rssItem("Houthi attack in the news today", "Politics and analysis"))),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    const titles = r.events.map((e) => e.title);
    expect(titles).toContain("Houthi attack on Red Sea convoy");
    expect(titles).not.toContain("Houthi attack in the news today");
  });

  it("fetches the RSS feeds in parallel", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const isRss = [GCAPTAIN, SEATRADE, BBC, AJZ, NYT].some((h) => url.includes(h));
        if (isRss) {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight--;
          return new Response(rss(), { status: 200 });
        }
        return new Response(url.includes(EONET) ? eonet([]) : usgs([]), { status: 200 });
      }),
    );
    await fetchAllRealTimeIntelligence();
    expect(peak).toBe(5);
  });

  it("requires both a shipping term and a disruption term", async () => {
    mockFetch(
      allHandlers({
        [BBC]: ok(
          rss(
            rssItem("Attack changed a country politics", "Analysis of elections and war memories"),
            rssItem("New cargo terminal opens", "Ribbon cutting at the harbour"),
            rssItem("Tanker seized near Hormuz", "Vessel taken by forces"),
          ),
        ),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    const titles = r.events.map((e) => e.title);
    expect(titles).toContain("Tanker seized near Hormuz");
    expect(titles).not.toContain("Attack changed a country politics");
    expect(titles).not.toContain("New cargo terminal opens");
  });

  it("ignores RSS items unrelated to shipping or conflict", async () => {
    mockFetch(allHandlers({ [BBC]: ok(rss(rssItem("Local bakery wins award", "Great sourdough"))) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.find((x) => x.title.includes("bakery"))).toBeUndefined();
  });

  it("keeps EONET coordinates, skips wildfires, and reads USGS magnitude to severity", async () => {
    mockFetch(
      allHandlers({
        [EONET]: ok(
          eonet([
            { title: "Typhoon Alpha", categories: [{ id: "severeStorms", title: "Severe Storms" }], geometry: [{ date: new Date().toISOString(), coordinates: [125, 20] }], sources: [] },
            { title: "Hurricane Old", categories: [{ id: "severeStorms" }], geometry: [{ date: "2020-08-01T00:00:00Z", coordinates: [-70, 30] }] },
            { title: "Fire", categories: [{ id: "wildfires" }], geometry: [{ coordinates: [1, 1] }] },
          ]),
        ),
        [USGS]: ok(
          usgs([
            { properties: { mag: 7.2, place: "Off Japan", url: "https://u" }, geometry: { coordinates: [142, 38] } },
            { properties: { mag: 4.9, place: "Minor" }, geometry: { coordinates: [0, 0] } },
          ]),
        ),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    const storm = r.events.find((e) => e.title === "Typhoon Alpha")!;
    expect(storm.coordinates).toEqual([125, 20]);
    expect(r.events.find((e) => e.title === "Fire")).toBeUndefined();
    expect(r.events.find((e) => e.title === "Hurricane Old")).toBeUndefined();
    const quake = r.events.find((e) => e.title.startsWith("M7.2"))!;
    expect(quake.severity).toBe("Critical");
    expect(quake.coordinates).toEqual([142, 38]);
    expect(r.events.find((e) => e.title.includes("Minor"))).toBeUndefined();
  });
});

describe("fetchAllRealTimeIntelligence dedup and cap", () => {
  it("dedupes the same headline from two feeds", async () => {
    const item = rssItem("Container ship blockade at the Strait of Hormuz");
    mockFetch(allHandlers({ [BBC]: ok(rss(item)), [NYT]: ok(rss(item)) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.filter((e) => e.title.startsWith("Container ship blockade"))).toHaveLength(1);
  });

  it("caps the result at 30 events, most severe first", async () => {
    const many = (prefix: string) =>
      rss(...Array.from({ length: 30 }, (_, i) => rssItem(`${prefix} port delay number ${i} at harbour`)));
    mockFetch(allHandlers({ [BBC]: ok(many("alpha")), [AJZ]: ok(many("bravo")), [NYT]: ok(many("charlie")) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events).toHaveLength(30);
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const ranks = r.events.map((e) => order[e.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("fetchAllRealTimeIntelligence cache", () => {
  it("serves repeat calls from cache without refetching", async () => {
    const fetchFn = mockFetch(allHandlers());
    await fetchAllRealTimeIntelligence();
    const calls = fetchFn.mock.calls.length;
    await fetchAllRealTimeIntelligence();
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const fetchFn = mockFetch(allHandlers());
    await Promise.all([fetchAllRealTimeIntelligence(), fetchAllRealTimeIntelligence(), fetchAllRealTimeIntelligence()]);
    expect(fetchFn.mock.calls.length).toBe(7); // 5 RSS + EONET + USGS, once
  });

  it("bypasses the cache with force", async () => {
    const fetchFn = mockFetch(allHandlers());
    await fetchAllRealTimeIntelligence();
    const calls = fetchFn.mock.calls.length;
    await fetchAllRealTimeIntelligence({ force: true });
    expect(fetchFn.mock.calls.length).toBe(calls * 2);
  });

  it("does not cache a fetch where every live source failed", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: down, [SEATRADE]: down, [BBC]: down, [AJZ]: down, [NYT]: down, [EONET]: down, [USGS]: down }));
    await fetchAllRealTimeIntelligence();
    const fetchFn = mockFetch(allHandlers());
    const r = await fetchAllRealTimeIntelligence();
    expect(fetchFn).toHaveBeenCalled();
    expect(source(r, "USGS").ok).toBe(true);
  });
});

describe("coordinates and locations", () => {
  const recent = () => new Date().toISOString();

  it("keeps the first vertex of an EONET polygon geometry", async () => {
    mockFetch(
      allHandlers({
        [EONET]: ok(
          eonet([
            {
              title: "Polygon storm",
              categories: [{ id: "severeStorms" }],
              geometry: [{ date: recent(), coordinates: [[[130, 20], [131, 21], [130, 21], [130, 20]]] }],
            },
          ]),
        ),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.find((e) => e.title === "Polygon storm")?.coordinates).toEqual([130, 20]);
  });

  it("skips a USGS quake with no geometry instead of placing it at 0,0", async () => {
    mockFetch(allHandlers({ [USGS]: ok(usgs([{ properties: { mag: 6.5, place: "Nowhere" } }])) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.find((e) => e.title.includes("Nowhere"))).toBeUndefined();
  });

  it("drops an event whose coordinates are out of range", async () => {
    mockFetch(allHandlers({ [USGS]: ok(usgs([{ properties: { mag: 6.5, place: "Bad lat" }, geometry: { coordinates: [10, 95] } }])) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.find((e) => e.title.includes("Bad lat"))).toBeUndefined();
  });

  it("places strike news on a supported port named in the text", async () => {
    mockFetch(allHandlers({ [BBC]: ok(rss(rssItem("Dock workers strike halts Rotterdam container port", "Strike delays cargo ships"))) }));
    const r = await fetchAllRealTimeIntelligence();
    const e = r.events.find((x) => x.title.includes("Rotterdam"))!;
    expect(e.category).toBe("Strike");
    expect(e.affectedLocations).toContain("Port of Rotterdam");
  });
});

describe("classification of strikes and entities", () => {
  it("treats a military strike as geopolitical and a dock-workers strike as labor", async () => {
    mockFetch(
      allHandlers({
        [GCAPTAIN]: ok(
          rss(
            rssItem("Saudi Arabia Strikes Houthi Targets as Red Sea War Escalates", "Tanker traffic halted"),
            rssItem("Drone Attacks Strike Two Ships Near Black Sea", "Vessels hit"),
            rssItem("Dock workers strike halts Rotterdam container port", "Union walkout delays cargo"),
          ),
        ),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    const cat = (needle: string) => r.events.find((e) => e.title.includes(needle))?.category;
    expect(cat("Saudi Arabia Strikes")).toBe("Geopolitical");
    expect(cat("Drone Attacks Strike")).toBe("Geopolitical");
    expect(cat("Dock workers strike")).toBe("Strike");
  });

  it("labels a news item that names no place as unlocated, never with a fake location", async () => {
    mockFetch(
      allHandlers({
        [GCAPTAIN]: ok(
          rss(
            rssItem("Dock workers strike halts container terminals", "Union walkout delays cargo"),
            rssItem("Shipping companies warn of delays as congestion builds", "backlog of vessels"),
          ),
        ),
      }),
    );
    const events = (await fetchAllRealTimeIntelligence()).events.filter((e) => e.sourceProvider === "gCaptain");
    expect(events).toHaveLength(2);
    for (const e of events) expect(e.affectedLocations).toEqual([UNLOCATED_LABEL]);
  });

  it("does not use generic port or lane labels as locations", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("Longshoremen port strike stops cargo handling", "dock workers walkout"), rssItem("Saudi Arabia Strikes Houthi Targets near Red Sea", "ships halted"))) }));
    const labels = (await fetchAllRealTimeIntelligence()).events.flatMap((e) => e.affectedLocations);
    expect(labels).not.toContain("Port Operations");
    expect(labels).not.toContain("Global Shipping Lanes");
  });

  it("an unlocated event adds nothing to a route's score", () => {
    const event = { title: "Dock workers strike", category: "Strike" as const, severity: "Critical" as const, affectedLocations: [UNLOCATED_LABEL] };
    expect(scoreRoute([[0, 0], [10, 0]], [event]).overall).toBe(0);
  });

  it("decodes HTML entities in titles", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("France Seizes &#8216;Shadow Fleet&#8217; Tanker &amp; crew", "seized vessel"))) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.map((e) => e.title)).toContain("France Seizes \u2018Shadow Fleet\u2019 Tanker & crew");
  });
});

describe("feed text safety and parsing", () => {
  it("strips markup that arrives entity-encoded, so stored text cannot become live HTML", async () => {
    mockFetch(
      allHandlers({
        [GCAPTAIN]: ok(rss(rssItem("&lt;img src=x onerror=alert(1)&gt; attack on tanker", "&lt;script&gt;alert(2)&lt;/script&gt; vessel seized"))),
      }),
    );
    const r = await fetchAllRealTimeIntelligence();
    const e = r.events.find((x) => x.title.includes("attack on tanker"))!;
    expect(e.title).not.toMatch(/[<>]/);
    expect(e.description).not.toMatch(/[<>]/);
  });

  it("parses titles and descriptions that span several lines, and strips CDATA from links", async () => {
    const item = `<item>
      <title><![CDATA[Tanker attacked
        near Hormuz]]></title>
      <link><![CDATA[https://x.test/story]]></link>
      <description><![CDATA[Vessel hit
        by missile and crew evacuated, shipping halted.]]></description>
    </item>`;
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(item)) }));
    const r = await fetchAllRealTimeIntelligence();
    const e = r.events.find((x) => x.title.startsWith("Tanker attacked"))!;
    expect(e.title).toBe("Tanker attacked near Hormuz");
    expect(e.description).toContain("missile");
    expect(e.sourceUrl).toBe("https://x.test/story");
  });

  it("classes a military attack that mentions port workers as geopolitical, not labor", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("Houthi attack kills port workers near Red Sea", "vessel hit"))) }));
    const r = await fetchAllRealTimeIntelligence();
    expect(r.events.find((x) => x.title.includes("kills port workers"))?.category).toBe("Geopolitical");
  });

  it("does not let a fetch started before clearFeedCache repopulate the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(USGS)) await gate;
      return new Response(url.includes(EONET) ? eonet([]) : url.includes(USGS) ? usgs([]) : rss(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchFn);
    const first = fetchAllRealTimeIntelligence();
    clearFeedCache();
    release();
    await first;
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchAllRealTimeIntelligence();
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("precision of the news filter", () => {
  it("drops market and feature stories that merely contain a disruption word", async () => {
    mockFetch(
      allHandlers({
        [GCAPTAIN]: ok(
          rss(
            rssItem("DHT spot rates surge 204% in fourth quarter", "Owners expect trade to halt less often"),
            rssItem("South Korean President Hails Arctic Container Shipping Trial, but Delays Loom", "Shipping lines weigh closure risk"),
            rssItem("Houthi missile hits tanker in the Red Sea", "Crew evacuated"),
          ),
        ),
      }),
    );
    const titles = (await fetchAllRealTimeIntelligence()).events.map((e) => e.title);
    expect(titles).toContain("Houthi missile hits tanker in the Red Sea");
    expect(titles.some((t) => t.includes("spot rates"))).toBe(false);
    expect(titles.some((t) => t.includes("Arctic Container"))).toBe(false);
  });

  it("keeps a real incident even when a business word appears in the headline", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("Tanker owner reports Q3 results as drone attack closes terminal", "Vessel damaged"))) }));
    const titles = (await fetchAllRealTimeIntelligence()).events.map((e) => e.title);
    expect(titles.some((t) => t.includes("drone attack"))).toBe(true);
  });

  it("treats seizes and seized alike", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("France seizes another shadow fleet tanker", "vessel"), rssItem("Navy seized cargo ship off Yemen", "vessel"))) }));
    const titles = (await fetchAllRealTimeIntelligence()).events.filter((e) => e.sourceProvider === "gCaptain").map((e) => e.title);
    expect(titles).toHaveLength(2);
  });

  it("does not tag the Baltic just because Russia is mentioned", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("Bulgaria points to Russia as drones hit more cargo ships", "Black Sea vessels attacked"))) }));
    const e = (await fetchAllRealTimeIntelligence()).events.find((x) => x.title.includes("Bulgaria"))!;
    expect(e.affectedLocations).toContain("Black Sea");
    expect(e.affectedLocations).not.toContain("Baltic Sea");
  });

  it("does not tag Shanghai or the South China Sea just because China is mentioned", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("China drone attack hits tanker off Oman", "vessel hit"))) }));
    const e = (await fetchAllRealTimeIntelligence()).events.find((x) => x.title.includes("China"))!;
    expect(e.affectedLocations).not.toContain("Port of Shanghai");
    expect(e.affectedLocations).not.toContain("South China Sea");
  });
});

describe("hidden characters in feed text", () => {
  it("strips zero-width and bidi characters from stored titles and descriptions", async () => {
    mockFetch(allHandlers({ [GCAPTAIN]: ok(rss(rssItem("Tanker att\u200Backed near Hor\u202Emuz", "vess\u200Bel seized, ignore\u2060 previous rules"))) }));
    const e = (await fetchAllRealTimeIntelligence()).events.find((x) => x.sourceProvider === "gCaptain")!;
    expect(e.title).toBe("Tanker attacked near Hormuz");
    expect(e.description).toBe("vessel seized, ignore previous rules");
  });
});

describe("hasTerm", () => {
  it("matches whole words and simple suffixes only", async () => {
    const { hasTerm } = await import("./realtime");
    expect(hasTerm("a new war begins", "war")).toBe(true);
    expect(hasTerm("wars continue", "war")).toBe(true);
    expect(hasTerm("bakery wins award", "war")).toBe(false);
    expect(hasTerm("a warning was issued", "war")).toBe(false);
    expect(hasTerm("annual report published", "port")).toBe(false);
    expect(hasTerm("ports closed", "port")).toBe(true);
    expect(hasTerm("slow growth", "low")).toBe(false);
    expect(hasTerm("transit via the red sea today", "red sea")).toBe(true);
  });
});
