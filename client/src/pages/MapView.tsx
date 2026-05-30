import { useState, useCallback, useRef, useEffect } from "react";
import { MapView as GoogleMapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { getRiskColor, getSeverityColor, getCategoryIcon } from "@/lib/riskUtils";
import { AlertTriangle, Layers, Eye, EyeOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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
  "Port of Keelung": { lat: 25.1, lng: 121.7 },
  "San Pedro Bay": { lat: 33.7, lng: -118.2 },
  "Port of Halifax": { lat: 44.6, lng: -63.6 },
  "Port of Southampton": { lat: 50.9, lng: -1.4 },
  "Port of Le Havre": { lat: 49.5, lng: 0.1 },
  "Batam Island": { lat: 1.1, lng: 104.0 },
  "Elbe River": { lat: 53.5, lng: 9.9 },
  "North Sea": { lat: 56.0, lng: 3.0 },
  "Port of Fujairah": { lat: 25.1, lng: 56.3 },
  "Korea Strait": { lat: 34.5, lng: 129.0 },
  "Yellow Sea": { lat: 35.0, lng: 123.0 },
};

const PORT_COORDS: Record<string, { lat: number; lng: number }> = {
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
};

export default function MapView() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<(google.maps.Polyline | google.maps.Circle | google.maps.Marker)[]>([]);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showDisruptions, setShowDisruptions] = useState(true);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);

  const { data: disruptions, isLoading: disruptionsLoading, refetch } = trpc.events.active.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: routes } = trpc.routes.allRoutes.useQuery();
  const { data: history } = trpc.routes.history.useQuery({ limit: 5 });

  const clearOverlays = useCallback(() => {
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];
  }, []);

  const drawOverlays = useCallback(
    (map: google.maps.Map, showR: boolean, showD: boolean) => {
      clearOverlays();

      // Draw base shipping routes (faint)
      if (showR && routes) {
        routes.forEach((route) => {
          const waypoints = route.waypoints as [number, number][];
          if (waypoints && waypoints.length > 1) {
            const path = waypoints.map(([lng, lat]) => ({ lat, lng }));
            const line = new window.google.maps.Polyline({
              path,
              geodesic: true,
              strokeColor: "#1a4a6a",
              strokeOpacity: 0.5,
              strokeWeight: 1.5,
              map,
            });
            overlaysRef.current.push(line);
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
            overlaysRef.current.push(line);
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
            const radius = event.severity === "Critical" ? 400000 : event.severity === "High" ? 280000 : event.severity === "Medium" ? 180000 : 100000;

            const circle = new window.google.maps.Circle({
              center: coord,
              radius,
              strokeColor: color,
              strokeOpacity: 0.6,
              strokeWeight: 1.5,
              fillColor: color,
              fillOpacity: 0.08,
              map,
            });
            overlaysRef.current.push(circle as unknown as google.maps.Polyline);

            const marker = new window.google.maps.Marker({
              position: coord,
              map,
              title: event.title,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: event.severity === "Critical" ? 10 : event.severity === "High" ? 8 : 6,
                fillColor: color,
                fillOpacity: 0.9,
                strokeColor: "#ffffff",
                strokeWeight: 1,
              },
            });

            const infoWindow = new window.google.maps.InfoWindow({
              content: `<div style="background:#0d1117;border:1px solid ${color}60;border-radius:4px;padding:12px;max-width:260px;font-family:'Share Tech Mono',monospace;color:#e8f4f8;"><div style="color:${color};font-size:11px;letter-spacing:2px;margin-bottom:6px;">${getCategoryIcon(event.category)} ${event.category.toUpperCase()}</div><div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#fff;">${event.title}</div><div style="font-size:11px;color:#8899aa;line-height:1.5;">${event.description.slice(0, 120)}...</div><div style="margin-top:8px;font-size:10px;color:${color};letter-spacing:1px;">SEVERITY: ${event.severity.toUpperCase()}</div></div>`,
            });

            marker.addListener("click", () => infoWindow.open(map, marker));
            overlaysRef.current.push(marker as unknown as google.maps.Polyline);
          });
        });
      }
    },
    [disruptions, routes, history, clearOverlays]
  );

  const handleMapReady = useCallback(
    (map: google.maps.Map) => {
      if (!map) {
        setMapLoadFailed(true);
        return;
      }
      mapRef.current = map;
      // Apply dark styles
      map.setOptions({ styles: DARK_MAP_STYLES });
      drawOverlays(map, showRoutes, showDisruptions);
    },
    [drawOverlays, showRoutes, showDisruptions]
  );

  // Detect map load failure after timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mapRef.current) setMapLoadFailed(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const handleToggleRoutes = () => {
    const next = !showRoutes;
    setShowRoutes(next);
    if (mapRef.current) drawOverlays(mapRef.current, next, showDisruptions);
  };

  const handleToggleDisruptions = () => {
    const next = !showDisruptions;
    setShowDisruptions(next);
    if (mapRef.current) drawOverlays(mapRef.current, showRoutes, next);
  };

  const handleRefresh = () => {
    refetch();
    if (mapRef.current) drawOverlays(mapRef.current, showRoutes, showDisruptions);
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

      {disruptionsLoading && (
        <div className="absolute top-4 left-4 cyber-card px-3 py-2 z-10">
          <span className="text-xs font-mono text-primary neon-pulse">ATHENA SCANNING...</span>
        </div>
      )}
    </div>
  );
}

