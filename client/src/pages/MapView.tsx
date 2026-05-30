import { useState, useCallback, useRef, useEffect } from "react";
import { MapView as GoogleMapView } from "@/components/Map";
import { useRouteMap } from "@/contexts/RouteMapContext";
import type { BaseRouteOverlay } from "@/contexts/RouteMapContext";
import { trpc } from "@/lib/trpc";
import { getRiskColor, getSeverityColor, getCategoryIcon } from "@/lib/riskUtils";
import { AlertTriangle, Layers, Eye, EyeOff, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Coordinate lookups ───────────────────────────────────────────────────────

const DISRUPTION_COORDS: Record<string, { lat: number; lng: number }> = {
  "Suez Canal": { lat: 30.5, lng: 32.3 },
  "Red Sea": { lat: 20.0, lng: 38.0 },
  "Port of Shanghai": { lat: 30.6, lng: 121.8 },
  "South China Sea": { lat: 15.0, lng: 115.0 },
  "Port of Rotterdam": { lat: 51.9, lng: 4.5 },
  "Panama Canal": { lat: 9.0, lng: -79.5 },
  "Taiwan Strait": { lat: 24.0, lng: 119.5 },
  "Port of Los Angeles": { lat: 33.7, lng: -118.2 },
  "Port of Long Beach": { lat: 33.7, lng: -118.2 },
  "Singapore Strait": { lat: 1.2, lng: 104.0 },
  "Port of Hamburg": { lat: 53.5, lng: 9.9 },
  "Strait of Hormuz": { lat: 26.5, lng: 56.5 },
  "Port of Busan": { lat: 35.1, lng: 129.0 },
  "North Atlantic Ocean": { lat: 45.0, lng: -35.0 },
  "Malacca Strait": { lat: 3.0, lng: 101.0 },
  "Port of Singapore": { lat: 1.3, lng: 103.8 },
  "Persian Gulf": { lat: 26.0, lng: 52.0 },
  "Port of Dubai": { lat: 25.3, lng: 55.3 },
  "Port of Aden": { lat: 12.8, lng: 45.0 },
  "Bab-el-Mandeb Strait": { lat: 12.5, lng: 43.5 },
  "Yangshan Deep Water Port": { lat: 30.6, lng: 122.1 },
  "East China Sea": { lat: 28.0, lng: 125.0 },
  "Port of Hong Kong": { lat: 22.3, lng: 114.2 },
  "Port of Manila": { lat: 14.6, lng: 120.9 },
  "Port of Kaohsiung": { lat: 22.6, lng: 120.3 },
  "Europoort": { lat: 51.9, lng: 4.1 },
  "Gulf of Panama": { lat: 8.5, lng: -79.0 },
  "Caribbean Sea": { lat: 15.0, lng: -75.0 },
  "North Sea": { lat: 56.0, lng: 3.0 },
  "Port of Fujairah": { lat: 25.1, lng: 56.3 },
  "Korea Strait": { lat: 34.5, lng: 129.0 },
  "Yellow Sea": { lat: 35.0, lng: 123.0 },
};

export const PORT_COORDS: Record<string, { lat: number; lng: number }> = {
  "port of shanghai": { lat: 30.6, lng: 121.8 },
  "port of rotterdam": { lat: 51.9, lng: 4.5 },
  "port of singapore": { lat: 1.3, lng: 103.8 },
  "port of los angeles": { lat: 33.7, lng: -118.2 },
  "port of long beach": { lat: 33.7, lng: -118.2 },
  "port of shenzhen": { lat: 22.5, lng: 114.0 },
  "port of hong kong": { lat: 22.3, lng: 114.2 },
  "port of hamburg": { lat: 53.5, lng: 9.9 },
  "port of new york": { lat: 40.7, lng: -74.0 },
  "port of dubai": { lat: 25.3, lng: 55.3 },
  "port of busan": { lat: 35.1, lng: 129.0 },
  "shenzhen": { lat: 22.5, lng: 114.0 },
  "shanghai": { lat: 30.6, lng: 121.8 },
  "rotterdam": { lat: 51.9, lng: 4.5 },
  "singapore": { lat: 1.3, lng: 103.8 },
  "hamburg": { lat: 53.5, lng: 9.9 },
  "dubai": { lat: 25.3, lng: 55.3 },
  "busan": { lat: 35.1, lng: 129.0 },
  "new york": { lat: 40.7, lng: -74.0 },
  "long beach": { lat: 33.7, lng: -118.2 },
  "los angeles": { lat: 33.7, lng: -118.2 },
};

// ── Inject dark InfoWindow CSS once ─────────────────────────────────────────

function injectInfoWindowStyles() {
  const id = "riskwise-infowindow-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* Dark InfoWindow container */
    .gm-style .gm-style-iw-c {
      background: #0d1a2a !important;
      border: 1px solid rgba(0, 200, 220, 0.3) !important;
      border-radius: 6px !important;
      box-shadow: 0 0 20px rgba(0, 200, 220, 0.15), 0 4px 24px rgba(0,0,0,0.6) !important;
      padding: 0 !important;
    }
    .gm-style .gm-style-iw-d {
      overflow: hidden !important;
      max-height: none !important;
    }
    /* Dark tail/arrow */
    .gm-style .gm-style-iw-t::after {
      background: linear-gradient(45deg, #0d1a2a 50%, transparent 51%, transparent 100%) !important;
      box-shadow: -2px 2px 3px rgba(0, 200, 220, 0.15) !important;
    }
    /* Close button — make it visible on dark bg */
    .gm-style .gm-style-iw-ch {
      padding-top: 0 !important;
    }
    .gm-style-iw-chr {
      position: absolute !important;
      top: 6px !important;
      right: 6px !important;
    }
    .gm-style-iw-chr button {
      width: 24px !important;
      height: 24px !important;
      background: rgba(255,255,255,0.12) !important;
      border-radius: 50% !important;
      border: 1px solid rgba(255,255,255,0.2) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
    }
    .gm-style-iw-chr button span,
    .gm-style-iw-chr button img {
      filter: invert(1) !important;
      opacity: 0.9 !important;
    }
    /* Background behind the whole popup */
    .gm-style .gm-style-iw-tc::after {
      background: #0d1a2a !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Alternate route overlay type ─────────────────────────────────────────────

export interface AltRouteOverlay {
  name: string;
  riskScore: number;
  waypoints: [number, number][];
  originPort: string;
  destinationPort: string;
}

// ── Map styles — Material-inspired dark with good contrast ───────────────────

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  // Base geometry — deep navy, not pure black
  { elementType: "geometry", stylers: [{ color: "#1a2332" }] },
  // Water — distinguishable dark teal-blue
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1f35" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3a6080" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#0e1f35" }] },
  // Land — slightly lighter than water for contrast
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#1e2d3d" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#1a2d3a" }] },
  // Country/admin borders — visible cyan-tinted lines
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#2a4a6a" }, { weight: 1 }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#2e5a7a" }, { weight: 1.2 }] },
  { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#243a50" }, { weight: 0.8 }] },
  // Country/city labels — readable light blue
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#6a9fc0" }] },
  { featureType: "administrative.country", elementType: "labels.text.stroke", stylers: [{ color: "#0e1f35" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#5a8aaa" }] },
  { featureType: "administrative.locality", elementType: "labels.text.stroke", stylers: [{ color: "#1a2332" }] },
  // Roads — subtle, not distracting
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#243040" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a2535" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a3a50" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#3a5570" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#1a2332" }] },
  // POI — minimal, muted
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1e2d3d" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#3a5570" }] },
  { featureType: "poi", elementType: "labels.text.stroke", stylers: [{ color: "#1a2332" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#162a20" }] },
  // Transit
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1e2d3d" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#3a5570" }] },
  // General labels
  { elementType: "labels.text.fill", stylers: [{ color: "#5a8aaa" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a2332" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function MapView() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const baseOverlaysRef = useRef<(google.maps.Polyline | google.maps.Circle | google.maps.Marker)[]>([]);
  const altOverlaysRef = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showDisruptions, setShowDisruptions] = useState(true);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const { altRouteOverlay, baseRouteOverlay } = useRouteMap();

  const { data: disruptions, isLoading: disruptionsLoading, refetch } = trpc.events.active.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: routes, isLoading: routesLoading } = trpc.routes.allRoutes.useQuery();
  const { data: history } = trpc.routes.history.useQuery({ limit: 5 });

  const isLoading = disruptionsLoading || routesLoading;

  const clearBaseOverlays = useCallback(() => {
    baseOverlaysRef.current.forEach((o) => o.setMap(null));
    baseOverlaysRef.current = [];
  }, []);

  const clearAltOverlays = useCallback(() => {
    altOverlaysRef.current.forEach((o) => o.setMap(null));
    altOverlaysRef.current = [];
  }, []);

  const drawBaseOverlays = useCallback(
    (map: google.maps.Map, showR: boolean, showD: boolean) => {
      clearBaseOverlays();

      // Draw base shipping routes (faint background lanes)
      if (showR && routes) {
        routes.forEach((route) => {
          const waypoints = route.waypoints as [number, number][];
          if (waypoints && waypoints.length > 1) {
            const path = waypoints.map(([lng, lat]) => ({ lat, lng }));
            const line = new window.google.maps.Polyline({
              path,
              geodesic: true,
              strokeColor: "#1e4a7a",
              strokeOpacity: 0.4,
              strokeWeight: 1.5,
              map,
            });
            baseOverlaysRef.current.push(line);
          }
        });
      }

      // Draw evaluated routes with risk colors
      if (showR && history) {
        history.forEach((evaluation) => {
          const originCoord = PORT_COORDS[evaluation.originPort.toLowerCase()];
          const destCoord = PORT_COORDS[evaluation.destinationPort.toLowerCase()];
          if (originCoord && destCoord) {
            const color = getRiskColor(evaluation.overallRiskScore);
            const line = new window.google.maps.Polyline({
              path: [originCoord, destCoord],
              geodesic: true,
              strokeColor: color,
              strokeOpacity: 0.85,
              strokeWeight: 3,
              map,
            });
            baseOverlaysRef.current.push(line);
          }
        });
      }

      // Draw disruption markers
      if (showD && disruptions) {
        disruptions.forEach((event) => {
          const locations = event.affectedLocations as string[];
          locations.forEach((location) => {
            const coord = DISRUPTION_COORDS[location];
            if (!coord) return;

            const color = getSeverityColor(event.severity);
            const radius =
              event.severity === "Critical" ? 380000 :
              event.severity === "High" ? 260000 :
              event.severity === "Medium" ? 160000 : 90000;

            const circle = new window.google.maps.Circle({
              center: coord,
              radius,
              strokeColor: color,
              strokeOpacity: 0.7,
              strokeWeight: 1.5,
              fillColor: color,
              fillOpacity: 0.1,
              map,
            });
            baseOverlaysRef.current.push(circle as unknown as google.maps.Polyline);

            const marker = new window.google.maps.Marker({
              position: coord,
              map,
              title: event.title,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: event.severity === "Critical" ? 10 : event.severity === "High" ? 8 : 6,
                fillColor: color,
                fillOpacity: 0.95,
                strokeColor: "#ffffff",
                strokeWeight: 1.5,
              },
            });

            const infoContent = `
              <div style="
                background: #0d1a2a;
                border-radius: 4px;
                padding: 14px 16px;
                max-width: 280px;
                font-family: 'Share Tech Mono', 'Courier New', monospace;
                color: #c8dce8;
                min-width: 220px;
              ">
                <div style="color: ${color}; font-size: 10px; letter-spacing: 2px; margin-bottom: 6px; text-transform: uppercase;">
                  ${getCategoryIcon(event.category)} ${event.category}
                </div>
                <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #e8f4f8; line-height: 1.3;">
                  ${event.title}
                </div>
                <div style="font-size: 11px; color: #7a9ab0; line-height: 1.6; margin-bottom: 10px;">
                  ${event.description.slice(0, 130)}${event.description.length > 130 ? "…" : ""}
                </div>
                <div style="
                  display: inline-block;
                  background: ${color}22;
                  border: 1px solid ${color}55;
                  border-radius: 3px;
                  padding: 2px 8px;
                  font-size: 10px;
                  color: ${color};
                  letter-spacing: 1.5px;
                  text-transform: uppercase;
                ">
                  ● SEVERITY: ${event.severity}
                </div>
              </div>`;

            const infoWindow = new window.google.maps.InfoWindow({ content: infoContent });
            marker.addListener("click", () => {
              infoWindow.open(map, marker);
            });
            baseOverlaysRef.current.push(marker as unknown as google.maps.Polyline);
          });
        });
      }
    },
    [disruptions, routes, history, clearBaseOverlays]
  );

  // Draw alternate route overlay when prop changes
  const drawAltOverlay = useCallback(
    (map: google.maps.Map, alt: AltRouteOverlay | null | undefined, base?: BaseRouteOverlay | null) => {
      clearAltOverlays();
      if (!alt) return;

      // ── Draw the BASE (evaluated) route first as a dimmer reference line ──
      if (base) {
        const baseColor = getRiskColor(base.riskScore);
        const baseOrigin = PORT_COORDS[base.originPort.toLowerCase()];
        const baseDest = PORT_COORDS[base.destinationPort.toLowerCase()];
        let basePath: google.maps.LatLngLiteral[] = [];
        if (base.waypoints && base.waypoints.length > 1) {
          basePath = base.waypoints.map(([lng, lat]) => ({ lat, lng }));
        } else if (baseOrigin && baseDest) {
          basePath = [baseOrigin, baseDest];
        }
        if (basePath.length >= 2) {
          const baseLine = new window.google.maps.Polyline({
            path: basePath,
            geodesic: true,
            strokeColor: baseColor,
            strokeOpacity: 0.45,
            strokeWeight: 3,
            map,
          });
          altOverlaysRef.current.push(baseLine);
          // Label marker at midpoint
          const midIdx = Math.floor(basePath.length / 2);
          const midPt = basePath[midIdx];
          const baseLabel = new window.google.maps.Marker({
            position: midPt,
            map,
            title: `Base Route (${base.riskScore}/100)`,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 0,
              fillOpacity: 0,
              strokeOpacity: 0,
              strokeWeight: 0,
            },
            label: {
              text: `BASE ${base.riskScore}/100`,
              color: baseColor,
              fontSize: "10px",
              fontFamily: "'Share Tech Mono', monospace",
              fontWeight: "700",
            },
            zIndex: 5,
          });
          altOverlaysRef.current.push(baseLabel as unknown as google.maps.Polyline);
        }
      }

      const color = getRiskColor(alt.riskScore);

      // Try to resolve origin/destination coords
      const originCoord = PORT_COORDS[alt.originPort.toLowerCase()];
      const destCoord = PORT_COORDS[alt.destinationPort.toLowerCase()];

      // Build path: use provided waypoints if available, else straight line
      let path: google.maps.LatLngLiteral[] = [];
      if (alt.waypoints && alt.waypoints.length > 1) {
        path = alt.waypoints.map(([lng, lat]) => ({ lat, lng }));
      } else if (originCoord && destCoord) {
        // Generate a curved intermediate path
        const midLat = (originCoord.lat + destCoord.lat) / 2;
        const midLng = (originCoord.lng + destCoord.lng) / 2;
        // Offset slightly to distinguish from base route
        const offset = 8;
        path = [
          originCoord,
          { lat: midLat + offset, lng: midLng },
          destCoord,
        ];
      }

      if (path.length < 2) return;

      // Dashed outline for alternate route
      const outlineLine = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: "#ffffff",
        strokeOpacity: 0.15,
        strokeWeight: 6,
        map,
      });
      altOverlaysRef.current.push(outlineLine);

      // Main colored line
      const mainLine = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 3,
        icons: [
          {
            icon: {
              path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: color,
              strokeWeight: 1,
            },
            offset: "50%",
            repeat: "120px",
          },
        ],
        map,
      });
      altOverlaysRef.current.push(mainLine);

      // Origin marker
      if (originCoord) {
        const originMarker = new window.google.maps.Marker({
          position: originCoord,
          map,
          title: alt.originPort,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 10,
        });
        altOverlaysRef.current.push(originMarker as unknown as google.maps.Polyline);
      }

      // Destination marker
      if (destCoord) {
        const destMarker = new window.google.maps.Marker({
          position: destCoord,
          map,
          title: alt.destinationPort,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 10,
        });
        altOverlaysRef.current.push(destMarker as unknown as google.maps.Polyline);
      }

      // Fit map to the route
      const bounds = new window.google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    },
    [clearAltOverlays]
  );

  const handleMapReady = useCallback(
    (map: google.maps.Map) => {
      if (!map) {
        setMapLoadFailed(true);
        return;
      }
      mapRef.current = map;
      map.setOptions({ styles: DARK_MAP_STYLES });
      injectInfoWindowStyles();
      setMapReady(true);
      drawBaseOverlays(map, showRoutes, showDisruptions);
    },
    [drawBaseOverlays, showRoutes, showDisruptions]
  );

  // Re-draw base overlays when data changes
  useEffect(() => {
    if (mapRef.current && mapReady) {
      drawBaseOverlays(mapRef.current, showRoutes, showDisruptions);
    }
  }, [disruptions, routes, history, showRoutes, showDisruptions, mapReady, drawBaseOverlays]);

  // Draw/clear alt route when prop changes (also pass base route for side-by-side comparison)
  useEffect(() => {
    if (mapRef.current && mapReady) {
      drawAltOverlay(mapRef.current, altRouteOverlay, baseRouteOverlay);
    }
  }, [altRouteOverlay, baseRouteOverlay, mapReady, drawAltOverlay]);

  // Detect map load failure after timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mapRef.current) setMapLoadFailed(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  const handleToggleRoutes = () => {
    const next = !showRoutes;
    setShowRoutes(next);
    if (mapRef.current) drawBaseOverlays(mapRef.current, next, showDisruptions);
  };

  const handleToggleDisruptions = () => {
    const next = !showDisruptions;
    setShowDisruptions(next);
    if (mapRef.current) drawBaseOverlays(mapRef.current, showRoutes, next);
  };

  const handleRefresh = () => {
    refetch();
    if (mapRef.current) drawBaseOverlays(mapRef.current, showRoutes, showDisruptions);
  };

  if (mapLoadFailed) {
    return <MapFallback disruptions={disruptions} showDisruptions={showDisruptions} />;
  }

  return (
    <div className="relative h-full w-full">
      <GoogleMapView
        onMapReady={handleMapReady}
        initialCenter={{ lat: 20, lng: 20 }}
        initialZoom={3}
        className="w-full h-full"
      />

      {/* Loading overlay */}
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.08_0.02_240)] z-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <span className="text-xs font-mono text-primary/70 tracking-widest">LOADING MAP...</span>
          </div>
        </div>
      )}

      {/* Data loading indicator */}
      {isLoading && mapReady && (
        <div className="absolute top-4 left-4 cyber-card px-3 py-2 z-10 flex items-center gap-2">
          <Loader2 className="w-3 h-3 text-primary animate-spin" />
          <span className="text-xs font-mono text-primary">ATHENA SCANNING...</span>
        </div>
      )}

      {/* Alt route comparison legend */}
      {altRouteOverlay && (
        <div
          className="absolute top-4 left-4 cyber-card px-4 py-3 z-10 space-y-2 min-w-[220px]"
          style={{ borderColor: `${getRiskColor(altRouteOverlay.riskScore)}55` }}
        >
          <div className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase mb-1">Route Comparison</div>
          {/* Base route row */}
          {baseRouteOverlay && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-6 h-0.5" style={{ background: getRiskColor(baseRouteOverlay.riskScore), opacity: 0.5 }} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                BASE: {baseRouteOverlay.originPort.split(" ").slice(-1)[0]} → {baseRouteOverlay.destinationPort.split(" ").slice(-1)[0]}
              </span>
              <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: getRiskColor(baseRouteOverlay.riskScore) }}>
                {baseRouteOverlay.riskScore}
              </span>
            </div>
          )}
          {/* Alt route row */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-6 h-0.5" style={{ background: getRiskColor(altRouteOverlay.riskScore) }} />
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: getRiskColor(altRouteOverlay.riskScore), boxShadow: `0 0 4px ${getRiskColor(altRouteOverlay.riskScore)}` }} />
            </div>
            <span className="text-[10px] font-mono text-foreground flex-1 truncate">{altRouteOverlay.name}</span>
            <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: getRiskColor(altRouteOverlay.riskScore) }}>
              {altRouteOverlay.riskScore}
            </span>
          </div>

        </div>
      )}

      {/* Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <div className="cyber-card p-3 space-y-2 min-w-[180px]">
          <div className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase mb-3 flex items-center gap-1.5">
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
          <div className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase mb-3">Risk Legend</div>
          <div className="space-y-1.5">
            {[
              { label: "Low (0–30)", color: "oklch(0.75 0.20 145)" },
              { label: "Moderate (31–60)", color: "oklch(0.80 0.20 75)" },
              { label: "High / Critical (61+)", color: "oklch(0.65 0.25 25)" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                <span className="text-[11px] font-mono text-muted-foreground">{label}</span>
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
              {disruptions.filter((d) => d.severity === "Critical" || d.severity === "High").length}
            </span>
            <span className="text-muted-foreground"> critical/high alerts active</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Fallback UI when Google Maps fails to load ───────────────────────────────

function MapFallback({
  disruptions,
  showDisruptions,
}: {
  disruptions?: { id: number; title: string; severity: string; category: string; affectedLocations: unknown }[];
  showDisruptions: boolean;
}) {
  const WORLD_PORTS = [
    { name: "Shanghai", x: 78, y: 38 }, { name: "Rotterdam", x: 48, y: 22 },
    { name: "Singapore", x: 73, y: 55 }, { name: "Los Angeles", x: 12, y: 38 },
    { name: "Hamburg", x: 49, y: 20 }, { name: "Dubai", x: 60, y: 42 },
    { name: "Busan", x: 80, y: 35 }, { name: "New York", x: 22, y: 35 },
  ];
  const CHOKEPOINTS = [
    { name: "Suez Canal", x: 55, y: 40 }, { name: "Red Sea", x: 56, y: 47 },
    { name: "Strait of Hormuz", x: 62, y: 43 }, { name: "Malacca Strait", x: 72, y: 52 },
    { name: "Panama Canal", x: 20, y: 50 }, { name: "South China Sea", x: 76, y: 47 },
    { name: "Taiwan Strait", x: 79, y: 40 }, { name: "Bab-el-Mandeb Strait", x: 57, y: 50 },
  ];
  const getSevColor = (sev: string) => {
    if (sev === "Critical") return "#e85d04";
    if (sev === "High") return "#f48c06";
    if (sev === "Medium") return "#ffd166";
    return "#06d6a0";
  };
  return (
    <div className="relative h-full w-full bg-[oklch(0.08_0.02_240)] overflow-hidden">
      <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="oklch(0.72 0.22 195)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {[["Shanghai", "Rotterdam"], ["Singapore", "Rotterdam"], ["Shanghai", "Los Angeles"], ["Singapore", "Dubai"]].map(([a, b], i) => {
          const pa = WORLD_PORTS.find((p) => p.name === a);
          const pb = WORLD_PORTS.find((p) => p.name === b);
          if (!pa || !pb) return null;
          return <line key={i} x1={`${pa.x}%`} y1={`${pa.y}%`} x2={`${pb.x}%`} y2={`${pb.y}%`} stroke="oklch(0.72 0.22 195)" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 4" />;
        })}
      </svg>
      {WORLD_PORTS.map((p) => (
        <div key={p.name} className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-50%)" }}>
          <div className="w-3 h-3 rounded-full bg-primary border border-primary/60" style={{ boxShadow: "0 0 8px oklch(0.72 0.22 195)" }} />
          <div className="text-[9px] font-mono text-primary/70 mt-1 whitespace-nowrap text-center">{p.name}</div>
        </div>
      ))}
      {CHOKEPOINTS.map((c) => (
        <div key={c.name} className="absolute" style={{ left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%,-50%)" }}>
          <div className="w-2 h-2 rounded-full bg-[oklch(0.80_0.20_75)]" style={{ boxShadow: "0 0 6px oklch(0.80 0.20 75)" }} />
        </div>
      ))}
      {showDisruptions && disruptions?.map((d, i) => {
        const locs = d.affectedLocations as string[];
        return locs.slice(0, 1).map((loc) => {
          const cp = CHOKEPOINTS.find((c) => c.name === loc);
          if (!cp) return null;
          return (
            <div key={`${i}-${loc}`} className="absolute" style={{ left: `${cp.x}%`, top: `${cp.y}%`, transform: "translate(-50%,-50%)" }}>
              <div className="w-5 h-5 rounded-full animate-ping opacity-40" style={{ background: getSevColor(d.severity) }} />
            </div>
          );
        });
      })}
      <div className="absolute bottom-4 left-4 cyber-card px-3 py-2">
        <span className="text-xs font-mono text-muted-foreground">SCHEMATIC VIEW — Map loading failed</span>
      </div>
    </div>
  );
}
