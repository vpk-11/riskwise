/**
 * Scheduled Handler: Athena Hourly Scan
 *
 * This handler is called every hour by the Manus Heartbeat cron system.
 * Agent Athena scans for new trade disruptions and inserts them into the DB.
 */

import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runAthenaScan } from "./agents";
import { insertRiskEvent } from "./db";

export async function athenaHourlyScanHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only endpoint" });
    }

    console.log("[Athena Scan] Starting hourly disruption scan...");

    const newEvent = await runAthenaScan();

    await insertRiskEvent({
      title: newEvent.title,
      description: newEvent.description,
      category: newEvent.category,
      severity: newEvent.severity,
      affectedLocations: newEvent.affectedLocations,
      sourceUrl: null,
      isActive: 1,
    });

    console.log(`[Athena Scan] Inserted new event: ${newEvent.title} (${newEvent.severity})`);

    return res.json({
      ok: true,
      event: {
        title: newEvent.title,
        category: newEvent.category,
        severity: newEvent.severity,
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error("[Athena Scan] Error:", err.message);
    return res.status(500).json({
      error: err.message,
      stack: err.stack,
      context: { url: req.url },
      timestamp: new Date().toISOString(),
    });
  }
}
