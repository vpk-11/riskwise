import { createContext, useContext, useState, ReactNode } from "react";

export interface AltRouteOverlay {
  name: string;
  riskScore: number;
  waypoints: [number, number][];
  originPort: string;
  destinationPort: string;
}

export interface BaseRouteOverlay {
  originPort: string;
  destinationPort: string;
  riskScore: number;
  waypoints?: [number, number][];
}

interface RouteMapContextValue {
  altRouteOverlay: AltRouteOverlay | null;
  setAltRouteOverlay: (overlay: AltRouteOverlay | null) => void;
  baseRouteOverlay: BaseRouteOverlay | null;
  setBaseRouteOverlay: (overlay: BaseRouteOverlay | null) => void;
}

const RouteMapContext = createContext<RouteMapContextValue>({
  altRouteOverlay: null,
  setAltRouteOverlay: () => {},
  baseRouteOverlay: null,
  setBaseRouteOverlay: () => {},
});

export function RouteMapProvider({ children }: { children: ReactNode }) {
  const [altRouteOverlay, setAltRouteOverlay] = useState<AltRouteOverlay | null>(null);
  const [baseRouteOverlay, setBaseRouteOverlay] = useState<BaseRouteOverlay | null>(null);

  return (
    <RouteMapContext.Provider value={{ altRouteOverlay, setAltRouteOverlay, baseRouteOverlay, setBaseRouteOverlay }}>
      {children}
    </RouteMapContext.Provider>
  );
}

export function useRouteMap() {
  return useContext(RouteMapContext);
}
