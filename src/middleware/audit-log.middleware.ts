import { Request, Response, NextFunction } from 'express';
import { AuditLoggerService } from '../services/audit-logger.service';
import { extractClientIp, AuditAction, LogLevel } from '../utils/log-formatter.utils';
import { logger } from '../utils/logger';

export interface AuditLogConfig {
    action: AuditAction | string;
    getLevel?: (req: Request, res: Response) => LogLevel;
    getMetadata?: (req: Request, res: Response) => Record<string, any>;
    getEntityDetails?: (req: Request, res: Response) => { type: string; id: string | null };
}

/**
 * Higher-order middleware function to log audit events automatically.
 * 
 * Example usage:
 * router.post('/login', auditLogMiddleware({ action: AuditAction.LOGIN_SUCCESS }), loginHandler);
 */
export const auditLogMiddleware = (config: AuditLogConfig) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // We hook into the finish event of the response to ensure we capture
        // the final status code and response context after the request completes.
        res.on('finish', () => {
            try {
                const level = config.getLevel
                    ? config.getLevel(req, res)
                    : (res.statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO);

                const metadata = config.getMetadata ? config.getMetadata(req, res) : {};
                const entityDetails = config.getEntityDetails ? config.getEntityDetails(req, res) : { type: 'route', id: req.originalUrl };

                // Extract typical user id pattern if available (usually placed on req.user by auth middleware)
                const userId = (req as any).user?.id
                    || (req as any).user?.sub
                    || metadata.userId
                    || null;

                AuditLoggerService.logEvent({
                    level,
                    action: config.action,
                    message: `Endpoint ${req.method} ${req.originalUrl} finished with status ${res.statusCode}`,
                    userId,
                    entityType: entityDetails.type,
                    entityId: entityDetails.id || undefined,
                    metadata: {
                        ...metadata,
                        method: req.method,
                        path: req.originalUrl,
                        params: req.params,
                        query: req.query,
                        statusCode: res.statusCode,
                    },
                    ipAddress: extractClientIp(req),
                    userAgent: req.headers['user-agent'],
                });
            } catch (error) {
                logger.error('Audit Log Middleware execution error', { error });
            }
        });

        next();
    };
};

/**
 * A generalized global middleware to track all data modification actions.
 * Highly recommended to be placed at the router level for POST/PUT/PATCH/DELETE methods.
 */
export const globalModificationAuditMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const isModificationMode = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

    // Skip GET/OPTIONS/HEAD/etc. as they are read-only
    if (!isModificationMode) {
        return next();
    }

    res.on('finish', () => {
        try {
            // If the request failed, we probably didn't modify data, or we want to log it as a WARN
            const level = res.statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO;

            let action = AuditAction.DATA_MODIFIED;
            if (req.method === 'POST') action = AuditAction.DATA_CREATED;
            if (req.method === 'DELETE') action = AuditAction.DATA_DELETED;

            const userId = (req as any).user?.id || null;

            AuditLoggerService.logEvent({
                level,
                action,
                message: `System data modified via ${req.method} on ${req.originalUrl}`,
                userId,
                entityType: 'auto-intercept',
                entityId: req.originalUrl,
                metadata: {
                    method: req.method,
                    path: req.originalUrl,
                    statusCode: res.statusCode,
                },
                ipAddress: extractClientIp(req),
                userAgent: req.headers['user-agent'],
            });
        } catch (error) {
            logger.error('Global modification audit failed', { error });
        }
    });

    next();
};
