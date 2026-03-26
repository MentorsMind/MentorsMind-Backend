import pool from '../config/database';
import { logger } from '../utils/logger';

export interface AuditLogRecord {
    id: string; // UUID
    level: string;
    action: string;
    message: string;
    user_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    metadata: Record<string, any>;
    ip_address: string | null;
    user_agent: string | null;
    created_at: Date;
}

/**
 * Audit Log Model for interacting directly with the PostgreSQL database.
 */
export const AuditLogModel = {
    /**
     * Initializes the audit_logs table if it doesn't exist.
     */
    async initializeTable(): Promise<void> {
        const query = `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        level VARCHAR(20) NOT NULL,
        action VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        user_id UUID,
        entity_type VARCHAR(100),
        entity_id VARCHAR(255),
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Create indexes for common filtering cases
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    `;
        await pool.query(query);
    },

    /**
     * Insert a new audit log record.
     */
    async create(log: Omit<AuditLogRecord, 'id' | 'created_at'>): Promise<AuditLogRecord | null> {
        const query = `
      INSERT INTO audit_logs (
        level, action, message, user_id, entity_type, entity_id, metadata, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

        // Ensure metadata is a proper JSON string before inserting
        const metadataJson = JSON.stringify(log.metadata || {});

        const values = [
            log.level,
            log.action,
            log.message,
            log.user_id,
            log.entity_type,
            log.entity_id,
            metadataJson,
            log.ip_address,
            log.user_agent,
        ];

        try {
            const { rows } = await pool.query<AuditLogRecord>(query, values);
            return rows[0] || null;
        } catch (error) {
            // In production, you might not want audit log failures to crash the app,
            // but you should probably log to standard terminal output as fallback.
            logger.error('Failed to insert audit log to DB:', error);
            return null;
        }
    }
};
