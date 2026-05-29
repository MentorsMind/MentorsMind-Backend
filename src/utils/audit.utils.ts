import { logger } from './logger';

// Audit action types
export const AUDIT_ACTIONS = {
    // Authentication
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    PASSWORD_RESET: 'PASSWORD_RESET',
    MFA_ENABLE: 'MFA_ENABLE',
    MFA_DISABLE: 'MFA_DISABLE',

    // User Management
    PROFILE_UPDATE: 'PROFILE_UPDATE',
    ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
    ACCOUNT_UNSUSPENDED: 'ACCOUNT_UNSUSPENDED',
    ACCOUNT_DELETED: 'ACCOUNT_DELETED',

    // Payments
    PAYMENT_INITIATED: 'PAYMENT_INITIATED',
    PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',

    // Escrow
    ESCROW_CREATED: 'ESCROW_CREATED',
    ESCROW_RELEASED: 'ESCROW_RELEASED',
    ESCROW_REFUNDED: 'ESCROW_REFUNDED',

    // Disputes
    DISPUTE_OPENED: 'DISPUTE_OPENED',
    DISPUTE_RESOLVED: 'DISPUTE_RESOLVED',
    DISPUTE_CLOSED: 'DISPUTE_CLOSED',

    // Admin Actions
    ADMIN_USER_UPDATE: 'ADMIN_USER_UPDATE',
    ADMIN_CONFIG_UPDATE: 'ADMIN_CONFIG_UPDATE',
    ADMIN_ACTION: 'ADMIN_ACTION',

    // OAuth
    OAUTH_LINK: 'OAUTH_LINK',
    OAUTH_UNLINK: 'OAUTH_UNLINK',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

export interface AuditContext {
    userId?: string | null;
    action: AuditAction;
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, any>;
}

/**
 * Log an audit event asynchronously via BullMQ
 * This ensures audit logging never blocks the request handler
 */
export async function logAuditEvent(context: AuditContext): Promise<void> {
    try {
        // Import queue dynamically to avoid circular dependencies
        const { enqueueAuditLog } = await import('../jobs/auditLog.job');

        // Enqueue the audit log job (non-blocking)
        await enqueueAuditLog({
            userId: context.userId || null,
            action: context.action,
            resourceType: context.resourceType || null,
            resourceId: context.resourceId || null,
            ipAddress: context.ipAddress || null,
            userAgent: context.userAgent || null,
            metadata: context.metadata || {},
        });

        logger.debug('Audit event enqueued', { action: context.action, userId: context.userId });
    } catch (error) {
        // Log error but don't throw - audit logging should never break the main flow
        logger.error('Failed to enqueue audit event', { error, action: context.action });
    }
}

/**
 * Synchronous audit logging (for critical events that must be logged immediately)
 * Use sparingly - prefer async logging via logAuditEvent
 */
export async function logAuditEventSync(context: AuditContext): Promise<void> {
    try {
        const pool = await import('../config/database');

        const query = `
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

        await pool.default.query(query, [
            context.userId || null,
            context.action,
            context.resourceType || null,
            context.resourceId || null,
            context.ipAddress || null,
            context.userAgent || null,
            JSON.stringify(context.metadata || {}),
        ]);

        logger.debug('Audit event logged synchronously', { action: context.action, userId: context.userId });
    } catch (error) {
        // Log error but don't throw - audit logging should never break the main flow
        logger.error('Failed to log audit event synchronously', { error, action: context.action });
    }
}

export default {
    logAuditEvent,
    logAuditEventSync,
    AUDIT_ACTIONS,
};
