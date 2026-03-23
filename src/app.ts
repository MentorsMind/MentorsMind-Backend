import express, { Application } from 'express';
import dotenv from 'dotenv';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { corsMiddleware } from './middleware/cors.middleware';
import { securityMiddleware, sanitizeInput } from './middleware/security.middleware';
import { requestLogger } from './middleware/logging.middleware';
import { generalLimiter } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { swaggerOptions } from './config/swagger';
import routes from './routes';

// Load environment variables
dotenv.config();

const app: Application = express();

// Security middleware (should be first)
app.use(securityMiddleware);

// CORS configuration
app.use(corsMiddleware);

// Request logging
app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// Rate limiting
app.use(generalLimiter);

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Swagger documentation
const swaggerSpec = swaggerJsdoc(swaggerOptions);
const apiVersion = process.env.API_VERSION || 'v1';
app.use(`/api/${apiVersion}/docs`, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'MentorMinds API Documentation',
}));

// Serve OpenAPI spec as JSON
app.get(`/api/${apiVersion}/docs.json`, (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// API routes
app.use(`/api/${apiVersion}`, routes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    status: 'success',
    message: 'MentorMinds Stellar API',
    version: apiVersion,
    documentation: `/api/${apiVersion}/docs`,
    health: '/health',
  });
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

export default app;
