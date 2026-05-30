import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import RiskWiseLayout from "./components/RiskWiseLayout";
import { RouteMapProvider } from "./contexts/RouteMapContext";
import MapView from "./pages/MapView";
import RouteAnalyzer from "./pages/RouteAnalyzer";
import ActiveDisruptions from "./pages/ActiveDisruptions";
import RouteHistory from "./pages/RouteHistory";

function Router() {
  return (
    <RiskWiseLayout>
      <Switch>
        <Route path="/" component={MapView} />
        <Route path="/map" component={MapView} />
        <Route path="/analyze" component={RouteAnalyzer} />
        <Route path="/disruptions" component={ActiveDisruptions} />
        <Route path="/history" component={RouteHistory} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </RiskWiseLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <RouteMapProvider>
          <TooltipProvider>
            <Toaster
              theme="dark"
              toastOptions={{
                style: {
                  background: "oklch(0.11 0.015 240)",
                  border: "1px solid oklch(0.72 0.22 195 / 0.3)",
                  color: "oklch(0.92 0.02 200)",
                  fontFamily: "var(--font-mono)",
                },
              }}
            />
            <Router />
          </TooltipProvider>
        </RouteMapProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
