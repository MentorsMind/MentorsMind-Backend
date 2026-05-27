import { Request } from 'express';

export enum LogLevel {
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    DEBUG = 'DEBUG',
}

export enum AuditAction {
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',
    LOGIN_FAILED = 'LOGIN_FAILED',
    LOGOUT = 'LOGOUT',
    PAYMENT_PROCESSED = 'PAYMENT_PROCESSED',
    PAYMENT_FAILED = 'PAYMENT_FAILED',
    REFUND_ISSUED = 'REFUND_ISSUED',
    DATA_MODIFIED = 'DATA_MODIFIED',
    DATA_CREATED = 'DATA_CREATED',
    DATA_DELETED = 'DATA_DELETED',
    ADMIN_ACTION = 'ADMIN_ACTION',
    SECURITY_EVENT = 'SECURITY_EVENT',
    DEEP_LINK_ACCESSED = 'DEEP_LINK_ACCESSED',
}

export interface StructuredLogPayload {
    level: LogLevel;
    action: AuditAction | string;
    message: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}

/**
 * Format an audit log payload into a structured JSON string.
 */
export const formatAuditLogJSON = (payload: StructuredLogPayload): string => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level: payload.level,
        action: payload.action,
        message: payload.message,
        user_id: payload.userId || null,
        entity_type: payload.entityType || null,
        entity_id: payload.entityId || null,
        metadata: payload.metadata || {},
        ip_address: payload.ipAddress || null,
        user_agent: payload.userAgent || null,
    };

    return JSON.stringify(logEntry);
};

/**
 * Extract client IP from an Express request object accurately.
 */
export const extractClientIp = (req: Request): string => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
};
