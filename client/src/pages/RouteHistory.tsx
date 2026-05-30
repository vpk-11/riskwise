import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  getRiskTextClass,
  getRiskBorderClass,
  getRiskBgClass,
  getRiskLabel,
  getRiskColor,
} from "@/lib/riskUtils";
import { cn } from "@/lib/utils";
import { History, RefreshCw, ChevronDown, ChevronUp, Route, Clock, AlertTriangle, BarChart3 } from "lucide-react";
import { toast } from "sonner";

export default function RouteHistory() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: history, isLoading, refetch } = trpc.routes.history.useQuery({ limit: 20 });
  const rerunMutation = trpc.routes.rerun.useMutation({
    onSuccess: (result) => {
      toast.success(`Re-run complete — Risk Score: ${result.overallRiskScore}/100`);
      refetch();
    },
    onError: (err) => {
      toast.error(`Re-run failed: ${err.message}`);
    },
  });

  const handleRerun = (evaluationId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    rerunMutation.mutate({ evaluationId });
    toast.info("Re-running evaluation...", { duration: 2000 });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-display text-base font-bold text-foreground tracking-wider">ROUTE HISTORY</h2>
            <p className="text-[11px] font-mono text-muted-foreground">
              {history?.length ?? 0} past evaluations
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Summary stats */}
      {history && history.length > 0 && (
        <div className="px-5 py-3 border-b border-border shrink-0 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Total Evaluations</div>
            <div className="text-xl font-display font-bold text-primary">{history.length}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Avg Risk Score</div>
            <div className="text-xl font-display font-bold" style={{ color: getRiskColor(Math.round(history.reduce((a, b) => a + b.overallRiskScore, 0) / history.length)) }}>
              {Math.round(history.reduce((a, b) => a + b.overallRiskScore, 0) / history.length)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Critical Routes</div>
            <div className="text-xl font-display font-bold text-[oklch(0.60_0.28_15)]">
              {history.filter((h) => h.overallRiskScore > 75).length}
            </div>
          </div>
        </div>
      )}

      {/* History list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
        {isLoading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="cyber-card p-4 animate-pulse">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 rounded bg-secondary shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-secondary rounded w-1/2" />
                      <div className="h-2.5 bg-secondary rounded w-1/3" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-6 bg-secondary rounded w-16" />
                    <div className="h-6 bg-secondary rounded w-14" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && (!history || history.length === 0) && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <History className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm font-mono text-muted-foreground">No evaluations yet.</p>
            <p className="text-xs font-mono text-muted-foreground/60">Run a route analysis to see history here.</p>
          </div>
        )}

        {history?.map((evaluation) => {
          const isExpanded = expandedId === evaluation.id;
          const breakdown = evaluation.breakdown as { weather: number; labor: number; geopolitical: number; congestion: number };
          const altRoutes = evaluation.alternativeRoutes as { name: string; transitDays: number; riskScore: number; costImpact: string }[] | null;

          return (
            <div
              key={evaluation.id}
              className={cn(
                "cyber-card border transition-all cursor-pointer",
                getRiskBorderClass(evaluation.overallRiskScore),
                isExpanded && getRiskBgClass(evaluation.overallRiskScore)
              )}
            >
              {/* Row header */}
              <div
                className="flex items-center gap-3 p-4"
                onClick={() => setExpandedId(isExpanded ? null : evaluation.id)}
              >
                {/* Risk score badge */}
                <div
                  className="w-12 h-12 rounded-sm flex items-center justify-center shrink-0 border"
                  style={{
                    borderColor: `${getRiskColor(evaluation.overallRiskScore)}40`,
                    background: `${getRiskColor(evaluation.overallRiskScore)}10`,
                  }}
                >
                  <span
                    className={cn("text-lg font-display font-black", getRiskTextClass(evaluation.overallRiskScore))}
                  >
                    {evaluation.overallRiskScore}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Route className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground truncate">
                      {evaluation.originPort} → {evaluation.destinationPort}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {evaluation.baseTransitDays}d transit
                    </span>
                    <span className={cn("font-bold", getRiskTextClass(evaluation.overallRiskScore))}>
                      {getRiskLabel(evaluation.overallRiskScore)}
                    </span>
                    {altRoutes && altRoutes.length > 0 && (
                      <span className="text-[oklch(0.75_0.20_145)]">
                        {altRoutes.length} alt. route{altRoutes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right text-[10px] font-mono text-muted-foreground/60 hidden sm:block">
                    <div>{new Date(evaluation.evaluatedAt).toLocaleDateString()}</div>
                    <div>{new Date(evaluation.evaluatedAt).toLocaleTimeString()}</div>
                  </div>
                  <button
                    onClick={(e) => handleRerun(evaluation.id, e)}
                    disabled={rerunMutation.isPending}
                    className="p-1.5 rounded-sm border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
                    title="Re-run evaluation"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", rerunMutation.isPending && "neon-pulse")} />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                  {/* Primary risk factor */}
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", getRiskTextClass(evaluation.overallRiskScore))} />
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-0.5">Primary Risk Factor</div>
                      <p className="text-sm text-foreground/90">{evaluation.primaryRiskFactor}</p>
                    </div>
                  </div>

                  {/* Risk breakdown */}
                  {breakdown && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Risk Breakdown</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(breakdown).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <div className="text-[10px] font-mono text-muted-foreground capitalize w-20 shrink-0">{key}</div>
                            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${value}%`,
                                  background: getRiskColor(value),
                                  boxShadow: `0 0 4px ${getRiskColor(value)}`,
                                }}
                              />
                            </div>
                            <span className={cn("text-[10px] font-mono font-bold w-6 text-right", getRiskTextClass(value))}>
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Alternative routes */}
                  {altRoutes && altRoutes.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Alternative Routes</div>
                      <div className="space-y-1.5">
                        {altRoutes.map((alt, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs font-mono p-2 bg-secondary/30 rounded-sm">
                            <span className="text-foreground/80 flex-1">{alt.name}</span>
                            <span className={cn("font-bold", getRiskTextClass(alt.riskScore))}>{alt.riskScore}/100</span>
                            <span className="text-muted-foreground">{alt.transitDays}d</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Query text */}
                  {evaluation.queryText && (
                    <div className="text-[10px] font-mono text-muted-foreground/60 italic">
                      Query: "{evaluation.queryText}"
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
