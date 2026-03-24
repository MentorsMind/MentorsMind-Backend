import express, { Application } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import config from './config';
import { corsMiddleware } from './middleware/cors.middleware';
import {
  securityMiddleware,
  sanitizeInput,
} from './middleware/security.middleware';
import { requestLogger } from './middleware/logging.middleware';
import { generalLimiter } from './middleware/rate-limit.middleware';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { swaggerOptions } from './config/swagger';
import routes from './routes';
import HealthService from './services/health.service';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { versioningMiddleware } from './middleware/versioning.middleware';
import { CURRENT_VERSION } from './config/api-versions.config';

const app: Application = express();
const { apiVersion } = config.server;
const resolvedApiVersion = apiVersion || CURRENT_VERSION;

// Security middleware (should be first)
app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(requestLogger);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(sanitizeInput);
app.use(generalLimiter);
app.use(metricsMiddleware);
app.use(versioningMiddleware);
app.set('trust proxy', 1);

// Swagger docs
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
  console.error('HealthService initialization failed:', err);
});

// API routes
app.use(`/api/${resolvedApiVersion}`, routes);

app.get('/', (_req, res) => {
  res.json({
    status: 'success',
    message: 'MentorMinds Stellar API',
    version: resolvedApiVersion,
    documentation: `/api/${resolvedApiVersion}/docs`,
    health: '/health',
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
