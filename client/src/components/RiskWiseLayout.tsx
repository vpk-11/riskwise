import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Map,
  Route,
  AlertTriangle,
  History,
  Shield,
  Menu,
  X,
  Activity,
  Zap,
} from "lucide-react";

const NAV_ITEMS = [
  { path: "/map", label: "Map View", icon: Map, description: "Global route visualization" },
  { path: "/analyze", label: "Route Analyzer", icon: Route, description: "AI risk evaluation" },
  { path: "/disruptions", label: "Active Disruptions", icon: AlertTriangle, description: "Live threat feed" },
  { path: "/history", label: "Route History", icon: History, description: "Past evaluations" },
];

interface RiskWiseLayoutProps {
  children: React.ReactNode;
}

export default function RiskWiseLayout({ children }: RiskWiseLayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activePath = location === "/" ? "/map" : location;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-50 lg:z-auto h-full flex flex-col transition-transform duration-300 ease-out",
          "w-64 bg-sidebar border-r border-sidebar-border",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{
          background: "linear-gradient(180deg, oklch(0.09 0.015 240) 0%, oklch(0.07 0.01 240) 100%)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="relative">
            <Shield className="w-8 h-8 text-primary glow-cyan" />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full neon-pulse" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-primary text-glow-cyan tracking-wider">
              RISKWISE
            </h1>
            <p className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">
              Supply Chain Intel
            </p>
          </div>
          <button
            className="ml-auto lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status indicator */}
        <div className="mx-4 my-3 px-3 py-2 rounded-sm border border-neon-green bg-[oklch(0.82_0.22_145/0.05)] flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[oklch(0.82_0.22_145)] neon-pulse" />
          <span className="text-[11px] font-mono text-[oklch(0.82_0.22_145)]">SYSTEM ONLINE</span>
          <Zap className="w-3 h-3 text-[oklch(0.82_0.22_145)] ml-auto" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = activePath === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-sm cursor-pointer transition-all duration-200 group",
                    "border border-transparent",
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary glow-cyan"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary hover:border-border"
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon
                    className={cn(
                      "w-4.5 h-4.5 shrink-0 transition-all duration-200",
                      isActive ? "text-primary" : "group-hover:text-foreground"
                    )}
                  />
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-sm font-semibold tracking-wide",
                        isActive ? "font-display text-primary" : "font-sans"
                      )}
                    >
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {item.description}
                    </div>
                  </div>
                  {isActive && (
                    <div className="ml-auto w-1 h-6 bg-primary rounded-full glow-cyan" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="text-[10px] font-mono text-muted-foreground/60 text-center">
            <div>RISKWISE v2.4.1</div>
            <div className="mt-0.5">AGENTS: ATHENA · HERMES · APOLLO</div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <button
            className="lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary neon-pulse" />
            <span className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
              {NAV_ITEMS.find((n) => n.path === activePath)?.label ?? "Dashboard"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
              <span className="text-[oklch(0.82_0.22_145)]">●</span>
              <span>3 AGENTS ACTIVE</span>
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">
              {new Date().toUTCString().slice(0, 25)} UTC
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
