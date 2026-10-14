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
import { checkLlm } from "./llm";

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
  // The evaluation rate limit keys on req.ip. Behind a reverse proxy that is the proxy unless the hop count is set.
  // Left at 0 by default: trusting X-Forwarded-For with no proxy lets any client fake its IP and dodge the limit.
  app.set("trust proxy", ENV.RISKWISE_TRUST_PROXY);
  const server = createServer(app);

  app.use(express.json({ limit: "100kb" }));

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

  // Dev-only manual trigger. Must be registered before the Vite / static catch-all or it is shadowed.
  if (!ENV.isProduction) {
    app.post("/api/dev/trigger-athena", (_req, res) => {
      athenaHourlyScan()
        .then(() => res.json({ ok: true }))
        .catch((err) => res.status(500).json({ error: String(err) }));
    });
  }

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

  checkLlm().then((llm) => {
    if (llm.status === "ready") logger.info({ model: llm.model, baseUrl: llm.baseUrl }, "LLM ready");
    else logger.warn({ model: llm.model, baseUrl: llm.baseUrl, status: llm.status, detail: llm.detail }, "LLM not ready: evaluations will return templated text until this is fixed");
  });

  // Seed on startup so the DB isn't empty on first boot
  setTimeout(() => {
    athenaHourlyScan().catch((err) => logger.warn({ err }, "Athena startup scan failed"));
  }, 3000);
}

startServer().catch((err) => {
  logger.error({ err }, "Server failed to start");
  process.exit(1);
});
