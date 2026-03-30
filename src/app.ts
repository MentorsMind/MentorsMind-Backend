import express, { Application } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import config from './config';
import { corsMiddleware } from './middleware/cors.middleware';
import { securityMiddleware, sanitizeInput } from './middleware/security.middleware';
import { correlationIdMiddleware } from './middleware/correlation-id.middleware';
import { requestIdMiddleware } from './middleware/requestId.middleware';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware';
import { generalLimiter } from './middleware/rate-limit.middleware';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { swaggerOptions } from './config/swagger';
import routes from './routes';
import v1Router from './routes/v1';
import v2Router from './routes/v2';
import HealthService from './services/health.service';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { versioningMiddleware } from './middleware/versioning.middleware';
import { CURRENT_VERSION, API_VERSIONS, SUPPORTED_VERSIONS } from './config/api-versions.config';
import { logger } from './utils/logger';

const app: Application = express();
const { apiVersion } = config.server;
const resolvedApiVersion = apiVersion || CURRENT_VERSION;

// Correlation ID must be first so all downstream middleware/handlers have access
app.use(correlationIdMiddleware);
app.use(requestIdMiddleware);

// Security middleware
app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(requestLoggerMiddleware);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(sanitizeInput);
app.use(generalLimiter);
app.use(metricsMiddleware);
app.use(versioningMiddleware);
app.set('trust proxy', 1);

// Swagger docs (served on the current default version)
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use(
  `/api/${resolvedApiVersion}/docs`,
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'MentorMinds API Documentation',
    swaggerOptions: { persistAuthorization: true },
  }),
);
app.get(`/api/${resolvedApiVersion}/docs/spec.json`, (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Initialize health service
HealthService.initialize().catch((err) => {
  logger.error('HealthService initialization failed', { error: err });
});

// ─── GET /api/versions ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/versions:
 *   get:
 *     summary: List all API versions
 *     description: >
 *       Returns the full catalogue of API versions — active, deprecated, and
 *       sunset — along with deprecation dates so clients can plan migrations.
 *     tags: [Versioning]
 *     responses:
 *       200:
 *         description: Version catalogue
 *         headers:
 *           X-API-Version:
 *             description: Version used to serve this response
 *             schema:
 *               type: string
 *           X-Supported-Versions:
 *             description: Comma-separated list of currently active versions
 *             schema:
 *               type: string
 */
app.get('/api/versions', (_req, res) => {
  const versions = Object.values(API_VERSIONS).map((v) => ({
    version: v.version,
    active: v.active,
    current: v.version === CURRENT_VERSION,
    ...(v.deprecatedAt && { deprecatedAt: v.deprecatedAt }),
    ...(v.sunsetAt && { sunsetAt: v.sunsetAt }),
    ...(v.deprecationMessage && { deprecationMessage: v.deprecationMessage }),
    links: {
      docs: v.active ? `/api/${v.version}/docs` : null,
    },
  }));

  res.json({
    status: 'success',
    data: {
      current: CURRENT_VERSION,
      supported: SUPPORTED_VERSIONS,
      versions,
    },
  });
});

// ─── Versioned API routes ─────────────────────────────────────────────────────
// v1 — stable, always active
app.use('/api/v1', v1Router);

// v2 — mounted only when marked active in api-versions.config.ts
if (API_VERSIONS.v2?.active) {
  app.use('/api/v2', v2Router);
}

// Legacy mount: honours the API_VERSION env var (defaults to v1)
// Kept for backwards compatibility with deployments that set API_VERSION=v1
if (resolvedApiVersion !== 'v1' && resolvedApiVersion !== 'v2') {
  app.use(`/api/${resolvedApiVersion}`, routes);
}

// ─── Root info ────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'success',
    message: 'MentorMinds Stellar API',
    currentVersion: CURRENT_VERSION,
    supportedVersions: SUPPORTED_VERSIONS,
    documentation: `/api/${CURRENT_VERSION}/docs`,
    versions: '/api/versions',
    health: '/health',
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
