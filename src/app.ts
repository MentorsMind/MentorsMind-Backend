import express, { Application } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import config from "./config";
import { corsMiddleware } from "./middleware/cors.middleware";
import {
  securityMiddleware,
  sanitizeInput,
} from "./middleware/security.middleware";
import { tracingMiddleware } from "./middleware/tracing.middleware";
import { requestLoggerMiddleware } from "./middleware/request-logger.middleware";
import { distributedGeneralLimiter } from "./middleware/distributed-rate-limit.middleware";
import { dbHealthMiddleware } from "./middleware/db-health.middleware";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { swaggerOptions } from "./config/swagger";
import { blocklistMiddleware } from "./middleware/ipFilter.middleware";
import { i18nMiddleware } from "./middleware/i18n.middleware";
import routes from "./routes";
import v1Router from "./routes/v1";
import v2Router from "./routes/v2";
import HealthService from "./services/health.service";
import { AnalyticsService } from "./services/analytics.service";
import { AdvancedCacheService } from "./services/advanced-cache.service";
import { metricsMiddleware } from "./middleware/metrics.middleware";
import { versioningMiddleware } from "./middleware/versioning.middleware";
import {
  CURRENT_VERSION,
  API_VERSIONS,
  SUPPORTED_VERSIONS,
} from "./config/api-versions.config";
import { logger } from "./utils/logger";
import { initializeI18n } from "./config/i18n.config";
import { tenantMiddleware } from "./middleware/tenant.middleware";
import {
  memoryDashboardHandler,
  memoryMonitorMiddleware,
  startMemoryMonitoring,
} from "./middleware/memory-monitor.middleware";

const app: Application = express();
const { apiVersion } = config.server;
const resolvedApiVersion = apiVersion || CURRENT_VERSION;

// Initialize i18n
initializeI18n().catch((err) => {
  logger.error("Failed to initialize i18n", { error: err });
});

// Tracing middleware must be first for all downstream components
app.use(tracingMiddleware);
app.use(blocklistMiddleware);

// DB pool health & circuit breaker
app.use(dbHealthMiddleware as any);

// Security middleware
app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(requestLoggerMiddleware);
app.use(memoryMonitorMiddleware());
startMemoryMonitoring();

// i18n middleware (after request logger, before other middleware)
app.use(i18nMiddleware);

// Tenant resolution middleware (resolves tenant from hostname)
app.use(tenantMiddleware as any);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(sanitizeInput);
    app.use(distributedGeneralLimiter);
    app.use(metricsMiddleware);
app.use(versioningMiddleware);
app.set("trust proxy", 1);

// Swagger docs (served on the current default version)
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use(
  `/api/${resolvedApiVersion}/docs`,
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "MentorMinds API Documentation",
    swaggerOptions: { persistAuthorization: true },
  }),
);
app.get(`/api/${resolvedApiVersion}/docs/spec.json`, (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// Initialize health service
HealthService.initialize().catch((err) => {
  logger.error("HealthService initialization failed", { error: err });
});

// Initialize analytics service
AnalyticsService.initialize().catch((err) => {
  logger.error("AnalyticsService initialization failed", { error: err });
});

// Initialize advanced cache service
AdvancedCacheService.initialize().catch((err) => {
  logger.error("AdvancedCacheService initialization failed", { error: err });
});

// ─── GET /api/versions ────────────────────────────────────────────────────────
app.get("/api/versions", (_req, res) => {
  const versions = Object.values(API_VERSIONS).map((v) => ({
    version: (v as any).version,
    active: (v as any).active,
    current: (v as any).version === CURRENT_VERSION,
    ...((v as any).deprecatedAt && { deprecatedAt: (v as any).deprecatedAt }),
    ...((v as any).sunsetAt && { sunsetAt: (v as any).sunsetAt }),
    ...((v as any).deprecationMessage && {
      deprecationMessage: (v as any).deprecationMessage,
    }),
    links: {
      docs: (v as any).active ? `/api/${(v as any).version}/docs` : null,
    },
  }));

  res.json({
    status: "success",
    data: {
      current: CURRENT_VERSION,
      supported: SUPPORTED_VERSIONS,
      versions,
    },
  });
});

// ─── API Gateway (opt-in via GATEWAY_ENABLED) ────────────────────────────────
// Service-discovery context is always attached (cheap, additive); the routing /
// rate-limiting / load-balancing proxy only engages when the gateway is enabled
// and a request path matches a registered service prefix.
import { getApiGateway, gatewayRoutes, gatewayConfig } from "./gateway";
import { serviceDiscoveryMiddleware } from "./middleware/service-discovery.middleware";

app.use("/api/v1/gateway", gatewayRoutes);
app.use(serviceDiscoveryMiddleware());
if (gatewayConfig.enabled) {
  app.use(getApiGateway().middleware());
  getApiGateway().start();
  logger.info("API gateway proxy enabled");
}

// ─── Versioned API routes ─────────────────────────────────────────────────────
// v1 — stable, always active
app.use("/api/v1", v1Router);

// v2 — mounted only when marked active in api-versions.config.ts
if (API_VERSIONS.v2?.active) {
  app.use("/api/v2", v2Router);
}

// Legacy mount: honours the API_VERSION env var (defaults to v1)
// Kept for backwards compatibility with deployments that set API_VERSION=v1
if (resolvedApiVersion !== "v1" && resolvedApiVersion !== "v2") {
  app.use(`/api/${resolvedApiVersion}`, routes);
}

import { HealthController } from "./controllers/health.controller";
import { requireAdmin } from "./middleware/admin-auth.middleware";
import { authenticate } from "./middleware/auth.middleware";
import { registerMetricsRoute } from "./middleware/metrics.middleware";

// ─── Health Routes ───────────────────────────────────────────────────────────
app.get("/health/live", HealthController.getLive);
app.get("/health/ready", HealthController.getReady);
app.get(
  "/health/detailed",
  authenticate as any,
  requireAdmin as any,
  HealthController.getDetailed,
);
app.get(
  "/admin/memory",
  authenticate as any,
  requireAdmin as any,
  memoryDashboardHandler,
);
app.get("/health", (_req, res) => res.redirect("/health/ready"));

// ─── DID Document ────────────────────────────────────────────────────────────
import { CredentialsController } from "./controllers/credentials.controller";
app.get("/.well-known/did.json", CredentialsController.getDidDocument);
app.get("/did/credentials/:credentialId/status", CredentialsController.getCredentialStatus);

// ─── Sunset Exemptions (admin, unversioned so it survives version sunsets) ───
import sunsetExemptionsRouter from "./routes/admin/sunset-exemptions.routes";
app.use(
  "/admin/sunset-exemptions",
  authenticate as any,
  requireAdmin as any,
  sunsetExemptionsRouter,
);

// ─── Metrics Route ───────────────────────────────────────────────────────────
registerMetricsRoute(app);

// ─── Root info ────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status: "success",
    message: "MentorMinds Stellar API",
    currentVersion: CURRENT_VERSION,
    supportedVersions: SUPPORTED_VERSIONS,
    documentation: `/api/${CURRENT_VERSION}/docs`,
    versions: "/api/versions",
    health: "/health/ready",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
