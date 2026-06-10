import { ENV } from "./env";
import { logger } from "./logger";

export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  logger.warn({ title: payload.title }, "Critical alert triggered");

  if (!ENV.RISKWISE_ALERT_WEBHOOK_URL) {
    return true;
  }

  try {
    const response = await fetch(ENV.RISKWISE_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: payload.title, content: payload.content, ts: new Date().toISOString() }),
    });
    return response.ok;
  } catch (err) {
    logger.warn({ err }, "Alert webhook delivery failed");
    return false;
  }
}
