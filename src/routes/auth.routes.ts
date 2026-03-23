import { Router } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import { authLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Apply auth-specific rate limiting
router.use(authLimiter);

// Example auth routes (to be implemented)
router.post('/register', (req, res) => {
  ResponseUtil.success(res, null, 'Registration endpoint - to be implemented');
});

router.post('/login', (req, res) => {
  ResponseUtil.success(res, null, 'Login endpoint - to be implemented');
});

router.post('/refresh', (req, res) => {
  ResponseUtil.success(res, null, 'Token refresh endpoint - to be implemented');
});

router.post('/logout', (req, res) => {
  ResponseUtil.success(res, null, 'Logout endpoint - to be implemented');
});

export default router;
