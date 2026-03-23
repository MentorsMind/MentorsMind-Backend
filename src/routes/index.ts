import { Router } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import authRoutes from './auth.routes';

const router = Router();

// Mount route modules
router.use('/auth', authRoutes);

// API version info endpoint
router.get('/', (req, res) => {
  ResponseUtil.success(res, {
    version: '1.0.0',
    name: 'MentorMinds Stellar API',
    description: 'Backend API for MentorMinds platform',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      mentors: '/api/v1/mentors',
      bookings: '/api/v1/bookings',
      payments: '/api/v1/payments',
      wallets: '/api/v1/wallets',
    },
    documentation: '/api/docs',
  }, 'Welcome to MentorMinds API');
});

// Health check endpoint
router.get('/health', (req, res) => {
  ResponseUtil.success(res, {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.API_VERSION || 'v1',
  }, 'Service is healthy');
});

// Readiness check endpoint
router.get('/ready', async (req, res) => {
  // Add checks for database, external services, etc.
  const checks = {
    database: true, // TODO: Add actual database check
    stellar: true, // TODO: Add Stellar network check
  };

  const isReady = Object.values(checks).every(check => check === true);

  if (isReady) {
    ResponseUtil.success(res, checks, 'Service is ready');
  } else {
    ResponseUtil.error(res, 'Service is not ready', 503);
  }
});

export default router;
