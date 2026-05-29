import pool from '../config/database';
import { AuditLogModel, AuditLogRecord } from '../models/audit-log.model';
import {
  formatAuditLogJSON,
  StructuredLogPayload,
} from '../utils/log-formatter.utils';
import { logger } from '../utils/logger';

export interface AuditLogSearchParams {
  action?: string;
  userId?: string;
  level?: string;
  entityType?: string;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface PaginatedAuditLogs {
  data: AuditLogRecord[];
  total: number;
}

export const AuditLoggerService = {
  /**
   * Log an event securely to both the structured output (console) and the database.
   */
  async logEvent(
    payload: StructuredLogPayload,
  ): Promise<AuditLogRecord | null> {
    // 1. Output the structured JSON to the standard stream (e.g., for Datadog, ELK, stdout)
    const jsonOutput = formatAuditLogJSON(payload);
    // Map audit level to Winston log level
    if (payload.level === 'ERROR') {
      logger.error(jsonOutput, { audit: true });
    } else if (payload.level === 'WARN') {
      logger.warn(jsonOutput, { audit: true });
    } else {
      logger.info(jsonOutput, { audit: true });
    }

    // 2. Persist to Postgres Database
    return await AuditLogModel.create({
      level: payload.level,
      action: payload.action,
      message: payload.message,
      user_id: payload.userId || null,
      entity_type: payload.entityType || null,
      entity_id: payload.entityId || null,
      metadata: payload.metadata || {},
      ip_address: payload.ipAddress || null,
      user_agent: payload.userAgent || null,
    });
  },

  /**
   * Search and filter audit logs with pagination support.
   */
  async search(params: AuditLogSearchParams): Promise<PaginatedAuditLogs> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (params.action) {
      conditions.push(`action = $${idx++}`);
      values.push(params.action);
    }
    if (params.userId) {
      conditions.push(`user_id = $${idx++}`);
      values.push(params.userId);
    }
    if (params.level) {
      conditions.push(`level = $${idx++}`);
      values.push(params.level);
    }
    if (params.entityType) {
      conditions.push(`entity_type = $${idx++}`);
      values.push(params.entityType);
    }
    if (params.entityId) {
      conditions.push(`entity_id = $${idx++}`);
      values.push(params.entityId);
    }
    if (params.startDate) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(params.endDate);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count Query for pagination
    const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, [...values]);
    const total = parseInt(countResult.rows[0].count, 10);

    // Fetch Query
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const query = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `;

    values.push(limit, offset);
    const { rows } = await pool.query<AuditLogRecord>(query, values);

    return {
      data: rows,
      total,
    };
  },

  /**
   * Generate an audit report for a specific parameter criteria.
   * Could be used to generate CSV or JSON compliance reports.
   */
  async generateReport(
    params: AuditLogSearchParams,
  ): Promise<AuditLogRecord[]> {
    // In a real application, you might want to stream this if the dataset is large.
    // For now, we enforce an upper limit of 1000 records to prevent memory issues.
    const searchParams = { ...params, limit: 1000, offset: 0 };
    const result = await this.search(searchParams);
    return result.data;
  },

  /**
   * Apply retention policy: delete logs older than X days.
   */
  async cleanupOldLogs(retentionDays: number = 90): Promise<number> {
    const query = `
      DELETE FROM audit_logs
      WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
    `;
    const { rowCount } = await pool.query(query, [retentionDays]);
    return rowCount ?? 0;
  },
};
