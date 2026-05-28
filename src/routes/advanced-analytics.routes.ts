import { Router } from "express";
import { AdvancedAnalyticsController } from "../controllers/advanced-analytics.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { rateLimiter } from "../middleware/rateLimiter.middleware";
import { validateRequest } from "../middleware/validation.middleware";
import { query, param } from "express-validator";

const router = Router();

// Rate limiting configuration for analytics endpoints
const analyticsRateLimit = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: "Too many analytics requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const exportRateLimit = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 exports per hour
  message: "Export limit exceeded, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const periodValidation = query('period')
  .optional()
  .isIn(['7d', '30d', '90d', '1y'])
  .withMessage('Period must be one of: 7d, 30d, 90d, 1y');

const currencyValidation = query('currency')
  .optional()
  .isIn(['XLM', 'USDC', 'PYUSD'])
  .withMessage('Currency must be one of: XLM, USDC, PYUSD');

const formatValidation = query('format')
  .optional()
  .isIn(['json', 'csv'])
  .withMessage('Format must be json or csv');

const dateRangeValidation = [
  query('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
    .custom((endDate, { req }) => {
      const startDate = new Date(req.query?.startDate as string);
      const end = new Date(endDate);
      
      if (end <= startDate) {
        throw new Error('End date must be after start date');
      }
      
      // Max 2 years range
      const daysDiff = Math.ceil((end.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 730) {
        throw new Error('Date range cannot exceed 2 years');
      }
      
      return true;
    })
];

const metricTypeValidation = param('type')
  .isIn(['revenue', 'sessions', 'users', 'growth'])
  .withMessage('Metric type must be one of: revenue, sessions, users, growth');

// Dashboard endpoints
router.get(
  '/dashboard',
  authenticateToken,
  analyticsRateLimit,
  [
    periodValidation,
    query('realTime')
      .optional()
      .isBoolean()
      .withMessage('realTime must be a boolean')
  ],
  validateRequest,
  AdvancedAnalyticsController.getDashboard
);

// Revenue analytics
router.get(
  '/revenue',
  authenticateToken,
  analyticsRateLimit,
  [periodValidation, currencyValidation, formatValidation],
  validateRequest,
  AdvancedAnalyticsController.getRevenue
);

// Session analytics
router.get(
  '/sessions',
  authenticateToken,
  analyticsRateLimit,
  [
    periodValidation,
    formatValidation,
    query('status')
      .optional()
      .isIn(['completed', 'cancelled', 'confirmed', 'pending'])
      .withMessage('Status must be one of: completed, cancelled, confirmed, pending')
  ],
  validateRequest,
  AdvancedAnalyticsController.getSessions
);

// User analytics
router.get(
  '/users',
  authenticateToken,
  analyticsRateLimit,
  [
    periodValidation,
    formatValidation,
    query('role')
      .optional()
      .isIn(['mentor', 'learner'])
      .withMessage('Role must be mentor or learner')
  ],
  validateRequest,
  AdvancedAnalyticsController.getUsers
);

// Growth analytics
router.get(
  '/growth',
  authenticateToken,
  analyticsRateLimit,
  [periodValidation],
  validateRequest,
  AdvancedAnalyticsController.getGrowth
);

// Metrics by date range
router.get(
  '/metrics/:type',
  authenticateToken,
  analyticsRateLimit,
  [metricTypeValidation, ...dateRangeValidation],
  validateRequest,
  AdvancedAnalyticsController.getMetricsByDateRange
);

// System management endpoints (admin only)
router.post(
  '/refresh',
  authenticateToken,
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 4, // 4 refreshes per 15 minutes
    message: "Refresh limit exceeded, please try again later"
  }),
  AdvancedAnalyticsController.refreshAnalytics
);

// Health check
router.get(
  '/health',
  authenticateToken,
  analyticsRateLimit,
  AdvancedAnalyticsController.getHealth
);

export default router;