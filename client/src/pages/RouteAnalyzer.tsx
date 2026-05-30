import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  getRiskTextClass,
  getRiskBorderClass,
  getRiskBgClass,
  getRiskLabel,
  getRiskColor,
} from "@/lib/riskUtils";
import { cn } from "@/lib/utils";
import { Send, Terminal, Cpu, Route, BarChart3, Clock, DollarSign, AlertTriangle, Globe, Database, Zap } from "lucide-react";
import { toast } from "sonner";

interface AgentMessage {
  agent: "ATHENA" | "HERMES" | "APOLLO" | "SYSTEM";
  message: string;
  status: "working" | "done" | "error";
}

type EvaluationResult = {
  overallRiskScore: number;
  primaryRiskFactor: string;
  breakdown: { weather: number; labor: number; geopolitical: number; congestion: number };
  baseTransitDays: number;
  riskNarrative: string;
  intelligenceSummary?: string;
  dataSources?: { name: string; count: number; ok: boolean }[];
  alternativeRoutes: {
    name: string;
    transitDays: number;
    riskScore: number;
    waypoints: [number, number][];
    costImpact: string;
    description: string;
  }[];
  recommendation: string;
};

const AGENT_COLORS = {
  ATHENA: "oklch(0.72 0.22 195)",
  HERMES: "oklch(0.80 0.20 75)",
  APOLLO: "oklch(0.75 0.20 145)",
  SYSTEM: "oklch(0.55 0.04 220)",
};

const AGENT_ICONS = {
  ATHENA: "◈",
  HERMES: "◉",
  APOLLO: "◎",
  SYSTEM: "▸",
};

const EXAMPLE_QUERIES = [
  "Analyze the risk of shipping electronics from Port of Shanghai to Port of Rotterdam",
  "Evaluate route from Port of Shenzhen to Port of Long Beach for semiconductor cargo",
  "What is the risk level for shipping from Port of Singapore to Port of Rotterdam?",
  "Assess the safety of the Hamburg to New York shipping corridor",
];

