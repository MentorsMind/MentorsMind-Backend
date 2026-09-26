import { Response, NextFunction, Request } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { requireRole } from './rbac.middleware';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from '../utils/log-formatter.utils';
import { requireMfa } from './require-mfa.middleware';

/**
 * Middleware to require admin role and log the access attempt.
 */
export const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const checkRole = requireRole('admin');

  checkRole(req, res, async () => {
    try {
      await requireMfa(req, res, async () => {
        const expressReq = req as unknown as Request;
        await AuditLoggerService.logEvent({
          level: LogLevel.INFO,
          action: AuditAction.ADMIN_ACTION,
          message: `Admin access to ${expressReq.method} ${expressReq.originalUrl}`,
          userId: req.user?.id,
          entityType: 'SYSTEM',
          ipAddress: expressReq.ip,
          userAgent: expressReq.get('user-agent'),
        });
        next();
      });
    } catch {
      res.status(403).json({
        success: false,
        error: 'Admin MFA required',
        mfaRequired: true,
      });
    }
  });
};
