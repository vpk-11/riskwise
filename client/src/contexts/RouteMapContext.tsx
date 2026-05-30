// RouteMapContext — alternate route map feature removed.
// Keeping as a no-op stub so existing imports don't break during cleanup.
import { ReactNode } from "react";

export function RouteMapProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useRouteMap() {
  return {
    altRouteOverlay: null as null,
    setAltRouteOverlay: (_: null) => {},
    baseRouteOverlay: null as null,
    setBaseRouteOverlay: (_: null) => {},
  };
}
