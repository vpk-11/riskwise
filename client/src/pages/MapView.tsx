import { useState, useCallback, useRef, useEffect } from "react";
import type { Feature, FeatureCollection, Point, LineString } from "geojson";
import maplibregl from "maplibre-gl";
import { MapView as LibreMap } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { getRiskColor, getSeverityColor, toMapColor } from "@/lib/riskUtils";
import { popupHTML } from "@/lib/mapPopup";
import { AlertTriangle, Layers, Eye, EyeOff, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRoute, LOCATION_POINTS, unwrapAntimeridian } from "@shared/geo";
import { resolvePort } from "@shared/ports";

// ── Source/layer IDs ─────────────────────────────────────────────────────────

const SRC = {
  baseRoutes: "base-routes",
  evalRoutes: "eval-routes",
  altRoutes: "alt-routes",
  disruptions: "disruptions",
} as const;

const LAYER = {
  baseLines: "base-routes-line",
  evalLines: "eval-routes-line",
  altLines: "alt-routes-line",
  disruptionZones: "disruption-zones",
  disruptionPoints: "disruption-points",
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

type RiskEvent = {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: string;
  affectedLocations: unknown;
  longitude: number | null;
  latitude: number | null;
};

type RouteRecord = {
  id: number;
  waypoints: unknown;
};

type EvalRecord = {
  originPort: string;
  destinationPort: string;
  overallRiskScore: number;
  alternativeRoutes: unknown;
};

function buildBaseRouteGeoJSON(routes: RouteRecord[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) => {
      const wp = route.waypoints as [number, number][];
      if (!wp || wp.length < 2) return [];
      const f: Feature<LineString> = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: wp },
        properties: {},
      };
      return [f];
    }),
  };
}

function buildEvalRouteGeoJSON(history: EvalRecord[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: history.flatMap((ev) => {
      const origin = resolvePort(ev.originPort);
      const dest = resolvePort(ev.destinationPort);
      if (!origin || !dest) return [];
      const f: Feature<LineString> = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: unwrapAntimeridian(buildRoute(origin, dest).waypoints) },
        properties: { color: toMapColor(getRiskColor(ev.overallRiskScore)) },
      };
      return [f];
    }),
  };
}

/**
 * Alternative lanes from past evaluations. Only rows with an optionId are drawn: those were computed on the
 * sea-lane graph. Older rows hold model-invented waypoints and are skipped.
 */
function buildAltRouteGeoJSON(history: EvalRecord[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: history.flatMap((ev) =>
      ((ev.alternativeRoutes as { optionId?: string; waypoints?: [number, number][]; riskScore?: number }[] | null) ?? []).flatMap((alt) => {
        if (!alt.optionId || !Array.isArray(alt.waypoints) || alt.waypoints.length < 2) return [];
        const f: Feature<LineString> = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: unwrapAntimeridian(alt.waypoints) },
          properties: { color: toMapColor(getRiskColor(alt.riskScore ?? 0)) },
        };
        return [f];
      }),
    ),
  };
}

