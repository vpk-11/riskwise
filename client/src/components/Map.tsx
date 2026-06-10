import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { cn } from "@/lib/utils";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export interface MapViewProps {
  className?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  onMapReady?: (map: maplibregl.Map) => void;
}

export function MapView({
  className,
  initialCenter = [20, 20],
  initialZoom = 2,
  onMapReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-left"
    );

    map.on("load", () => {
      mapRef.current = map;
      onMapReady?.(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={cn("w-full h-[500px]", className)} />
  );
}
