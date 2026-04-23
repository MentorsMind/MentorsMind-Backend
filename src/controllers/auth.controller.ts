import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from '../validators/auth.validator';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ZodError } from 'zod';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';
import { LoginAttemptsService } from '../services/loginAttempts.service';

export const AuthController = {
  async register(req: Request, res: Response) {
    try {
      const validatedData = registerSchema.parse(req).body;
      const result = await AuthService.register(validatedData);

      await AuditLogService.log({
        userId: result.userId || null,
        action: 'USER_REGISTERED',
        resourceType: 'auth',
        resourceId: result.userId || null,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        metadata: { email: validatedData.email, role: validatedData.role },
      });

      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async login(req: Request, res: Response) {
    const ipAddress = extractIpAddress(req);
    const userAgent = req.headers['user-agent'] || null;

    try {
      const validatedData = loginSchema.parse(req).body;
      const { email } = validatedData;

      // ── Check lockout status before attempting auth ──
      const lockStatus = await LoginAttemptsService.getStatus(email);

      if (lockStatus.locked) {
        await AuditLogService.log({
          userId: null,
          action: 'LOGIN_BLOCKED_LOCKOUT',
          resourceType: 'auth',
          ipAddress,
          userAgent,
          metadata: { email, permanent: lockStatus.permanent, attempts: lockStatus.attempts },
        });

        if (lockStatus.permanent) {
          return res.status(429).json({
            success: false,
            error: 'Account permanently locked due to too many failed attempts. Contact support.',
            captcha_required: true,
          });
        }

        res.setHeader('Retry-After', String(lockStatus.retryAfter ?? 900));
        return res.status(429).json({
          success: false,
          error: 'Account temporarily locked. Too many failed login attempts.',
          retry_after: lockStatus.retryAfter,
          captcha_required: true,
        });
      }

      // ── Attempt login ──
      const result = await AuthService.login(validatedData, ipAddress, userAgent);

      if (result.mfaRequired) {
        return res.status(200).json({
          success: true,
          mfa_required: true,
          mfa_token: result.mfaToken,
        });
      }

      // Success — reset counter
      await LoginAttemptsService.resetAttempts(email);

      await AuditLogService.log({
        userId: result.userId,
        action: 'LOGIN_SUCCESS',
        resourceType: 'auth',
        resourceId: result.userId,
        ipAddress,
        userAgent,
        metadata: { email },
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      // Parse email from body for failure tracking (safe — already validated above if we got here)
      const parsed = loginSchema.safeParse(req);
      const email = parsed.success ? parsed.data.body.email : null;

      if (email) {
        // Record failure and get updated status
        const lockStatus = await LoginAttemptsService.recordFailure(email, ipAddress, email);

        await AuditLogService.log({
          userId: null,
          action: 'LOGIN_FAILED',
          resourceType: 'auth',
          ipAddress,
          userAgent,
          metadata: {
            email,
            reason: error.message,
            attempts: lockStatus.attempts,
            locked: lockStatus.locked,
          },
        });

        // If this failure just triggered a lockout, respond with 429
        if (lockStatus.locked) {
          if (lockStatus.permanent) {
            return res.status(429).json({
              success: false,
              error: 'Account permanently locked due to too many failed attempts. Contact support.',
              captcha_required: true,
            });
          }

          res.setHeader('Retry-After', String(lockStatus.retryAfter ?? 900));
          return res.status(429).json({
            success: false,
            error: 'Account temporarily locked. Too many failed login attempts.',
            retry_after: lockStatus.retryAfter,
            captcha_required: true,
          });
        }

        // Not yet locked — return normal auth error with captcha hint
        if (error instanceof ZodError) {
          return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
        }

        return res.status(401).json({
          success: false,
          error: 'Invalid email or password.',
          captcha_required: lockStatus.captchaRequired,
          attempts_remaining: Math.max(0, 5 - lockStatus.attempts),
        });
      }

      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async logout(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (userId) {
        await AuthService.logout(userId);

        await AuditLogService.log({
          userId,
          action: 'LOGOUT',
          resourceType: 'auth',
          resourceId: userId,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'] || null,
        });
      }
      return res.status(200).json({ success: true, message: 'Logged out successfully.' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async refresh(req: Request, res: Response) {
    try {
      const validatedData = refreshTokenSchema.parse(req).body;
      const result = await AuthService.refresh(validatedData.refreshToken);
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      }
      return res.status(401).json({ success: false, error: error.message });
    }
  },

  async forgotPassword(req: Request, res: Response) {
    try {
      const validatedData = forgotPasswordSchema.parse(req).body;
      await AuthService.forgotPassword(validatedData.email);
      return res.status(200).json({
        success: true,
        message: 'If the email exists, a reset link has been generated.',
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async resetPassword(req: Request, res: Response) {
    try {
      const validatedData = resetPasswordSchema.parse(req).body;
      const userId = await AuthService.resetPassword(validatedData);

      if (userId) {
        await AuditLogService.log({
          userId,
          action: 'PASSWORD_CHANGED',
          resourceType: 'auth',
          resourceId: userId,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'] || null,
          metadata: { method: 'reset_token' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Password reset successfully. You can now login with your new password.',
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      }
      return res.status(400).json({ success: false, error: error.message });
    }
  },

  async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const user = await UsersService.findPublicById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found.' });
      }

      return res.status(200).json({ success: true, data: user });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
};
