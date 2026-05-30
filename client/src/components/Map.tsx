/**
 * GOOGLE MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<google.maps.Map | null>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 40.7128, lng: -74.0060 }}
 *   initialZoom={15}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // Store to control map from parent anytime, google map itself is in charge of the re-rendering, not react state.
 * </MapView>
 *
 * ======
 * Available Libraries and Core Features:
 * -------------------------------
 * 📍 MARKER (from `marker` library)
 * - Attaches to map using { map, position }
 * new google.maps.marker.AdvancedMarkerElement({
 *   map,
 *   position: { lat: 37.7749, lng: -122.4194 },
 *   title: "San Francisco",
 * });
 *
 * -------------------------------
 * 🏢 PLACES (from `places` library)
 * - Does not attach directly to map; use data with your map manually.
 * const place = new google.maps.places.Place({ id: PLACE_ID });
 * await place.fetchFields({ fields: ["displayName", "location"] });
 * map.setCenter(place.location);
 * new google.maps.marker.AdvancedMarkerElement({ map, position: place.location });
 *
 * -------------------------------
 * 🧭 GEOCODER (from `geocoding` library)
 * - Standalone service; manually apply results to map.
 * const geocoder = new google.maps.Geocoder();
 * geocoder.geocode({ address: "New York" }, (results, status) => {
 *   if (status === "OK" && results[0]) {
 *     map.setCenter(results[0].geometry.location);
 *     new google.maps.marker.AdvancedMarkerElement({
 *       map,
 *       position: results[0].geometry.location,
 *     });
 *   }
 * });
 *
 * -------------------------------
 * 📐 GEOMETRY (from `geometry` library)
 * - Pure utility functions; not attached to map.
 * const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
 *
 * -------------------------------
 * 🛣️ ROUTES (from `routes` library)
 * - Combines DirectionsService (standalone) + DirectionsRenderer (map-attached)
 * const directionsService = new google.maps.DirectionsService();
 * const directionsRenderer = new google.maps.DirectionsRenderer({ map });
 * directionsService.route(
 *   { origin, destination, travelMode: "DRIVING" },
 *   (res, status) => status === "OK" && directionsRenderer.setDirections(res)
 * );
 *
 * -------------------------------
 * 🌦️ MAP LAYERS (attach directly to map)
 * - new google.maps.TrafficLayer().setMap(map);
 * - new google.maps.TransitLayer().setMap(map);
 * - new google.maps.BicyclingLayer().setMap(map);
 *
 * -------------------------------
 * ✅ SUMMARY
 * - “map-attached” → AdvancedMarkerElement, DirectionsRenderer, Layers.
 * - “standalone” → Geocoder, DirectionsService, DistanceMatrixService, ElevationService.
 * - “data-only” → Place, Geometry utilities.
 */

/// <reference types="@types/google.maps" />

import { useEffect, useRef } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    google?: typeof google;
  }
}

// Load Google Maps via fetch() + Blob URL so the browser sends the correct Origin header.
// <script src> tags do NOT send Origin headers, causing the Forge proxy to reject them.
// fetch() always sends Origin, so the proxy can validate the request domain.
const _forgeBase = import.meta.env.VITE_FRONTEND_FORGE_API_URL ?? "";
const _forgeKey = import.meta.env.VITE_FRONTEND_FORGE_API_KEY ?? "";
const MAPS_FETCH_URL = _forgeBase && _forgeKey
  ? `${_forgeBase}/v1/maps/proxy/maps/api/js?key=${_forgeKey}&v=weekly&libraries=marker,places,geocoding,geometry`
  : null;

let _mapScriptPromise: Promise<boolean> | null = null;

function loadMapScript(): Promise<boolean> {
  if (_mapScriptPromise) return _mapScriptPromise;
  // Already loaded
  if (typeof window !== "undefined" && window.google?.maps?.Map) {
    return Promise.resolve(true);
  }

  _mapScriptPromise = new Promise<boolean>((resolve) => {
    if (!MAPS_FETCH_URL) {
      console.error("Failed to load Google Maps script");
      resolve(false);
      return;
    }

    // Use fetch() so the browser sends the correct Origin header to the Forge proxy.
    // <script src> tags do NOT send Origin, causing 401. fetch() always sends Origin.
    fetch(MAPS_FETCH_URL)
      .then(async (res) => {
        if (!res.ok) {
          console.error(`Failed to load Google Maps script (HTTP ${res.status})`);
          _mapScriptPromise = null;
          resolve(false);
          return;
        }
        const jsText = await res.text();
        // Inject via Blob URL so the JS executes in the page context
        const blob = new Blob([jsText], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        const script = document.createElement("script");
        script.src = blobUrl;
        script.onload = () => {
          URL.revokeObjectURL(blobUrl);
          // Poll until google.maps.Map is available
          let attempts = 0;
          const check = () => {
            if (window.google?.maps?.Map) {
              resolve(true);
            } else if (attempts++ < 30) {
              setTimeout(check, 200);
            } else {
              console.error("Google Maps API did not initialize in time");
              resolve(false);
            }
          };
          check();
        };
        script.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          console.error("Failed to load Google Maps script");
          _mapScriptPromise = null;
          resolve(false);
        };
        document.head.appendChild(script);
      })
      .catch((err) => {
        console.error("Failed to load Google Maps script", err);
        _mapScriptPromise = null;
        resolve(false);
      });
  });
  return _mapScriptPromise;
}

interface MapViewProps {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  onMapReady?: (map: google.maps.Map) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.7749, lng: -122.4194 },
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);

  const init = usePersistFn(async () => {
    const loaded = await loadMapScript();
    if (!loaded || !window.google?.maps?.Map) {
      console.error("Google Maps failed to load");
      return;
    }
    if (!mapContainer.current) {
      console.error("Map container not found");
      return;
    }
    map.current = new window.google.maps.Map(mapContainer.current, {
      zoom: initialZoom,
      center: initialCenter,
      mapTypeControl: false,
      fullscreenControl: true,
      zoomControl: true,
      streetViewControl: false,
    });
    if (onMapReady) {
      onMapReady(map.current);
    }
  });

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div ref={mapContainer} className={cn("w-full h-[500px]", className)} />
  );
}