function buildDisruptionGeoJSON(events: RiskEvent[]): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  events.forEach((ev) => {
    // Exact coordinates from the source win; otherwise plot each labelled region that resolves.
    const exact: [number, number][] =
      ev.longitude !== null && ev.latitude !== null ? [[ev.longitude, ev.latitude]] : [];
    const labelled = (ev.affectedLocations as string[]).flatMap((loc) => {
      const coord = LOCATION_POINTS[loc.trim().toLowerCase()];
      return coord ? [coord] : [];
    });
    (exact.length > 0 ? exact : labelled).forEach((coord) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: {
          id: ev.id,
          title: ev.title,
          description: ev.description,
          category: ev.category,
          severity: ev.severity,
          color: toMapColor(getSeverityColor(ev.severity)),
          radius: ev.severity === "Critical" ? 14 : ev.severity === "High" ? 10 : 7,
        },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

// ── Source/layer setup on first map load ─────────────────────────────────────

function initLayers(map: maplibregl.Map) {
  const emptyFC = { type: "FeatureCollection" as const, features: [] };

  map.addSource(SRC.baseRoutes, { type: "geojson", data: emptyFC });
  map.addSource(SRC.evalRoutes, { type: "geojson", data: emptyFC });
  map.addSource(SRC.altRoutes, { type: "geojson", data: emptyFC });
  map.addSource(SRC.disruptions, { type: "geojson", data: emptyFC });

  map.addLayer({
    id: LAYER.baseLines,
    type: "line",
    source: SRC.baseRoutes,
    paint: { "line-color": "#1e4a7a", "line-opacity": 0.4, "line-width": 1.5 },
  });

  map.addLayer({
    id: LAYER.evalLines,
    type: "line",
    source: SRC.evalRoutes,
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": 0.85,
      "line-width": 3,
    },
  });

  map.addLayer({
    id: LAYER.altLines,
    type: "line",
    source: SRC.altRoutes,
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": 0.7,
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });

  map.addLayer({
    id: LAYER.disruptionZones,
    type: "circle",
    source: SRC.disruptions,
    paint: {
      "circle-color": ["get", "color"],
      "circle-opacity": 0.08,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-opacity": 0.5,
      "circle-stroke-width": 1.5,
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        2, ["*", ["get", "radius"], 3],
        6, ["*", ["get", "radius"], 8],
      ],
    },
  });

  map.addLayer({
    id: LAYER.disruptionPoints,
    type: "circle",
    source: SRC.disruptions,
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["get", "radius"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.95,
    },
  });
}

function setSourceData(
  map: maplibregl.Map,
  id: string,
  data: FeatureCollection
) {
  const src = map.getSource(id);
  if (src && src.type === "geojson") {
    (src as maplibregl.GeoJSONSource).setData(data);
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MapView() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const layersInitRef = useRef(false);

  const [showRoutes, setShowRoutes] = useState(true);
  const [showDisruptions, setShowDisruptions] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  const { data: disruptions, isLoading: disruptionsLoading, refetch } =
    trpc.events.active.useQuery(undefined, { refetchInterval: 60000 });
  const { data: routes, isLoading: routesLoading } =
    trpc.routes.allRoutes.useQuery();
  const { data: history } = trpc.routes.history.useQuery({ limit: 5 });

  const isLoading = disruptionsLoading || routesLoading;

  // Push updated GeoJSON into sources whenever data or visibility changes
  const syncLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !layersInitRef.current) return;

    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    setSourceData(map, SRC.baseRoutes, showRoutes && routes ? buildBaseRouteGeoJSON(routes) : empty);
    setSourceData(map, SRC.evalRoutes, showRoutes && history ? buildEvalRouteGeoJSON(history) : empty);
    setSourceData(map, SRC.altRoutes, showRoutes && history ? buildAltRouteGeoJSON(history) : empty);
    setSourceData(map, SRC.disruptions, showDisruptions && disruptions ? buildDisruptionGeoJSON(disruptions) : empty);
  }, [routes, history, disruptions, showRoutes, showDisruptions]);

  useEffect(() => { syncLayers(); }, [syncLayers]);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;
    initLayers(map);
    layersInitRef.current = true;
    setMapReady(true);

    // Popup on disruption point click
    map.on("click", LAYER.disruptionPoints, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as Record<string, string>;
      const coords = (feature.geometry as Point).coordinates as [number, number];

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        className: "riskwise-popup",
        maxWidth: "300px",
      })
        .setLngLat(coords)
        .setHTML(popupHTML(props))
        .addTo(map);
    });

    map.on("mouseenter", LAYER.disruptionPoints, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER.disruptionPoints, () => {
      map.getCanvas().style.cursor = "";
    });
  }, []);

  // Sync after map ready (data may arrive before or after)
  useEffect(() => {
    if (mapReady) syncLayers();
  }, [mapReady, syncLayers]);

  const handleToggleRoutes = () => setShowRoutes((v) => !v);
  const handleToggleDisruptions = () => setShowDisruptions((v) => !v);
  const handleRefresh = () => refetch();

  return (
    <div className="relative h-full w-full">
      <LibreMap
        onMapReady={handleMapReady}
        initialCenter={[20, 20]}
        initialZoom={2.5}
        className="w-full h-full"
      />

      {/* Loading overlay */}
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.08_0.02_240)] z-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <span className="text-xs font-mono text-primary/70 tracking-widest">
              LOADING MAP...
            </span>
          </div>
        </div>
      )}

      {/* Data loading indicator */}
      {isLoading && mapReady && (
        <div className="absolute top-4 left-16 cyber-card px-3 py-2 z-10 flex items-center gap-2">
          <Loader2 className="w-3 h-3 text-primary animate-spin" />
          <span className="text-xs font-mono text-primary">ATHENA SCANNING...</span>
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <div className="cyber-card p-3 space-y-2 min-w-[180px]">
          <div className="text-[11px] font-mono text-muted-foreground tracking-widest uppercase mb-3 flex items-center gap-1.5">
            <Layers className="w-3 h-3" />
            Map Layers
          </div>
          <button
            onClick={handleToggleRoutes}
            className={cn(
              "flex items-center gap-2 text-xs font-mono w-full px-2 py-1.5 rounded-sm transition-all",
              showRoutes
                ? "text-[oklch(0.72_0.22_195)] bg-[oklch(0.72_0.22_195/0.1)] border border-[oklch(0.72_0.22_195/0.3)]"
                : "text-muted-foreground border border-border"
            )}
          >
            {showRoutes ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Shipping Routes
          </button>
          <button
            onClick={handleToggleDisruptions}
            className={cn(
              "flex items-center gap-2 text-xs font-mono w-full px-2 py-1.5 rounded-sm transition-all",
              showDisruptions
                ? "text-[oklch(0.65_0.25_25)] bg-[oklch(0.65_0.25_25/0.1)] border border-[oklch(0.65_0.25_25/0.3)]"
                : "text-muted-foreground border border-border"
            )}
          >
            {showDisruptions ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Disruptions
          </button>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 text-xs font-mono w-full px-2 py-1.5 rounded-sm text-muted-foreground border border-border hover:text-foreground transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>

        <div className="cyber-card p-3 min-w-[180px]">
          <div className="text-[11px] font-mono text-muted-foreground tracking-widest uppercase mb-3">
            Risk Legend
          </div>
          <div className="space-y-1.5">
            {[
              { label: "Low (0–30)", color: "oklch(0.75 0.20 145)" },
              { label: "Moderate (31–60)", color: "oklch(0.80 0.20 75)" },
              { label: "High / Critical (61+)", color: "oklch(0.65 0.25 25)" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                />
                <span className="text-[11px] font-mono text-muted-foreground">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alert count */}
      {disruptions && disruptions.length > 0 && (
        <div className="absolute bottom-4 left-4 cyber-card px-4 py-2 flex items-center gap-2 z-10">
          <AlertTriangle className="w-4 h-4 text-[oklch(0.65_0.25_25)] neon-pulse" />
          <span className="text-sm font-mono">
            <span className="text-[oklch(0.65_0.25_25)] font-bold">
              {disruptions.filter(
                (d) => d.severity === "Critical" || d.severity === "High"
              ).length}
            </span>
            <span className="text-muted-foreground"> critical/high alerts active</span>
          </span>
        </div>
      )}
    </div>
  );
}
