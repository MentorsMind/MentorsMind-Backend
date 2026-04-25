// @ts-nocheck
import pool from "../config/database";
import {
  AuditLoggerService,
  AuditLogSearchParams,
  PaginatedAuditLogs,
} from "./audit-logger.service";
import { UserRecord } from "./users.service";
import {
  TransactionModel,
  TransactionRecord,
} from "../models/transaction.model";
import { DisputeModel, DisputeRecord } from "../models/dispute.model";
import { SystemConfigModel } from "../models/system-config.model";
import { stellarService } from "./stellar.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";

export interface AdminStats {
  users: {
    total: number;
    active: number;
  };
  transactions: {
    total: number;
    volume: string;
  };
  disputes: {
    open: number;
  };
}

export const AdminService = {
  /**
   * Initialize all admin-related tables.
   */
  async initialize(): Promise<void> {
    await Promise.all([
      TransactionModel.initializeTable(),
      DisputeModel.initializeTable(),
      SystemConfigModel.initializeTable(),
    ]);
  },

  async getStats(): Promise<AdminStats> {
    const [userCountResult, activeUserCountResult, txStats, openDisputes] =
      await Promise.all([
        pool.query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"),
        pool.query(
          "SELECT COUNT(*) FROM users WHERE is_active = true AND deleted_at IS NULL",
        ),
        TransactionModel.getStats(),
        DisputeModel.countActive(),
      ]);

    return {
      users: {
        total: parseInt(userCountResult.rows[0].count, 10),
        active: parseInt(activeUserCountResult.rows[0].count, 10),
      },
      transactions: {
        total: txStats.count,
        volume: txStats.total_volume,
      },
      disputes: {
        open: openDisputes,
      },
    };
  },

  async listUsers(
    limit = 50,
    offset = 0,
    role?: string,
  ): Promise<{ data: UserRecord[]; total: number }> {
    let query = `SELECT id, email, first_name, last_name, role, is_active, is_verified,
                 average_rating, total_sessions_completed, created_at, updated_at
                 FROM users WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (role) {
      query += " AND role = $1";
      params.push(role);
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query<UserRecord>(query, params);
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL" +
        (role ? " AND role = $1" : ""),
      role ? [role] : [],
    );

    return {
      data: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async updateUserStatus(
    id: string,
    isActive: boolean,
  ): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      "UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [isActive, id],
    );
    return rows[0] || null;
  },

  async listTransactions(
    limit = 50,
    offset = 0,
  ): Promise<{ data: TransactionRecord[]; total: number }> {
    const [data, total] = await Promise.all([
      TransactionModel.findAll(limit, offset),
      TransactionModel.count(),
    ]);
    return { data, total };
  },

  async listSessions(
    limit = 50,
    offset = 0,
    status?: string,
  ): Promise<{ data: any[]; total: number }> {
    let query = "SELECT * FROM bookings";
    const params: any[] = [];
    if (status) {
      query += " WHERE status = $1";
      params.push(status);
    }
    query += ` ORDER BY scheduled_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM bookings" + (status ? " WHERE status = $1" : ""),
      status ? [status] : [],
    );

    return {
      data: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async listPayments(
    limit = 50,
    offset = 0,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: TransactionRecord[]; total: number }> {
    let query =
      "SELECT * FROM transactions WHERE type IN ('payment', 'mentor_payout')";
    const params: any[] = [];

    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query<TransactionRecord>(query, params);

    let countQuery =
      "SELECT COUNT(*) FROM transactions WHERE type IN ('payment', 'mentor_payout')";
    const countParams: any[] = [];
    if (startDate) {
      countQuery += ` AND created_at >= $${countParams.length + 1}`;
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ` AND created_at <= $${countParams.length + 1}`;
      countParams.push(endDate);
    }

    const countResult = await pool.query(countQuery, countParams);

    return {
      data: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async listDisputes(
    limit = 50,
    offset = 0,
  ): Promise<{ data: DisputeRecord[]; total: number }> {
    const [data, total] = await Promise.all([
      DisputeModel.findAll(limit, offset),
      pool
        .query("SELECT COUNT(*) FROM disputes")
        .then((r) => parseInt(r.rows[0].count, 10)),
    ]);
    return { data, total };
  },

  async resolveDispute(
    id: string,
    status: "resolved" | "dismissed",
    notes: string,
  ): Promise<DisputeRecord | null> {
    return DisputeModel.updateStatus(id, status, notes);
  },

  async getSystemHealth(): Promise<any> {
    const dbCheck = await pool
      .query("SELECT 1")
      .then(() => "UP")
      .catch(() => "DOWN");
    let stellarCheck = "UP";
    try {
      await stellarService.getAccount(process.env.PLATFORM_PUBLIC_KEY || "");
    } catch {
      stellarCheck = "DEGRADED";
    }

    return {
      status:
        dbCheck === "UP" && stellarCheck !== "DOWN" ? "HEALTHY" : "UNHEALTHY",
      components: {
        database: dbCheck,
        stellar: stellarCheck,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    };
  },

  async getLogs(params: AuditLogSearchParams): Promise<PaginatedAuditLogs> {
    return AuditLoggerService.search(params);
  },

  async updateConfig(key: string, value: any): Promise<void> {
    await SystemConfigModel.setValue(key, value);
    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `System configuration updated for key: ${key}`,
      entityType: "CONFIG",
      entityId: key,
    });
  },
};
