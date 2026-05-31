import pool from "../config/database";
import { AuditLogService } from "./auditLog.service";
import { anonymizeIp } from "../utils/sanitization.utils";
import { logger } from "../utils/logger.utils";

export type DSARType = "access" | "deletion" | "portability" | "rectification";
export type DSARStatus = "pending" | "processing" | "completed";
export type DeletionMethod = "soft" | "hard" | "anonymize";

export interface DataSubjectRequest {
  id: string;
  user_id: string;
  type: DSARType;
  status: DSARStatus;
  requested_at: Date;
  completed_at?: Date;
  data?: any;
  metadata: Record<string, any>;
}

export interface ConsentRecord {
  userId: string;
  consentType: string;
  granted: boolean;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  version: string;
}

export interface DataRetentionPolicy {
  dataType: string;
  retentionPeriod: number; // days
  deletionMethod: DeletionMethod;
  legalBasis: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface DataLineageEvent {
  id: string;
  user_id: string;
  data_type: string;
  source_system: string;
  destination_system: string;
  description: string;
  metadata: Record<string, any>;
  event_timestamp: Date;
}

export interface ComplianceReportFilters {
  startDate?: string;
  endDate?: string;
  userId?: string;
}

export interface ComplianceReport {
  dsarRequests: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
  };
  retentionPolicies: DataRetentionPolicy[];
  lineageEvents: {
    total: number;
    recent: DataLineageEvent[];
  };
}

const VALID_DSAR_TYPES: DSARType[] = [
  "access",
  "deletion",
  "portability",
  "rectification",
];

const RETENTION_WHITELIST: Record<
  string,
  {
    tableName: string;
    dateColumn: string;
    anonymizeSql?: string;
    softDeleteSql?: string;
  }
> = {
  users: {
    tableName: "users",
    dateColumn: "created_at",
    anonymizeSql:
      "UPDATE users SET email = NULL, full_name = NULL, phone = NULL, updated_at = NOW() WHERE created_at < $1",
    softDeleteSql: "UPDATE users SET deleted_at = NOW() WHERE created_at < $1",
  },
  sessions: {
    tableName: "sessions",
    dateColumn: "created_at",
    anonymizeSql:
      "UPDATE sessions SET ip_address = NULL, user_agent = NULL WHERE created_at < $1",
    softDeleteSql:
      "UPDATE sessions SET revoked_at = NOW() WHERE created_at < $1",
  },
  consent_records: {
    tableName: "consent_records",
    dateColumn: "consent_timestamp",
    anonymizeSql:
      "UPDATE consent_records SET ip_address = NULL, user_agent = NULL WHERE consent_timestamp < $1",
    softDeleteSql:
      "UPDATE consent_records SET deleted_at = NOW() WHERE consent_timestamp < $1",
  },
  audit_logs: {
    tableName: "audit_logs",
    dateColumn: "created_at",
  },
};

