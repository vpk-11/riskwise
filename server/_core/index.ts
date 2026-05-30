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
