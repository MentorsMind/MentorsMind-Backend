import { Response, NextFunction, Request } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { requireRole } from './rbac.middleware';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from '../utils/log-formatter.utils';

/**
 * Middleware to require admin role and log the access attempt.
 */
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  // First reuse the RBAC middleware logic
  const checkRole = requireRole('admin');
  
  // Wrap it to add audit logging
  checkRole(req, res, async () => {
    // If we reach here, the user is an admin
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
};
