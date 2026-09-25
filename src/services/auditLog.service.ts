/**
 * Audit Log Service
 * Provides tamper-evident logging with HMAC-SHA256 hash chaining.
 *
 * Each audit log entry includes:
 *   - record_hash: HMAC-SHA256 of the record's key fields + previous entry's hash
 *   - previous_hash: hash of the chronologically preceding entry
 *
 * This creates a linked chain that detects tampering: any modification to a
 * historical entry breaks the chain and is detected by verifyChainIntegrity().
 *
 * SOC 2 Type II compliance requirement.
 */

import crypto from "crypto";
import pool from "../config/database";
import { Request } from "express";
import { anonymizeIp } from "../utils/sanitization.utils";
import { logger } from "../utils/logger.utils";
import { TenantContext } from "../utils/tenant-context.utils";

// ── Hash configuration ──────────────────────────────────────────────────────

/**
 * HMAC secret loaded from environment variable.
 * In production, set AUDIT_HMAC_SECRET to a strong random value (>= 32 bytes).
 * Example: openssl rand -hex 32
 */
function getHmacSecret(): string {
  const secret = process.env.AUDIT_HMAC_SECRET;
  if (!secret || secret.length < 16) {
    logger.warn(
      "AUDIT_HMAC_SECRET is not set or too short — using insecure default. " +
        "Set a strong AUDIT_HMAC_SECRET in production for SOC 2 compliance.",
    );
    return "insecure-default-audit-hmac-secret-change-me";
  }
  return secret;
}

/**
 * Compute HMAC-SHA256 of the audit entry's canonical form.
 * The canonical form is a pipe-delimited string of all significant fields.
 */
function computeRecordHmac(fields: {
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  oldValue: Record<string, any> | null;
  newValue: Record<string, any> | null;
  ipAddress: string | null;
  createdAt: string;
  previousHash: string | null;
}): string {
  const canonical = [
    fields.userId ?? "",
    fields.action,
    fields.resourceType,
    fields.resourceId ?? "",
    fields.oldValue ? JSON.stringify(fields.oldValue) : "",
    fields.newValue ? JSON.stringify(fields.newValue) : "",
    fields.ipAddress ?? "",
    fields.createdAt,
    fields.previousHash ?? "",
  ].join("|");

  return crypto
    .createHmac("sha256", getHmacSecret())
    .update(canonical, "utf8")
    .digest("hex");
}

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
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
  hash_algorithm: string | null;
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
  /**
   * Owning tenant for this entry. Optional — when omitted, falls back to the
   * current TenantContext (AsyncLocalStorage). Pass it explicitly for
   * cross-context calls; leave unset for system jobs with no tenant.
   */
  tenantId?: string | null;
}

export interface AuditLogFilters {
  userId?: string;
  tenantId?: string;
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

export interface ChainIntegrityResult {
  valid: boolean;
  errors: string[];
  checkedCount: number;
  verifiedAt: string;
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

// ── Service ──────────────────────────────────────────────────────────────────

export const AuditLogService = {
  /**
   * Log a sensitive action to the audit log with HMAC-SHA256 hash chaining.
   *
   * The method:
   *   1. Fetches the hash of the most recent audit log entry (the "head" of the chain)
   *   2. Computes an HMAC over the new entry's fields + the previous hash
   *   3. Inserts the entry with both previous_hash and record_hash populated
   *
   * This is the primary method for recording audit events.
   */
  async log(params: LogAuditParams): Promise<AuditLogEntry> {
    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();

    // Resolve the tenant: explicit param wins, otherwise fall back to the
    // AsyncLocalStorage tenant context. Null for system/background jobs.
    // Note: tenant_id is intentionally NOT part of the HMAC canonical form —
    // adding it would invalidate the hash chain of pre-existing entries.
    const tenantId = params.tenantId ?? TenantContext.getTenantId() ?? null;

    // Step 1: Fetch the most recent record's hash to link the chain.
    // We use a transaction to ensure no concurrent insert races between
    // fetching the previous hash and inserting the new record.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the table briefly to prevent race conditions on hash chain
      const prevResult = await client.query<{ record_hash: string | null }>(
        `SELECT record_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const previousHash = prevResult.rows[0]?.record_hash ?? null;

      // Step 2: Compute HMAC for this entry
      const recordHash = computeRecordHmac({
        userId: params.userId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
        ipAddress: params.ipAddress ?? null,
        createdAt: createdAtIso,
        previousHash,
      });

      // Step 3: Insert the entry with hashes
      const query = `
        INSERT INTO audit_logs (
          user_id, action, resource_type, resource_id,
          old_value, new_value, ip_address, user_agent, metadata,
          created_at, previous_hash, record_hash, hash_algorithm,
          tenant_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        createdAt,
        previousHash,
        recordHash,
        "hmac-sha256",
        tenantId,
      ];

      const { rows } = await client.query<AuditLogEntry>(query, values);
      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Convenience method to log from an Express request context.
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
    const tenantId = (req as any).tenant?.id;

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
      tenantId,
    });
  },

