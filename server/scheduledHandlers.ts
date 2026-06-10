import { logger } from "./_core/logger";
import { runAthenaScan } from "./agents";
import { insertRiskEvent } from "./db";

export async function athenaHourlyScan(): Promise<void> {
  logger.info("[Athena Scan] Starting hourly disruption scan");
  try {
    const newEvent = await runAthenaScan();
    await insertRiskEvent({
      title: newEvent.title,
      description: newEvent.description,
      category: newEvent.category,
      severity: newEvent.severity,
      affectedLocations: newEvent.affectedLocations,
      sourceUrl: null,
      isActive: true,
    });
    logger.info(
      { title: newEvent.title, severity: newEvent.severity },
      "[Athena Scan] Event inserted"
    );
  } catch (err) {
    logger.error({ err }, "[Athena Scan] Scan failed");
    throw err;
  }
}
