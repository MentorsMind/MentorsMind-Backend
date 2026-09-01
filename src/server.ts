import { initTracing } from "./config/tracing";

// OpenTelemetry must be initialised before any other imports so that
// auto-instrumentations (http, express, pg, ioredis) can patch modules
// at load time, and so traceparent propagation works on outbound calls.
initTracing();

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

// Sentry must be initialised before any other imports so it can instrument them
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

import http from "http";
// Config must be imported first — validates env vars before anything else loads
import config from "./config";
import app from "./app";
import { initializeCollaborationSocket } from "./services/collaboration.socket";
import { createSocketServer } from "./config/socket";
import { initializeSocketService } from "./services/socket.service";
import { initializeGraphQL } from "./graphql/server";
import { stellarMonitorJob } from "./jobs/stellarMonitor.job";
import backupJob from "./jobs/backup.job";
import { goalReminderJob } from "./jobs/goalReminder.job";
import keyRotationJob from "./jobs/keyRotation.job";
import baselineRefreshJob from "./jobs/baselineRefresh.job";
import { runReEncryptionJob } from "./jobs/re-encrypt-pii.job";
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
  maintenanceWorker,
  webhookDeliveryWorker,
  transcriptionWorker,
  onboardingNudgeWorker,
  taxReportingWorker,
  startScheduler,
  stopScheduler,
  startRetentionEnforcementWorker,
  stopRetentionEnforcementWorker,
} from "./workers";
import { initializeEmailTemplates } from "./services/template-initializer.service";
import { logger } from "./utils/logger.utils";
import { validateRequiredTables } from "./utils/table-validator.utils";
import { startPoolMonitor, stopPoolMonitor } from "./utils/pool-monitor.utils";
import { JwksService } from "./services/jwks.service";
import { registerBookingProjectionHandlers } from "./events/booking.projections";
import { ProjectionService } from "./services/projection.service";

// Import queues for side effects
import "./queues/bulk.queue";
import "./queues/export.queue";

const { port: PORT, apiVersion: API_VERSION } = config.server;
const NODE_ENV = config.env;

const server = http.createServer(app);

// Register booking event-sourcing projection handlers before accepting traffic.
registerBookingProjectionHandlers();
logger.info("Booking projection handlers registered at startup", {
  handlerCount: ProjectionService.getHandlerCount(),
  handlers: ProjectionService.listHandlers(),
});

// Validate that all required tables exist (from migrations)
// This replaces the anti-pattern of creating tables at runtime via DDL
validateRequiredTables()
  .then((validation) => {
    if (!validation.allTablesExist) {
      logger.error(
        `Database validation failed: ${validation.missingTables.length} table(s) missing. ` +
          "Please run migrations before starting the server.",
        { missingTables: validation.missingTables },
      );
    } else {
      logger.info("Database validation successful: all required tables exist");
    }
  })
  .catch((err) => {
    logger.error({ err }, "Failed to validate database tables");
  });

// Initialize email templates
initializeEmailTemplates().catch((err) => {
  logger.error("Failed to initialize email templates", { error: err });
});

// Initialize JWKS key store (generates RSA key pair if none exists)
import("./services/jwks.service").then(({ JwksService }) =>
  JwksService.initialize().then(async () => {
    // Check if rotation is needed on startup
    await JwksService.autoRotateIfNeeded().catch((err) =>
      logger.warn("Auto-rotate on startup failed", { error: err }),
    );
  }).catch((err) =>
    logger.error("Failed to initialize JWKS key store", { error: err }),
  ),
);

// Initialize key rotation jobs
keyRotationJob.initialize();
baselineRefreshJob.initialize();
runReEncryptionJob().catch(err => {
  logger.error("Failed to run Google Calendar re-encryption job", { error: err });
});

// Log effective retry configuration for each active queue
import { defaultJobOptions, QUEUE_NAMES } from "./config/queue";
import { subscribeToFeatureFlagUpdates } from "./services/feature-flag.service";
const queueRetryOverrides: Record<
  string,
  { attempts: number; backoff: unknown }
> = {
  [QUEUE_NAMES.PAYMENT_POLL]: {
    attempts: 20,
    backoff: { type: "fixed", delay: 30_000 },
  },
};
Object.values(QUEUE_NAMES).forEach((name) => {
  const effective = queueRetryOverrides[name] ?? {
    attempts: defaultJobOptions.attempts,
    backoff: defaultJobOptions.backoff,
  };
  logger.info("Queue retry config", { queue: name, ...effective });
});

// Start background job workers and scheduler
startScheduler().catch((err) => {
  logger.error("Failed to start job scheduler", { error: err });
});
startRetentionEnforcementWorker();

// Subscribe to feature-flag update events so this instance's in-memory
// flag cache invalidates within ~2s of any instance changing a flag
subscribeToFeatureFlagUpdates().catch((err) => {
  logger.error("Failed to subscribe to feature flag updates", { error: err });
});

// Initialize collaboration sockets
initializeCollaborationSocket(server);

// Initialize GraphQL server
initializeGraphQL(app).catch((err) => {
  logger.error("Failed to initialize GraphQL server", { error: err });
});

// Start pool monitor
startPoolMonitor();

// Attach Socket.IO server to the same HTTP server
const io = createSocketServer(server);
initializeSocketService(io);

// Subscribe to Stellar Horizon SSE for real-time payment confirmations
stellarMonitorJob.start().catch((err) => {
  logger.error("Failed to start Horizon SSE monitor", { error: err });
});

// Start scheduled database backup jobs (daily full, hourly WAL, retention)
backupJob.initialize();
goalReminderJob.initialize();

// Start background exchange rate refresh
import("./services/assetExchange.service")
  .then(({ AssetExchangeService }) => {
    AssetExchangeService.startRateRefresh();
  })
  .catch((err) =>
    logger.error("Failed to start asset exchange rate refresh", { error: err }),
  );

server.listen(PORT, () => {
  logger.info("Server started", {
    port: PORT,
    env: NODE_ENV,
    apiUrl: `http://localhost:${PORT}/api/${API_VERSION}`,
    healthCheck: `http://localhost:${PORT}/health/ready`,
    apiDocs: `http://localhost:${PORT}/api/${API_VERSION}/docs`,
    graphql: `http://localhost:${PORT}/api/graphql`,
    webSocket: `ws://localhost:${PORT}/ws`,
  });
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, "Signal received: closing HTTP server");
  stellarMonitorJob.stop();
  backupJob.stop();
  goalReminderJob.stop();
  keyRotationJob.stop();
  baselineRefreshJob.stop();
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
    maintenanceWorker.close(),
    webhookDeliveryWorker.close(),
    transcriptionWorker.close(),
    onboardingNudgeWorker.close(),
    taxReportingWorker.close(),
    stopScheduler(),
    stopRetentionEnforcementWorker(),
    Promise.resolve(stopPoolMonitor()),
  ]);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
