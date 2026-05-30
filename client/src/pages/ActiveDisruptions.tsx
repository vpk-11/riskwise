import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { getSeverityTextClass, getSeverityColor, getCategoryIcon, getCategoryColor } from "@/lib/riskUtils";
import { cn } from "@/lib/utils";
import { AlertTriangle, Filter, RefreshCw, MapPin, ExternalLink } from "lucide-react";

type Category = "Weather" | "Strike" | "Geopolitical" | "Port Congestion";
type Severity = "Low" | "Medium" | "High" | "Critical";

const CATEGORIES: Category[] = ["Weather", "Strike", "Geopolitical", "Port Congestion"];
const SEVERITIES: Severity[] = ["Low", "Medium", "High", "Critical"];

export default function ActiveDisruptions() {
  const [filterCategory, setFilterCategory] = useState<Category | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<Severity | null>(null);

  const { data: disruptions, isLoading, refetch, dataUpdatedAt } = trpc.events.active.useQuery(
    {
      category: filterCategory ?? undefined,
      severity: filterSeverity ?? undefined,
    },
    { refetchInterval: 60000 }
  );

  const criticalCount = disruptions?.filter((d) => d.severity === "Critical").length ?? 0;
  const highCount = disruptions?.filter((d) => d.severity === "High").length ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[oklch(0.65_0.25_25)]" />
            <div>
              <h2 className="font-display text-base font-bold text-foreground tracking-wider">ACTIVE DISRUPTIONS</h2>
              <p className="text-[11px] font-mono text-muted-foreground">
                {disruptions?.length ?? 0} events tracked
                {dataUpdatedAt ? ` · Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {criticalCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[oklch(0.60_0.28_15/0.4)] bg-[oklch(0.60_0.28_15/0.08)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.60_0.28_15)] neon-pulse" />
                <span className="text-xs font-mono text-[oklch(0.60_0.28_15)] font-bold">{criticalCount} CRITICAL</span>
              </div>
            )}
            {highCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[oklch(0.65_0.25_25/0.4)] bg-[oklch(0.65_0.25_25/0.08)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.65_0.25_25)]" />
                <span className="text-xs font-mono text-[oklch(0.65_0.25_25)] font-bold">{highCount} HIGH</span>
              </div>
            )}
            <button
              onClick={() => refetch()}
              className="p-2 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Category:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterCategory(null)}
              className={cn(
                "px-2.5 py-1 text-[10px] font-mono rounded-sm border transition-all",
                filterCategory === null
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-border/80"
              )}
            >
              ALL
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-mono rounded-sm border transition-all flex items-center gap-1",
                  filterCategory === cat
                    ? "border-opacity-60 text-foreground"
                    : "border-border text-muted-foreground hover:border-border/80"
                )}
                style={
                  filterCategory === cat
                    ? {
                        borderColor: `${getCategoryColor(cat)}60`,
                        background: `${getCategoryColor(cat)}15`,
                        color: getCategoryColor(cat),
                      }
                    : {}
                }
              >
                {getCategoryIcon(cat)} {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Severity:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterSeverity(null)}
              className={cn(
                "px-2.5 py-1 text-[10px] font-mono rounded-sm border transition-all",
                filterSeverity === null
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-border/80"
              )}
            >
              ALL
            </button>
            {SEVERITIES.map((sev) => (
              <button
                key={sev}
                onClick={() => setFilterSeverity(filterSeverity === sev ? null : sev)}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-mono rounded-sm border transition-all",
                  filterSeverity === sev
                    ? "text-foreground"
                    : "border-border text-muted-foreground hover:border-border/80"
                )}
                style={
                  filterSeverity === sev
                    ? {
                        borderColor: `${getSeverityColor(sev)}60`,
                        background: `${getSeverityColor(sev)}15`,
                        color: getSeverityColor(sev),
                      }
                    : {}
                }
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="cyber-card p-4 animate-pulse">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2 flex-1">
                    <div className="w-5 h-5 rounded bg-secondary shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-secondary rounded w-3/4" />
                      <div className="flex gap-2">
                        <div className="h-3 bg-secondary rounded w-16" />
                        <div className="h-3 bg-secondary rounded w-12" />
                      </div>
                    </div>
                  </div>
                  <div className="h-3 bg-secondary rounded w-16 shrink-0" />
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="h-2.5 bg-secondary rounded w-full" />
                  <div className="h-2.5 bg-secondary rounded w-5/6" />
                </div>
                <div className="flex gap-1">
                  <div className="h-4 bg-secondary rounded w-20" />
                  <div className="h-4 bg-secondary rounded w-24" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && (!disruptions || disruptions.length === 0) && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <AlertTriangle className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm font-mono text-muted-foreground">No active disruptions matching filters.</p>
          </div>
        )}

        {disruptions?.map((event) => {
          const locations = event.affectedLocations as string[];
          const severityColor = getSeverityColor(event.severity);
          const categoryColor = getCategoryColor(event.category);

          return (
            <div
              key={event.id}
              className="cyber-card p-4 transition-all hover:border-border/80"
              style={{
                borderLeftWidth: "3px",
                borderLeftColor: severityColor,
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="text-base shrink-0 mt-0.5">{getCategoryIcon(event.category)}</span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground leading-tight">{event.title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                        style={{ color: categoryColor, background: `${categoryColor}20`, border: `1px solid ${categoryColor}30` }}
                      >
                        {event.category.toUpperCase()}
                      </span>
                      <span
                        className={cn("text-[10px] font-mono font-bold", getSeverityTextClass(event.severity))}
                      >
                        ● {event.severity.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground/60 shrink-0 text-right">
                  {new Date(event.createdAt).toLocaleDateString()}
                  <br />
                  {new Date(event.createdAt).toLocaleTimeString()}
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{event.description}</p>

              <div className="flex items-start gap-1.5">
                <MapPin className="w-3 h-3 text-muted-foreground/60 mt-0.5 shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {locations.map((loc) => (
                    <span
                      key={loc}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground"
                    >
                      {loc}
                    </span>
                  ))}
                </div>
              </div>

              {event.sourceUrl && (
                <div className="mt-2 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3 text-muted-foreground/40" />
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-muted-foreground/40 hover:text-primary transition-colors"
                  >
                    Source
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
