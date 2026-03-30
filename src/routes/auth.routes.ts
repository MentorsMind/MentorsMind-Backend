import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller';
import { SessionsController } from '../controllers/sessions.controller';
import { MfaController } from '../controllers/mfa.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { loginLockoutCheck } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply stricter rate limiting for auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs for auth routes
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes (rate limited)
router.post('/register', authLimiter, AuthController.register);
// loginLockoutCheck runs before the handler to short-circuit locked accounts early
router.post('/login', authLimiter, asyncHandler(loginLockoutCheck), AuthController.login);
router.post('/refresh', authLimiter, AuthController.refresh);
router.post('/forgot-password', authLimiter, AuthController.forgotPassword);
router.post('/reset-password', authLimiter, AuthController.resetPassword);

// MFA Public routes
router.post('/mfa/validate', authLimiter, asyncHandler(MfaController.validate));
router.post('/mfa/backup', authLimiter, asyncHandler(MfaController.backup));

// Protected routes (no strict rate limiting required beyond global)
router.post('/logout', authenticate, AuthController.logout);
router.get('/me', authenticate, AuthController.getMe);

// MFA Protected routes
router.post('/mfa/setup', authenticate, asyncHandler(MfaController.setup));
router.post('/mfa/verify-setup', authenticate, asyncHandler(MfaController.verifySetup));
router.post('/mfa/disable', authenticate, asyncHandler(MfaController.disable));

// Session management routes
router.get('/sessions', authenticate, asyncHandler(SessionsController.listSessions));
router.delete('/sessions', authenticate, asyncHandler(SessionsController.revokeAllSessions));
router.delete('/sessions/:id', authenticate, asyncHandler(SessionsController.revokeSession));

export default router;