  /**
   * Query audit logs with filtering and pagination.
   */
  async query(filters: AuditLogFilters): Promise<PaginatedAuditLogs> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(filters.userId);
    }

    if (filters.tenantId) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      values.push(filters.tenantId);
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

    const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 200);
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
   * Export audit logs as CSV for compliance reporting.
   */
  async exportToCSV(filters: AuditLogFilters): Promise<string> {
    const result = await this.query({ ...filters, limit: 10000, page: 1 });

    const headers = [
      "ID",
      "User ID",
      "Tenant ID",
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
      "Previous Hash",
      "Hash Algorithm",
    ];

    const csvRows = [headers.join(",")];

    for (const log of result.logs) {
      const row = [
        log.id,
        log.user_id || "",
        log.tenant_id || "",
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
        log.previous_hash || "",
        log.hash_algorithm || "",
      ];
      csvRows.push(row.map((field) => `"${field}"`).join(","));
    }

    return csvRows.join("\n");
  },

  /**
   * Verify the integrity of the audit log hash chain.
   *
   * Checks:
   *   1. Each record's previous_hash matches the preceding record's record_hash
   *   2. Each record's record_hash matches the recomputed HMAC over its fields
   *
   * Returns a list of any broken links (tampering evidence).
   */
  async verifyChainIntegrity(limit = 1000): Promise<ChainIntegrityResult> {
    const query = `
      SELECT id, user_id, action, resource_type, resource_id,
             old_value, new_value, ip_address, created_at,
             previous_hash, record_hash, hash_algorithm
      FROM audit_logs
      ORDER BY created_at ASC, id ASC
      LIMIT $1
    `;

    const { rows } = await pool.query<AuditLogEntry>(query, [limit]);
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const current = rows[i];

      // Check 1: Chain link — previous_hash must match predecessor's record_hash
      if (i > 0) {
        const previous = rows[i - 1];
        if (current.previous_hash !== previous.record_hash) {
          errors.push(
            `Chain break at record ${current.id}: ` +
              `expected previous_hash=${previous.record_hash ?? "null"}, ` +
              `got ${current.previous_hash ?? "null"}`,
          );
        }
      }

      // Check 2: HMAC integrity — recompute the hash and compare
      if (current.record_hash && current.hash_algorithm === "hmac-sha256") {
        const recomputed = computeRecordHmac({
          userId: current.user_id,
          action: current.action,
          resourceType: current.resource_type,
          resourceId: current.resource_id,
          oldValue: current.old_value,
          newValue: current.new_value,
          ipAddress: current.ip_address,
          createdAt: new Date(current.created_at).toISOString(),
          previousHash: current.previous_hash,
        });

        if (recomputed !== current.record_hash) {
          errors.push(
            `HMAC mismatch at record ${current.id}: record content may have been tampered with`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      checkedCount: rows.length,
      verifiedAt: new Date().toISOString(),
    };
  },

  /**
   * Get audit log statistics for dashboard/reporting.
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
        COUNT(*) FILTER (WHERE record_hash IS NOT NULL) as hashed_entries,
        COUNT(*) FILTER (WHERE record_hash IS NULL) as unhashed_entries,
        MIN(created_at) as oldest_log,
        MAX(created_at) as newest_log
      FROM audit_logs
      ${whereClause}
    `;

    const { rows } = await pool.query(query, values);
    return rows[0];
  },
};