// ── Fallback UI when Google Maps fails to load ───────────────────────────────
function MapFallback({ disruptions, showDisruptions }: { disruptions?: { id: number; title: string; severity: string; category: string; affectedLocations: unknown }[]; showDisruptions: boolean }) {
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
  const getSeverityColor = (sev: string) => {
    if (sev === "Critical") return "#e85d04";
    if (sev === "High") return "#f48c06";
    if (sev === "Medium") return "#ffd166";
    return "#06d6a0";
  };
  return (
    <div className="relative h-full w-full bg-[oklch(0.06_0.01_240)] overflow-hidden">
      {/* Grid lines */}
      <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="oklch(0.72 0.22 195)" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      {/* Shipping lane lines */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {[["Shanghai","Rotterdam"],["Singapore","Rotterdam"],["Shanghai","Los Angeles"],["Singapore","Dubai"]].map(([a,b],i) => {
          const pa = WORLD_PORTS.find(p=>p.name===a);
          const pb = WORLD_PORTS.find(p=>p.name===b);
          if (!pa||!pb) return null;
          return <line key={i} x1={`${pa.x}%`} y1={`${pa.y}%`} x2={`${pb.x}%`} y2={`${pb.y}%`} stroke="oklch(0.72 0.22 195)" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 4"/>;
        })}
      </svg>
      {/* Port markers */}
      {WORLD_PORTS.map((port) => (
        <div key={port.name} className="absolute" style={{ left: `${port.x}%`, top: `${port.y}%`, transform: "translate(-50%,-50%)" }}>
          <div className="w-2 h-2 rounded-full bg-[oklch(0.72_0.22_195)] glow-cyan" />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[oklch(0.72_0.22_195/0.7)] whitespace-nowrap">{port.name}</div>
        </div>
      ))}
      {/* Disruption markers */}
      {showDisruptions && disruptions?.map((event) => {
        const locations = event.affectedLocations as string[];
        const cp = CHOKEPOINTS.find(c => locations.some(l => l.includes(c.name.split(" ")[0])));
        if (!cp) return null;
        const color = getSeverityColor(event.severity);
        return (
          <div key={event.id} className="absolute" style={{ left: `${cp.x}%`, top: `${cp.y}%`, transform: "translate(-50%,-50%)" }}>
            <div className="w-4 h-4 rounded-full neon-pulse" style={{ background: color, boxShadow: `0 0 12px ${color}`, opacity: 0.85 }} title={event.title} />
          </div>
        );
      })}
      {/* Overlay label */}
      <div className="absolute bottom-4 left-4 cyber-card px-4 py-2 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[oklch(0.72_0.22_195)] neon-pulse" />
        <span className="text-xs font-mono text-muted-foreground">SCHEMATIC VIEW — Map loads on published domain</span>
      </div>
    </div>
  );
}

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0d1117" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d1117" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a6fa5" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1628" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#1a3a5c" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#0f1923" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2535" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d1117" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1e3045" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#0f1923" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#2a4060" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0a1f15" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#0f1923" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1a2535" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#1e3a5a" }] },
];
