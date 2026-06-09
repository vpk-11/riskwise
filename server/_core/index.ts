import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import cron from "node-cron";
import { nanoid } from "nanoid";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { athenaHourlyScan } from "../scheduledHandlers";
import { logger } from "./logger";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Request ID middleware
  app.use((req, _res, next) => {
    (req as typeof req & { id: string }).id = nanoid(12);
    next();
  });

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        ms: Date.now() - start,
        requestId: (req as typeof req & { id: string }).id,
      }, "request");
    });
    next();
  });

  // Google Maps proxy — keeps API key server-side
  app.get("/api/maps/js", async (req, res) => {
    const key = ENV.GOOGLE_MAPS_API_KEY;
    if (!key) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.send(`console.warn('[RiskWise] GOOGLE_MAPS_API_KEY not configured — maps disabled');`);
      return;
    }
    const libraries = (req.query.libraries as string) || "marker,places,geocoding,geometry";
    const v = (req.query.v as string) || "weekly";
    const url = `https://maps.googleapis.com/maps/api/js?key=${key}&v=${v}&libraries=${libraries}`;
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        logger.warn({ status: upstream.status }, "Maps API upstream error");
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.send(`console.error('[RiskWise] Maps API error ${upstream.status}');`);
        return;
      }
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(text);
    } catch (err) {
      logger.error({ err }, "Maps proxy error");
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.send(`console.error('[RiskWise] Maps proxy unavailable');`);
    }
  });

  // tRPC
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );

  // Central error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  if (ENV.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(ENV.PORT ?? "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    logger.warn(`Port ${preferredPort} busy, using ${port}`);
  }

  server.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
  });

  // Athena hourly scan via node-cron
  cron.schedule("0 * * * *", () => {
    athenaHourlyScan().catch((err) => logger.error({ err }, "Athena cron failed"));
  });
  logger.info("Athena hourly scan scheduled (every hour at :00)");
}

startServer().catch((err) => {
  logger.error({ err }, "Server failed to start");
  process.exit(1);
});
