import { logger, logAthenaScan } from "./_core/logger";
import { selectScanEvent } from "./agents";
import { activeRiskEventExists, insertRiskEvent } from "./db";

/** Persists the top live event. Never fabricates one: with no live data it stores nothing. */
export async function athenaHourlyScan(): Promise<void> {
  const start = Date.now();
  logger.info("[Athena Scan] Starting hourly disruption scan");
  try {
    const event = await selectScanEvent();
    if (!event) {
      logAthenaScan({ source: "none", title: "none", severity: "none", category: "none", durationMs: Date.now() - start, success: true });
      logger.warn("[Athena Scan] No live events available, nothing stored");
      return;
    }
    if (await activeRiskEventExists(event.title)) {
      logger.info({ title: event.title }, "[Athena Scan] Event already stored, skipping");
      return;
    }
    await insertRiskEvent({
      title: event.title,
      description: `[Live - ${event.sourceProvider}] ${event.description}`,
      category: event.category,
      severity: event.severity,
      affectedLocations: event.affectedLocations,
      sourceUrl: event.sourceUrl ?? null,
      longitude: event.coordinates?.[0] ?? null,
      latitude: event.coordinates?.[1] ?? null,
      sourceType: "live",
      isActive: true,
    });
    logAthenaScan({
      source: "live",
      provider: event.sourceProvider,
      title: event.title,
      severity: event.severity,
      category: event.category,
      durationMs: Date.now() - start,
      success: true,
    });
  } catch (err) {
    logger.error({ err }, "[Athena Scan] Scan failed");
    throw err;
  }
}