export default function RouteAnalyzer() {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [agentLog, setAgentLog] = useState<AgentMessage[]>([]);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const [evalledOrigin, setEvalledOrigin] = useState("");
  const [evalledDestination, setEvalledDestination] = useState("");

  const evaluateMutation = trpc.routes.evaluate.useMutation();

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [agentLog]);

  const addLog = (agent: AgentMessage["agent"], message: string, status: AgentMessage["status"] = "working") => {
    setAgentLog((prev) => [...prev, { agent, message, status }]);
  };

  const parseQueryForPorts = (q: string): { origin: string; destination: string } | null => {
    const fromMatch = q.match(/from\s+([^to]+?)\s+to\s+(.+?)(?:\s+for|\s+next|\s*$)/i);
    if (fromMatch) {
      return {
        origin: fromMatch[1].trim(),
        destination: fromMatch[2].trim(),
      };
    }
    return null;
  };

  const handleRun = async () => {
    let evalOrigin = origin.trim();
    let evalDestination = destination.trim();

    if (!evalOrigin || !evalDestination) {
      if (query.trim()) {
        const parsed = parseQueryForPorts(query);
        if (parsed) {
          evalOrigin = parsed.origin;
          evalDestination = parsed.destination;
        } else {
          toast.error("Could not parse origin/destination from query. Please fill in the port fields.");
          return;
        }
      } else {
        toast.error("Please enter origin and destination ports.");
        return;
      }
    }

    setIsRunning(true);
    setResult(null);
    setAgentLog([]);
    setEvalledOrigin(evalOrigin);
    setEvalledDestination(evalDestination);

    addLog("SYSTEM", `Initializing RiskWise multi-agent evaluation...`, "done");
    addLog("SYSTEM", `Route: ${evalOrigin} → ${evalDestination}`, "done");

    await new Promise((r) => setTimeout(r, 400));
    addLog("ATHENA", "Scanning global trade disruption database...", "working");
    await new Promise((r) => setTimeout(r, 600));
    addLog("ATHENA", "Cross-referencing RSS feeds and port authority bulletins...", "working");
    await new Promise((r) => setTimeout(r, 500));
    addLog("ATHENA", "Extracting geopolitical risk vectors for route corridor...", "working");

    // Start actual API call
    const evaluationPromise = evaluateMutation.mutateAsync({
      origin: evalOrigin,
      destination: evalDestination,
      queryText: query || `${evalOrigin} to ${evalDestination}`,
    });

    await new Promise((r) => setTimeout(r, 800));
    addLog("ATHENA", "Intelligence gathered. Passing data to Hermes...", "done");
    await new Promise((r) => setTimeout(r, 300));
    addLog("HERMES", "Received Athena intelligence package.", "working");
    await new Promise((r) => setTimeout(r, 500));
    addLog("HERMES", `Calculating risk vectors for ${evalOrigin} → ${evalDestination}...`, "working");
    await new Promise((r) => setTimeout(r, 600));
    addLog("HERMES", "Applying weighted risk model: weather, labor, geopolitical, congestion...", "working");

    try {
      const evalResult = await evaluationPromise;
      const score = evalResult.overallRiskScore;

      addLog("HERMES", `Risk Score computed: ${score}/100 — ${getRiskLabel(score)}`, "done");
      await new Promise((r) => setTimeout(r, 300));

      if (score > 50) {
        addLog("APOLLO", "High risk detected. Initiating route optimization protocol...", "working");
        await new Promise((r) => setTimeout(r, 400));
        addLog("APOLLO", "Calculating alternative maritime corridors...", "working");
        await new Promise((r) => setTimeout(r, 400));
        addLog("APOLLO", `Generated ${evalResult.alternativeRoutes.length} alternative route(s).`, "done");
      } else {
        addLog("APOLLO", "Risk within acceptable parameters. No rerouting required.", "done");
      }

      await new Promise((r) => setTimeout(r, 200));
      addLog("SYSTEM", "Evaluation complete. Results ready.", "done");

      setResult(evalResult as EvaluationResult);

      if (score > 75) {
        toast.error(`🚨 CRITICAL RISK: Score ${score}/100 — Owner notified`, {
          duration: 6000,
        });
      } else if (score > 50) {
        toast.warning(`⚠ HIGH RISK: Score ${score}/100 — Review alternatives`, {
          duration: 4000,
        });
      } else {
        toast.success(`✓ Evaluation complete — Risk Score: ${score}/100`, {
          duration: 3000,
        });
      }
    } catch (err) {
      addLog("SYSTEM", `Error: ${(err as Error).message}`, "error");
      toast.error("Evaluation failed. Please try again.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleExampleQuery = (q: string) => {
    setQuery(q);
    const parsed = parseQueryForPorts(q);
    if (parsed) {
      setOrigin(parsed.origin);
      setDestination(parsed.destination);
    }
    inputRef.current?.focus();
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-0 overflow-hidden">
      {/* Left panel: Terminal + Input */}
      <div className="flex flex-col w-full lg:w-[480px] lg:min-w-[480px] border-r border-border overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2 shrink-0">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="font-display text-sm font-bold text-primary tracking-wider">QUERY TERMINAL</span>
          <div className="ml-auto flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[oklch(0.65_0.25_25)] neon-pulse" />
            <div className="w-2 h-2 rounded-full bg-[oklch(0.80_0.20_75)]" />
            <div className="w-2 h-2 rounded-full bg-[oklch(0.75_0.20_145)]" />
          </div>
        </div>

        {/* Agent log terminal */}
        <div
          ref={terminalRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1.5 bg-[oklch(0.06_0.01_240)] min-h-0"
        >
          {agentLog.length === 0 && (
            <div className="space-y-2 text-muted-foreground/60">
              <div className="text-primary/60">▸ RiskWise Multi-Agent System v2.4.1</div>
              <div>▸ Agents online: ATHENA · HERMES · APOLLO</div>
              <div>▸ Enter a query or fill in the port fields below</div>
              <div className="mt-4 text-[10px] text-muted-foreground/40">
                ─────────────────────────────────────
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground/50">Example queries:</div>
              {EXAMPLE_QUERIES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleExampleQuery(q)}
                  className="block text-left text-[10px] text-primary/50 hover:text-primary transition-colors cursor-pointer"
                >
                  ▸ {q}
                </button>
              ))}
            </div>
          )}
          {agentLog.map((log, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span
                className="shrink-0 font-bold"
                style={{ color: AGENT_COLORS[log.agent] }}
              >
                [{log.agent}]
              </span>
              <span
                className={cn(
                  "flex-1",
                  log.status === "error" ? "text-[oklch(0.65_0.25_25)]" : "text-foreground/80"
                )}
              >
                {AGENT_ICONS[log.agent]} {log.message}
                {log.status === "working" && (
                  <span className="cursor-blink ml-1">_</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border p-4 space-y-3 bg-card/50">
          {/* Natural language query */}
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-mono text-xs">›</div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isRunning && handleRun()}
              placeholder="Natural language query (optional)..."
              className="w-full bg-[oklch(0.06_0.01_240)] border border-border rounded-sm pl-7 pr-4 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Port fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase block mb-1">Origin Port</label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Port of Shanghai"
                className="w-full bg-[oklch(0.06_0.01_240)] border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground tracking-wider uppercase block mb-1">Destination Port</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Port of Rotterdam"
                className="w-full bg-[oklch(0.06_0.01_240)] border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={isRunning}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-mono text-sm font-bold tracking-wider transition-all duration-200",
              isRunning
                ? "bg-primary/20 text-primary/60 border border-primary/20 cursor-not-allowed"
                : "bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20 hover:border-primary/60 active:scale-[0.98] glow-cyan"
            )}
          >
            {isRunning ? (
              <>
                <Cpu className="w-4 h-4 neon-pulse" />
                AGENTS WORKING...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                RUN EVALUATION
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right panel: Results */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
        {!result && !isRunning && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <Route className="w-12 h-12 text-primary/20 mx-auto" />
              <p className="text-muted-foreground font-mono text-sm">No evaluation results yet.</p>
              <p className="text-muted-foreground/60 font-mono text-xs">Enter a route query to begin analysis.</p>
            </div>
          </div>
        )}

        {result && (
          <>
            {/* Risk Score Card */}
            <div className={cn("cyber-card p-5 border", getRiskBorderClass(result.overallRiskScore), getRiskBgClass(result.overallRiskScore))}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase mb-1">Overall Risk Score</div>
                  <div className={cn("text-6xl font-display font-black", getRiskTextClass(result.overallRiskScore))}>
                    {result.overallRiskScore}
                    <span className="text-2xl text-muted-foreground">/100</span>
                  </div>
                  <div className={cn("text-sm font-mono font-bold mt-1", getRiskTextClass(result.overallRiskScore))}>
                    {getRiskLabel(result.overallRiskScore)}
                  </div>
                </div>

                {/* Risk ring */}
                <div className="relative w-24 h-24 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="oklch(0.20 0.03 240)" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke={getRiskColor(result.overallRiskScore)}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray="251.2"
                      strokeDashoffset={251.2 - (251.2 * result.overallRiskScore) / 100}
                      style={{ filter: `drop-shadow(0 0 6px ${getRiskColor(result.overallRiskScore)})`, transition: "stroke-dashoffset 1s ease" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn("text-lg font-display font-bold", getRiskTextClass(result.overallRiskScore))}>
                      {result.overallRiskScore}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Primary Risk Factor</div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", getRiskTextClass(result.overallRiskScore))} />
                  <p className="text-sm text-foreground/90">{result.primaryRiskFactor}</p>
                </div>
              </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="cyber-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Base Transit</span>
                </div>
                <div className="text-3xl font-display font-bold text-primary">
                  {result.baseTransitDays}
                  <span className="text-sm text-muted-foreground ml-1">days</span>
                </div>
                {result.alternativeRoutes.length > 0 && (
                  <div className="text-xs font-mono text-[oklch(0.80_0.20_75)] mt-1">
                    +{result.alternativeRoutes[0].transitDays - result.baseTransitDays} days via alt. route
                  </div>
                )}
              </div>

              <div className="cyber-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-[oklch(0.80_0.20_75)]" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Cost Impact</span>
                </div>
                {result.alternativeRoutes.length > 0 ? (
                  <>
                    <div className="text-sm font-mono text-[oklch(0.80_0.20_75)] font-bold">
                      {result.alternativeRoutes[0].costImpact}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">for lowest-risk alt.</div>
                  </>
                ) : (
                  <div className="text-sm font-mono text-[oklch(0.75_0.20_145)]">No additional cost</div>
                )}
              </div>
            </div>

            {/* Risk Breakdown */}
            <div className="cyber-card p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Risk Breakdown</span>
              </div>
              <div className="space-y-3">
                {Object.entries(result.breakdown).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground capitalize">{key}</span>
                      <span className={cn("text-xs font-mono font-bold", getRiskTextClass(value))}>{value}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${value}%`,
                          background: getRiskColor(value),
                          boxShadow: `0 0 6px ${getRiskColor(value)}`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Narrative */}
            <div className="cyber-card p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Cpu className="w-3.5 h-3.5 text-[oklch(0.72_0.22_195)]" />
                <span className="text-[10px] font-mono text-[oklch(0.72_0.22_195)] uppercase tracking-wider">Hermes Risk Analysis</span>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed font-mono whitespace-pre-wrap">{result.riskNarrative}</p>
            </div>

            {/* Intelligence Summary */}
            {result.intelligenceSummary && (
              <div className="cyber-card p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Globe className="w-3.5 h-3.5 text-[oklch(0.80_0.20_75)]" />
                  <span className="text-[10px] font-mono text-[oklch(0.80_0.20_75)] uppercase tracking-wider">Athena Intelligence Summary</span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed font-mono whitespace-pre-wrap">{result.intelligenceSummary}</p>
              </div>
            )}

            {/* Data Sources */}
            {result.dataSources && result.dataSources.length > 0 && (
              <div className="cyber-card p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Live Data Sources</span>
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/50">REAL-TIME INTELLIGENCE</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mb-3">
                  {result.dataSources.map((src, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", src.ok ? "bg-[oklch(0.75_0.20_145)]" : "bg-[oklch(0.60_0.25_25)]")} />
                      <span className="text-foreground/70 flex-1 truncate">{src.name}</span>
                      <span className="text-muted-foreground/60">{src.count} event{src.count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-start gap-1.5 pt-2 border-t border-border/40">
                  <Zap className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
                  <span className="text-[9px] font-mono text-muted-foreground/40 leading-relaxed">
                    Risk scores are LLM-synthesized from live RSS feeds, NASA EONET weather events, and USGS seismic data. Accuracy is heuristic — validate critical routing decisions with official maritime advisories.
                  </span>
                </div>
              </div>
            )}

            {/* Alternative Routes */}
            {result.alternativeRoutes.length > 0 && (
              <div className="cyber-card p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Route className="w-4 h-4 text-[oklch(0.75_0.20_145)]" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    Apollo Alternative Routes ({result.alternativeRoutes.length})
                  </span>
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/50 tracking-wider">
                    APOLLO ALTERNATIVES
                  </span>
                </div>
                <div className="space-y-3">
                  {result.alternativeRoutes.map((alt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        toast.info(`Route: ${alt.name} — Risk ${alt.riskScore}/100`, { duration: 3000 });
                      }}
                      className={cn(
                        "w-full text-left p-3 rounded-sm border transition-all duration-200 group",
                        getRiskBorderClass(alt.riskScore),
                        "bg-secondary/30 hover:bg-secondary/60 active:scale-[0.99]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="font-mono text-sm font-bold text-foreground">{alt.name}</div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className={cn("text-sm font-display font-bold", getRiskTextClass(alt.riskScore))}>
                            {alt.riskScore}/100
                          </div>
                          <div
                            className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{
                              color: getRiskColor(alt.riskScore),
                              background: `${getRiskColor(alt.riskScore)}18`,
                              border: `1px solid ${getRiskColor(alt.riskScore)}40`,
                            }}
                          >
                            VIEW DETAILS
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mb-2">{alt.description}</p>
                      <div className="flex gap-4 text-xs font-mono">
                        <span className="text-muted-foreground">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {alt.transitDays} days
                        </span>
                        <span className="text-[oklch(0.80_0.20_75)]">
                          <DollarSign className="w-3 h-3 inline mr-1" />
                          {alt.costImpact}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Apollo Recommendation</div>
                  <p className="text-xs font-mono text-[oklch(0.75_0.20_145)]">{result.recommendation}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
