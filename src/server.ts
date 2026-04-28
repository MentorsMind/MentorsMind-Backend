// Sentry must be initialised before any other imports so it can instrument them
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  profilesSampleRate: 1.0,
  // Only capture server errors — ignore expected client/auth errors
  beforeSend(event) {
    const status = event.contexts?.response?.status_code as number | undefined;
    if (status && status < 500) return null;
    return event;
  },
});

// Config must be imported first — validates env vars before anything else loads
import config from "./config";
import app from "./app";
import { initializeModels } from "./models";
import { createSocketServer } from "./config/socket";
import { initializeSocketService } from "./services/socket.service";
import { initializeGraphQL } from "./graphql/server";
import {
  stellarMonitorJob,
} from "./jobs/stellarMonitor.job";
import {
  emailWorker,
  paymentWorker,
  escrowReleaseWorker,
  reportWorker,
  sessionReminderWorker,
  stellarTxWorker,
  escrowCheckWorker,
  notificationsWorker,
  notificationCleanupWorker,
  startScheduler,
  stopScheduler,
} from "./workers";
import { initializeEmailTemplates } from "./services/template-initializer.service";
import { logger } from "./utils/logger.utils";
import { validateRequiredTables } from "./utils/table-validator.utils";

// Initialize database tables, then seed email templates
initializeModels()
  .then(() => initializeEmailTemplates())
  .then(() => {
    // Validate that all required tables exist (from migrations)
    return validateRequiredTables();
  })
  .then((validation) => {
    if (!validation.allTablesExist) {
      logger.error(
        `Database validation failed: ${validation.missingTables.length} table(s) missing. ` +
          "Please run migrations before starting the server.",
        { missingTables: validation.missingTables },
      );
      // Don't exit here - allow health check to report the issue
      // This gives ops teams time to fix via migrations
    } else {
      logger.info("Database validation successful: all required tables exist");
    }
  })
  .catch((err) => {
    logger.error({ err }, "Failed to initialize models or validate tables");
    console.error("Failed to initialize models:", err);
  });

// Initialize JWKS key store (generates RSA key pair if none exists)
import("./services/jwks.service").then(({ JwksService }) =>
  JwksService.initialize().catch((err) =>
    logger.error("Failed to initialize JWKS key store", { error: err }),
  ),
);

// Start background job workers and scheduler
startScheduler().catch((err) => {
  logger.error("Failed to start job scheduler", { error: err });
});

const { port: PORT, apiVersion: API_VERSION } = config.server;
const NODE_ENV = config.env;

// Initialize GraphQL server
initializeGraphQL(app).catch((err) => {
  logger.error("Failed to initialize GraphQL server", { error: err });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info("Server started", {
    port: PORT,
    env: NODE_ENV,
    apiUrl: `http://localhost:${PORT}/api/${API_VERSION}`,
    healthCheck: `http://localhost:${PORT}/health`,
    apiDocs: `http://localhost:${PORT}/api/${API_VERSION}/docs`,
    graphql: `http://localhost:${PORT}/api/graphql`,
    webSocket: `ws://localhost:${PORT}/ws`,
  });
});

// Attach Socket.IO server to the same HTTP server
const io = createSocketServer(server);
initializeSocketService(io);

// Subscribe to Stellar Horizon SSE for real-time payment confirmations
stellarMonitorJob.start().catch((err) => {
  logger.error("Failed to start Horizon SSE monitor", { error: err });
});

// Start background exchange rate refresh (60s interval, cached in Redis)
import('./services/assetExchange.service').then(({ AssetExchangeService }) => {
  AssetExchangeService.startRateRefresh();
}).catch((err) => logger.error('Failed to start asset exchange rate refresh', { error: err }));

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, "Signal received: closing HTTP server");
  stellarMonitorJob.stop();
  await Promise.all([
    emailWorker.close(),
    paymentWorker.close(),
    escrowReleaseWorker.close(),
    reportWorker.close(),
    sessionReminderWorker.close(),
    stellarTxWorker.close(),
    escrowCheckWorker.close(),
    notificationsWorker.close(),
    notificationCleanupWorker.close(),
    stopScheduler(),
  ]);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
