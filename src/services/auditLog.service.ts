/**
 * Audit Log Service
 * Provides tamper-evident logging for all sensitive actions
 */

import pool from "../config/database";
import { Request } from "express";
import { anonymizeIp } from "../utils/sanitization.utils";

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  record_hash: string | null;
  previous_hash: string | null;
}

export interface LogAuditParams {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedAuditLogs {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Extract client IP from request
 */
export const extractIpAddress = (req: Request): string => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const raw =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || req.socket.remoteAddress || "unknown";
  return anonymizeIp(raw);
};

export const AuditLogService = {
  /**
   * Log a sensitive action to the audit log
   * This is the primary method for recording audit events
   */
  async log(params: LogAuditParams): Promise<AuditLogEntry> {
    const query = `
      INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id,
        old_value, new_value, ip_address, user_agent, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      params.userId || null,
      params.action,
      params.resourceType,
      params.resourceId || null,
      params.oldValue ? JSON.stringify(params.oldValue) : null,
      params.newValue ? JSON.stringify(params.newValue) : null,
      params.ipAddress || null,
      params.userAgent || null,
      JSON.stringify(params.metadata || {}),
    ];

    const { rows } = await pool.query<AuditLogEntry>(query, values);
    return rows[0];
  },

  /**
   * Convenience method to log from Express request context
   */
  async logFromRequest(
    req: Request,
    action: string,
    resourceType: string,
    resourceId?: string | null,
    changes?: {
      oldValue?: Record<string, any>;
      newValue?: Record<string, any>;
    },
    metadata?: Record<string, any>,
  ): Promise<AuditLogEntry> {
    const userId = (req as any).user?.id || null;
    const ipAddress = extractIpAddress(req);
    const userAgent = req.headers["user-agent"] || null;

    return this.log({
      userId,
      action,
      resourceType,
      resourceId,
      oldValue: changes?.oldValue,
      newValue: changes?.newValue,
      ipAddress,
      userAgent,
      metadata,
    });
  },

  /**
   * Query audit logs with filtering and pagination
   */
  async query(filters: AuditLogFilters): Promise<PaginatedAuditLogs> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filters.userId);
    }

    if (filters.action) {
      conditions.push(`action = $${paramIndex++}`);
      values.push(filters.action);
    }

    if (filters.resourceType) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filters.resourceType);
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filters.endDate);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated results
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    const dataQuery = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    values.push(limit, offset);

    const { rows } = await pool.query<AuditLogEntry>(dataQuery, values);

    return {
      logs: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Export audit logs as CSV for compliance reporting
   */
  async exportToCSV(filters: AuditLogFilters): Promise<string> {
    const result = await this.query({ ...filters, limit: 10000, page: 1 });

    // CSV header
    const headers = [
      "ID",
      "User ID",
      "Action",
      "Resource Type",
      "Resource ID",
      "Old Value",
      "New Value",
      "IP Address",
      "User Agent",
      "Metadata",
      "Created At",
      "Record Hash",
    ];

    const csvRows = [headers.join(",")];

    // CSV data rows
    for (const log of result.logs) {
      const row = [
        log.id,
        log.user_id || "",
        log.action,
        log.resource_type,
        log.resource_id || "",
        log.old_value ? JSON.stringify(log.old_value).replace(/"/g, '""') : "",
        log.new_value ? JSON.stringify(log.new_value).replace(/"/g, '""') : "",
        log.ip_address || "",
        log.user_agent ? log.user_agent.replace(/"/g, '""') : "",
        JSON.stringify(log.metadata).replace(/"/g, '""'),
        log.created_at.toISOString(),
        log.record_hash || "",
      ];

      // Wrap fields in quotes and escape internal quotes
      csvRows.push(row.map((field) => `"${field}"`).join(","));
    }

    return csvRows.join("\n");
  },

  /**
   * Verify audit log chain integrity
   */
  async verifyChainIntegrity(
    limit = 1000,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const query = `
      SELECT id, user_id, action, resource_type, resource_id,
             old_value, new_value, created_at, previous_hash, record_hash
      FROM audit_logs
      ORDER BY created_at ASC, id ASC
      LIMIT $1
    `;

    const { rows } = await pool.query<AuditLogEntry>(query, [limit]);
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const current = rows[i];

      if (i > 0) {
        const previous = rows[i - 1];
        if (current.previous_hash !== previous.record_hash) {
          errors.push(
            `Chain break at record ${current.id}: previous_hash mismatch`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Get audit log statistics
   */
  async getStats(startDate?: string, endDate?: string): Promise<any> {
    let whereClause = "";
    const values: any[] = [];

    if (startDate || endDate) {
      const conditions: string[] = [];
      if (startDate) {
        conditions.push(`created_at >= $${values.length + 1}`);
        values.push(startDate);
      }
      if (endDate) {
        conditions.push(`created_at <= $${values.length + 1}`);
        values.push(endDate);
      }
      whereClause = `WHERE ${conditions.join(" AND ")}`;
    }

    const query = `
      SELECT 
        COUNT(*) as total_logs,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT action) as unique_actions,
        COUNT(*) FILTER (WHERE action LIKE '%LOGIN%') as auth_events,
        COUNT(*) FILTER (WHERE action LIKE '%PAYMENT%' OR action LIKE '%ESCROW%') as payment_events,
        COUNT(*) FILTER (WHERE action LIKE '%ADMIN%') as admin_events,
        MIN(created_at) as oldest_log,
        MAX(created_at) as newest_log
      FROM audit_logs
      ${whereClause}
    `;

    const { rows } = await pool.query(query, values);
    return rows[0];
  },
};
