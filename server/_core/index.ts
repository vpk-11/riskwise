import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { athenaHourlyScanHandler } from "../scheduledHandlers";
import { createHeartbeatJob, listHeartbeatJobs } from "./heartbeat";
import { upsertHeartbeatJob } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// Register the Athena hourly scan heartbeat job (idempotent)
async function registerAthenaHeartbeat() {
  try {
    // Check if already registered
    const existing = await listHeartbeatJobs("");
    const alreadyExists = (existing?.jobs ?? []).some((j) => j.name === "athena-hourly-scan");
    if (alreadyExists) {
      console.log("[Heartbeat] Athena hourly scan job already registered.");
      return;
    }
    const result = await createHeartbeatJob(
      {
        name: "athena-hourly-scan",
        cron: "0 0 * * * *", // every hour at :00
        path: "/api/scheduled/athena-scan",
        method: "POST",
        description: "Agent Athena: hourly supply chain disruption scan",
      },
      "" // use project owner identity
    );
    await upsertHeartbeatJob("athena-hourly-scan", result.taskUid, "Agent Athena hourly scan");
    console.log(`[Heartbeat] Athena hourly scan registered. taskUid=${result.taskUid}`);
  } catch (err) {
    console.warn("[Heartbeat] Could not register Athena job:", (err as Error).message);
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Scheduled handlers — must be registered before Vite/static fallthrough
  app.post("/api/scheduled/athena-scan", athenaHourlyScanHandler);

  // Server-side Google Maps proxy — forwards requests with the correct Origin
  // Uses VITE_FRONTEND_FORGE_API_KEY (the only key valid for the Maps proxy endpoint).
  app.get("/api/maps/js", async (req, res) => {
    try {
      // VITE_FRONTEND_FORGE_API_KEY is the correct key for the Maps proxy.
      // BUILT_IN_FORGE_API_KEY is for LLM/notification APIs only and will 401 on maps.
      // Both are injected as system env vars in production (Cloud Run) and sandbox.
      const forgeBase = process.env.VITE_FRONTEND_FORGE_API_URL || process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.ai";
      const forgeKey = process.env.VITE_FRONTEND_FORGE_API_KEY || "";
      const libraries = (req.query.libraries as string) || "marker,places,geocoding,geometry";
      const v = (req.query.v as string) || "weekly";
      const upstreamUrl = `${forgeBase}/v1/maps/proxy/maps/api/js?key=${forgeKey}&v=${v}&libraries=${libraries}`;
      // Determine the public origin from the request itself.
      // The Manus gateway sets x-forwarded-host to the public domain;
      // fall back to the Host header if not present.
      const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
      const forwardedProto = req.get("x-forwarded-proto") || req.protocol;
      const origin = `${forwardedProto}://${forwardedHost}`;
      console.log(`[Maps proxy] Fetching for origin: ${origin}`);
      const upstream = await fetch(upstreamUrl, {
        headers: { Origin: origin },
      });
      if (!upstream.ok) {
        const errBody = await upstream.text();
        console.error(`[Maps proxy] Upstream error ${upstream.status}: ${errBody.slice(0, 200)}`);
        // Return valid JS that throws a descriptive error (not HTML — avoids MIME type rejection)
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.status(200).send(`console.error('[RiskWise] Google Maps proxy returned ${upstream.status}. Check server logs.');`);
        return;
      }
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(text);
    } catch (err) {
      console.error("[Maps proxy] Error:", err);
      // Return valid JS on error — never return HTML to a <script> tag
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.status(200).send(`console.error('[RiskWise] Google Maps proxy unavailable: ${String(err).replace(/'/g, "\\'")}'  );`);
    }
  });

  // Maps proxy health check — returns JSON status for debugging on the published domain
  app.get("/api/maps/health", async (req, res) => {
    const forgeBase = process.env.VITE_FRONTEND_FORGE_API_URL || process.env.BUILT_IN_FORGE_API_URL || "";
    const forgeKey = process.env.VITE_FRONTEND_FORGE_API_KEY || "";
    const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
    const forwardedProto = req.get("x-forwarded-proto") || req.protocol;
    const origin = `${forwardedProto}://${forwardedHost}`;
    const hasKey = forgeKey.length > 0;
    const hasBase = forgeBase.length > 0;
    let upstreamStatus: number | null = null;
    try {
      if (hasKey && hasBase) {
        const testUrl = `${forgeBase}/v1/maps/proxy/maps/api/js?key=${forgeKey}&v=weekly&libraries=marker`;
        const r = await fetch(testUrl, { headers: { Origin: origin }, signal: AbortSignal.timeout(5000) });
        upstreamStatus = r.status;
      }
    } catch { /* timeout or network error */ }
    res.json({
      ok: upstreamStatus === 200,
      origin,
      hasKey,
      hasBase,
      upstreamStatus,
    });
  });

  // Register Athena hourly heartbeat job (idempotent — only creates if not already registered)
  registerAthenaHeartbeat().catch((err: Error) => console.warn("[Heartbeat] Registration failed:", err.message));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