export const ComplianceService = {
  async createDSAR(
    userId: string,
    type: DSARType,
    ipAddress: string,
    userAgent: string,
    metadata: Record<string, any> = {},
  ): Promise<DataSubjectRequest> {
    if (!VALID_DSAR_TYPES.includes(type)) {
      throw new Error(`Unsupported DSAR type: ${type}`);
    }

    const query = `
      INSERT INTO data_subject_requests (
        user_id,
        type,
        status,
        requested_at,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      RETURNING *
    `;

    const values = [
      userId,
      type,
      "pending",
      JSON.stringify(metadata),
      ipAddress,
      userAgent,
    ];
    const { rows } = await pool.query<DataSubjectRequest>(query, values);
    const record = rows[0];

    await AuditLogService.log({
      userId,
      action: "DSAR_REQUESTED",
      resourceType: "data_subject_request",
      resourceId: record.id,
      newValue: { type, status: "pending", metadata },
      ipAddress,
      userAgent,
    });

    return record;
  },

  async getDSARs(userId: string): Promise<DataSubjectRequest[]> {
    const query = `
      SELECT * FROM data_subject_requests
      WHERE user_id = $1
      ORDER BY requested_at DESC
    `;
    const { rows } = await pool.query<DataSubjectRequest>(query, [userId]);
    return rows;
  },

  async getDSARById(id: string): Promise<DataSubjectRequest | null> {
    const query = `SELECT * FROM data_subject_requests WHERE id = $1 LIMIT 1`;
    const { rows } = await pool.query<DataSubjectRequest>(query, [id]);
    return rows[0] || null;
  },

  async completeDSAR(
    requestId: string,
    data: any,
    completedBy: string | null,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<DataSubjectRequest> {
    const updateQuery = `
      UPDATE data_subject_requests
      SET status = 'completed', completed_at = NOW(), data = $2
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query<DataSubjectRequest>(updateQuery, [
      requestId,
      JSON.stringify(data),
    ]);
    const record = rows[0];
    if (!record) {
      throw new Error("Data subject request not found");
    }

    await AuditLogService.log({
      userId: completedBy,
      action: "DSAR_COMPLETED",
      resourceType: "data_subject_request",
      resourceId: requestId,
      oldValue: { status: "pending" },
      newValue: { status: "completed", completed_at: record.completed_at },
      ipAddress,
      userAgent,
    });

    return record;
  },

  async recordConsent(
    userId: string,
    consentType: string,
    granted: boolean,
    ipAddress: string,
    userAgent: string,
    version: string,
  ): Promise<ConsentRecord> {
    const query = `
      INSERT INTO consent_records (
        user_id,
        consent_type,
        granted,
        timestamp,
        ip_address,
        user_agent,
        version
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      RETURNING *
    `;

    const values = [
      userId,
      consentType,
      granted,
      ipAddress,
      userAgent,
      version,
    ];
    const { rows } = await pool.query<ConsentRecord>(query, values);
    const record = rows[0];

    await AuditLogService.log({
      userId,
      action: "CONSENT_RECORDED",
      resourceType: "consent_record",
      resourceId: record.id,
      newValue: { consentType, granted, version },
      ipAddress,
      userAgent,
    });

    return record;
  },

  async getLatestConsent(userId: string): Promise<ConsentRecord | null> {
    const query = `
      SELECT * FROM consent_records
      WHERE user_id = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const { rows } = await pool.query<ConsentRecord>(query, [userId]);
    return rows[0] || null;
  },

  async addRetentionPolicy(
    policy: DataRetentionPolicy,
  ): Promise<DataRetentionPolicy> {
    const query = `
      INSERT INTO retention_policies (
        data_type,
        retention_period,
        deletion_method,
        legal_basis,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (data_type)
      DO UPDATE SET
        retention_period = EXCLUDED.retention_period,
        deletion_method = EXCLUDED.deletion_method,
        legal_basis = EXCLUDED.legal_basis,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      policy.dataType,
      policy.retentionPeriod,
      policy.deletionMethod,
      policy.legalBasis,
    ];

    const { rows } = await pool.query<DataRetentionPolicy>(query, values);
    const record = rows[0];

    await AuditLogService.log({
      userId: null,
      action: "RETENTION_POLICY_UPDATED",
      resourceType: "retention_policy",
      resourceId: record.dataType,
      newValue: record,
      ipAddress: null,
      userAgent: null,
    });

    return record;
  },

  async getRetentionPolicies(): Promise<DataRetentionPolicy[]> {
    const query = `SELECT * FROM retention_policies ORDER BY data_type ASC`;
    const { rows } = await pool.query<DataRetentionPolicy>(query);
    return rows;
  },

  async recordLineageEvent(
    userId: string,
    dataType: string,
    sourceSystem: string,
    destinationSystem: string,
    description: string,
    metadata: Record<string, any> = {},
  ): Promise<DataLineageEvent> {
    const query = `
      INSERT INTO data_lineage_events (
        user_id,
        data_type,
        source_system,
        destination_system,
        description,
        metadata,
        event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;

    const values = [
      userId,
      dataType,
      sourceSystem,
      destinationSystem,
      description,
      JSON.stringify(metadata),
    ];
    const { rows } = await pool.query<DataLineageEvent>(query, values);
    return rows[0];
  },

  async getLineageEvents(
    userId?: string,
    page = 1,
    limit = 50,
  ): Promise<{
    events: DataLineageEvent[];
    total: number;
    page: number;
    limit: number;
  }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (userId) {
      conditions.push(`user_id = $${index++}`);
      values.push(userId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM data_lineage_events ${whereClause}`,
      values,
    );
    const total = parseInt(totalResult.rows[0]?.count || "0", 10);

    const offset = (page - 1) * limit;
    const query = `
      SELECT * FROM data_lineage_events
      ${whereClause}
      ORDER BY event_timestamp DESC
      LIMIT $${index++}
      OFFSET $${index}
    `;
    values.push(limit, offset);

    const { rows } = await pool.query<DataLineageEvent>(query, values);
    return { events: rows, total, page, limit };
  },

  async generateComplianceReport(
    filters: ComplianceReportFilters = {},
  ): Promise<ComplianceReport> {
    const dsarQuery = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) AS total
      FROM data_subject_requests
      WHERE ($1::timestamptz IS NULL OR requested_at >= $1)
        AND ($2::timestamptz IS NULL OR requested_at <= $2)
        AND ($3::uuid IS NULL OR user_id = $3)
    `;
    const dsarValues = [
      filters.startDate || null,
      filters.endDate || null,
      filters.userId || null,
    ];
    const dsarResult = await pool.query<{
      pending: string;
      processing: string;
      completed: string;
      total: string;
    }>(dsarQuery, dsarValues);
    const dsarCounts = dsarResult.rows[0];

    const lineageQuery = `
      SELECT COUNT(*) AS total
      FROM data_lineage_events
      WHERE ($1::timestamptz IS NULL OR event_timestamp >= $1)
        AND ($2::timestamptz IS NULL OR event_timestamp <= $2)
        AND ($3::uuid IS NULL OR user_id = $3)
    `;
    const lineageValues = [
      filters.startDate || null,
      filters.endDate || null,
      filters.userId || null,
    ];
    const lineageResult = await pool.query<{ total: string }>(
      lineageQuery,
      lineageValues,
    );
    const lineageTotal = parseInt(lineageResult.rows[0]?.total || "0", 10);

    const lineageEvents = await pool.query<DataLineageEvent>(
      `
      SELECT * FROM data_lineage_events
      WHERE ($1::timestamptz IS NULL OR event_timestamp >= $1)
        AND ($2::timestamptz IS NULL OR event_timestamp <= $2)
        AND ($3::uuid IS NULL OR user_id = $3)
      ORDER BY event_timestamp DESC
      LIMIT 50
    `,
      lineageValues,
    );

    const policies = await this.getRetentionPolicies();

    return {
      dsarRequests: {
        total: parseInt(dsarCounts.total, 10) || 0,
        pending: parseInt(dsarCounts.pending, 10) || 0,
        processing: parseInt(dsarCounts.processing, 10) || 0,
        completed: parseInt(dsarCounts.completed, 10) || 0,
      },
      retentionPolicies: policies,
      lineageEvents: {
        total: lineageTotal,
        recent: lineageEvents.rows,
      },
    };
  },

  async enforceRetentionPolicies(): Promise<{
    applied: number;
    skipped: number;
    details: Array<{
      dataType: string;
      action: string;
      affected: number;
      skippedReason?: string;
    }>;
  }> {
    const policies = await this.getRetentionPolicies();
    const details: Array<{
      dataType: string;
      action: string;
      affected: number;
      skippedReason?: string;
    }> = [];

    for (const policy of policies) {
      const mapping = RETENTION_WHITELIST[policy.dataType];
      if (!mapping) {
        details.push({
          dataType: policy.dataType,
          action: "skipped",
          affected: 0,
          skippedReason: "Unknown data type",
        });
        continue;
      }

      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - policy.retentionPeriod);
      const cutoffIso = cutoff.toISOString();
      let resultCount = 0;
      const action = policy.deletionMethod;

      try {
        if (policy.deletionMethod === "hard") {
          const { rowCount } = await pool.query(
            `DELETE FROM ${mapping.tableName} WHERE ${mapping.dateColumn} < $1`,
            [cutoffIso],
          );
          resultCount = rowCount ?? 0;
        } else if (policy.deletionMethod === "soft" && mapping.softDeleteSql) {
          const { rowCount } = await pool.query(mapping.softDeleteSql, [
            cutoffIso,
          ]);
          resultCount = rowCount ?? 0;
        } else if (
          policy.deletionMethod === "anonymize" &&
          mapping.anonymizeSql
        ) {
          const { rowCount } = await pool.query(mapping.anonymizeSql, [
            cutoffIso,
          ]);
          resultCount = rowCount ?? 0;
        } else {
          details.push({
            dataType: policy.dataType,
            action: "skipped",
            affected: 0,
            skippedReason: `Retention method not supported for ${policy.dataType}`,
          });
          continue;
        }

        details.push({
          dataType: policy.dataType,
          action,
          affected: resultCount,
        });
      } catch (error) {
        logger.error("Retention enforcement failed", {
          dataType: policy.dataType,
          error,
        });
        details.push({
          dataType: policy.dataType,
          action: "failed",
          affected: 0,
          skippedReason: (error as Error).message,
        });
      }
    }

    await AuditLogService.log({
      userId: null,
      action: "RETENTION_ENFORCEMENT_RUN",
      resourceType: "retention_policy",
      metadata: {
        summary: details,
      },
    });

    return {
      applied: details.filter(
        (item) => item.action !== "skipped" && item.action !== "failed",
      ).length,
      skipped: details.filter((item) => item.action === "skipped").length,
      details,
    };
  },

  getRequestIp(req: any): string {
    return anonymizeIp(
      (req.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "",
    );
  },
};
