/**
 * RiskWise shared utilities for risk score display
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export function getRiskLevel(score: number): RiskLevel {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

export function getRiskColor(score: number): string {
  if (score <= 30) return "oklch(0.75 0.20 145)"; // green
  if (score <= 60) return "oklch(0.80 0.20 75)";  // amber
  return "oklch(0.65 0.25 25)";                    // red
}

export function getRiskTextClass(score: number): string {
  if (score <= 30) return "text-[oklch(0.75_0.20_145)] text-glow-green";
  if (score <= 60) return "text-[oklch(0.80_0.20_75)] text-glow-amber";
  return "text-[oklch(0.65_0.25_25)] text-glow-red";
}

export function getRiskBorderClass(score: number): string {
  if (score <= 30) return "border-[oklch(0.75_0.20_145/0.4)]";
  if (score <= 60) return "border-[oklch(0.80_0.20_75/0.4)]";
  return "border-[oklch(0.65_0.25_25/0.5)]";
}

export function getRiskBgClass(score: number): string {
  if (score <= 30) return "bg-[oklch(0.75_0.20_145/0.08)]";
  if (score <= 60) return "bg-[oklch(0.80_0.20_75/0.08)]";
  return "bg-[oklch(0.65_0.25_25/0.10)]";
}

export function getRiskLabel(score: number): string {
  if (score <= 30) return "LOW RISK";
  if (score <= 60) return "MODERATE RISK";
  if (score <= 75) return "HIGH RISK";
  return "CRITICAL RISK";
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case "Low": return "oklch(0.75 0.20 145)";
    case "Medium": return "oklch(0.80 0.20 75)";
    case "High": return "oklch(0.65 0.25 25)";
    case "Critical": return "oklch(0.60 0.28 15)";
    default: return "oklch(0.55 0.04 220)";
  }
}

export function getSeverityTextClass(severity: string): string {
  switch (severity) {
    case "Low": return "text-[oklch(0.75_0.20_145)]";
    case "Medium": return "text-[oklch(0.80_0.20_75)]";
    case "High": return "text-[oklch(0.65_0.25_25)]";
    case "Critical": return "text-[oklch(0.60_0.28_15)] neon-pulse";
    default: return "text-muted-foreground";
  }
}

export function getCategoryIcon(category: string): string {
  switch (category) {
    case "Weather": return "🌪";
    case "Strike": return "✊";
    case "Geopolitical": return "⚡";
    case "Port Congestion": return "🚢";
    default: return "⚠";
  }
}

export function getCategoryColor(category: string): string {
  switch (category) {
    case "Weather": return "oklch(0.72 0.22 195)";
    case "Strike": return "oklch(0.80 0.20 75)";
    case "Geopolitical": return "oklch(0.65 0.25 25)";
    case "Port Congestion": return "oklch(0.70 0.22 280)";
    default: return "oklch(0.55 0.04 220)";
  }
}
