import pool from "../config/database";
import { redis } from "../config/redis";
import { env } from "../config/env";
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
import { AuditLogService } from "./auditLog.service";
import { enqueueEmail } from "../queues/email.queue";
import { TokenService } from "./token.service";
import { MfaService } from "./mfa.service";

const ADMIN_STEPUP_PREFIX = "admin_stepup:";
const ADMIN_STEPUP_LIMIT = 5;
const ADMIN_STEPUP_TTL_SECONDS = 5 * 60;
const memoryStepUpStore = new Map<string, { count: number; lockedUntil?: number }>();

export interface AdminStats {
  users: {
    total: number;
    active: number;
    mentors: number;
    mentees: number;
  };
  transactions: {
    total: number;
    volume: string;
    fees: string;
  };
  bookings: {
    total: number;
    completed: number;
    cancelled: number;
  };
  disputes: {
    total: number;
    open: number;
  };
}

export const AdminService = {
  async requireAdminMfa(userId: string, role?: string): Promise<{ allowed: boolean; mfaEnabled: boolean; error?: string }> {
    if (role && role !== "admin") {
      return { allowed: true, mfaEnabled: true };
    }

    const { rows } = await pool.query<{ mfa_enabled: boolean }>(
      `SELECT mfa_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    const mfaEnabled = Boolean(rows[0]?.mfa_enabled);
    if (!mfaEnabled) {
      return {
        allowed: false,
        mfaEnabled: false,
        error: "Admin MFA required",
      };
    }

    return { allowed: true, mfaEnabled: true };
  },

  async verifyStepUpCode(
    userId: string,
    code: string,
    ipAddress?: string,
  ): Promise<{ valid: boolean; locked: boolean; attemptsRemaining?: number; error?: string }> {
    const key = `${ADMIN_STEPUP_PREFIX}${userId}`;
    const attempts = await this.getStepUpAttempts(key);

    if (attempts >= ADMIN_STEPUP_LIMIT) {
      return {
        valid: false,
        locked: true,
        attemptsRemaining: 0,
        error: "Step-up MFA temporarily locked. Please try again later.",
      };
    }

    const { rows } = await pool.query<{ mfa_enabled: boolean; mfa_secret: string | null }>(
      `SELECT mfa_enabled, mfa_secret FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    if (!rows[0]?.mfa_enabled) {
      return {
        valid: false,
        locked: false,
        attemptsRemaining: Math.max(0, ADMIN_STEPUP_LIMIT - attempts - 1),
        error: "Admin MFA is not enabled",
      };
    }

    let valid = false;
    if (rows[0].mfa_secret) {
      try {
        const secret = await MfaService.decryptSecret(rows[0].mfa_secret);
        valid = await MfaService.verifyTotpToken(code, secret);
      } catch {
        valid = false;
      }
    }

    if (!valid) {
      const backupCodeValid = await MfaService.verifyAndConsumeBackupCode(userId, code);
      valid = backupCodeValid.valid;
    }

    if (valid) {
      await this.clearStepUpAttempts(key);
      return { valid: true, locked: false, attemptsRemaining: ADMIN_STEPUP_LIMIT };
    }

    const nextCount = await this.incrementStepUpAttempts(key);
    const remaining = Math.max(0, ADMIN_STEPUP_LIMIT - nextCount);
    const locked = nextCount >= ADMIN_STEPUP_LIMIT;
    return {
      valid: false,
      locked,
      attemptsRemaining: remaining,
      error: locked
        ? "Step-up MFA temporarily locked. Please try again later."
        : `Invalid step-up MFA code. ${remaining} attempts remaining.`,
    };
  },

  async incrementStepUpAttempts(key: string): Promise<number> {
    if (redis.status === "ready") {
      const current = Number((await redis.get(key)) || "0");
      const next = current + 1;
      await redis.set(key, String(next), "EX", ADMIN_STEPUP_TTL_SECONDS);
      return next;
    }

    const existing = memoryStepUpStore.get(key) ?? { count: 0 };
    const next = existing.count + 1;
    memoryStepUpStore.set(key, { count: next, lockedUntil: Date.now() + ADMIN_STEPUP_TTL_SECONDS * 1000 });
    return next;
  },

  async getStepUpAttempts(key: string): Promise<number> {
    if (redis.status === "ready") {
      const value = await redis.get(key);
      return Number(value || "0");
    }

    const existing = memoryStepUpStore.get(key);
    if (!existing) return 0;
    if (existing.lockedUntil && existing.lockedUntil <= Date.now()) {
      memoryStepUpStore.delete(key);
      return 0;
    }
    return existing.count;
  },

  async clearStepUpAttempts(key: string): Promise<void> {
    if (redis.status === "ready") {
      await redis.del(key);
      return;
    }

    memoryStepUpStore.delete(key);
  },

  async getStats(): Promise<AdminStats> {
    const [
      userStats,
      txStats,
      bookingStats,
      disputeStats,
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_active = true) as active,
          COUNT(*) FILTER (WHERE role = 'mentor') as mentors,
          COUNT(*) FILTER (WHERE role = 'mentee') as mentees
        FROM users WHERE deleted_at IS NULL
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(amount), 0) as volume,
          COALESCE(SUM(platform_fee), 0) as fees
        FROM transactions WHERE status = 'completed'
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
        FROM bookings
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'open' OR status = 'under_review') as open
        FROM disputes
      `),
    ]);

    return {
      users: {
        total: parseInt(userStats.rows[0].total, 10),
        active: parseInt(userStats.rows[0].active, 10),
        mentors: parseInt(userStats.rows[0].mentors, 10),
        mentees: parseInt(userStats.rows[0].mentees, 10),
      },
      transactions: {
        total: parseInt(txStats.rows[0].total, 10),
        volume: txStats.rows[0].volume.toString(),
        fees: txStats.rows[0].fees.toString(),
      },
      bookings: {
        total: parseInt(bookingStats.rows[0].total, 10),
        completed: parseInt(bookingStats.rows[0].completed, 10),
        cancelled: parseInt(bookingStats.rows[0].cancelled, 10),
      },
      disputes: {
        total: parseInt(disputeStats.rows[0].total, 10),
        open: parseInt(disputeStats.rows[0].open, 10),
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

  async updateUserStatus(id: string, isActive: boolean): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [isActive, id],
    );
    return rows[0] || null;
  },

  async updateUserTier(id: string, tier: string): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `UPDATE users SET user_tier = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [tier, id],
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
    const baseWhere = "type IN ('payment', 'mentor_payout')";
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (startDate) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(endDate);
    }

    const where = conditions.length
      ? `${baseWhere} AND ${conditions.join(" AND ")}`
      : baseWhere;

    // Count query uses the same filters (without limit / offset)
    const countQuery = `SELECT COUNT(*) FROM transactions WHERE ${where}`;
    const countParams = [...params];

    // Data query adds ordering, limit and offset
    const limitPlaceholder = `$${idx++}`;
    const offsetPlaceholder = `$${idx++}`;
    const dataQuery = `SELECT * FROM transactions WHERE ${where} ORDER BY created_at DESC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
    const dataParams = [...params, limit, offset];

    const [{ rows }, countResult] = await Promise.all([
      pool.query<TransactionRecord>(dataQuery, dataParams),
      pool.query(countQuery, countParams),
    ]);

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
      await stellarService.getAccount(env.PLATFORM_PUBLIC_KEY || "");
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

  async suspendUser(
    id: string,
    adminId: string,
    reason: string,
    expiresAt: Date | null,
    ipAddress?: string,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `UPDATE users 
       SET status = 'suspended',
           suspension_reason = $1,
           suspended_at = NOW(),
           suspended_by = $2,
           suspension_expires_at = $3,
           is_active = false,
           updated_at = NOW() 
       WHERE id = $4 AND deleted_at IS NULL RETURNING *`,
      [reason, adminId, expiresAt, id],
    );
    if (rows[0]) {
      await AuditLogService.log({
        userId: adminId,
        action: 'USER_SUSPENDED',
        resourceType: 'user',
        resourceId: id,
        newValue: { reason, expiresAt },
        ipAddress,
        userAgent,
      });
      await TokenService.revokeAllUserSessions(id);
    }
    return rows[0] || null;
  },

  async banUser(
    id: string,
    adminId: string,
    reason: string,
    ipAddress?: string,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `UPDATE users 
       SET status = 'banned',
           ban_reason = $1,
           banned_at = NOW(),
           banned_by = $2,
           is_active = false,
           updated_at = NOW() 
       WHERE id = $3 AND deleted_at IS NULL RETURNING *`,
      [reason, adminId, id],
    );
    if (rows[0]) {
      await AuditLogService.log({
        userId: adminId,
        action: 'USER_BANNED',
        resourceType: 'user',
        resourceId: id,
        newValue: { reason },
        ipAddress,
        userAgent,
      });
      await TokenService.revokeAllUserSessions(id);
    }
    return rows[0] || null;
  },

  async unsuspendUser(
    id: string,
    adminId: string,
    ipAddress?: string,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    const { rows } = await pool.query<UserRecord>(
      `UPDATE users 
       SET status = 'active',
           suspension_reason = NULL,
           suspended_at = NULL,
           suspended_by = NULL,
           suspension_expires_at = NULL,
           is_active = true,
           updated_at = NOW() 
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id],
    );
    if (rows[0]) {
      await AuditLogService.log({
        userId: adminId,
        action: 'USER_UNSUSPENDED',
        resourceType: 'user',
        resourceId: id,
        ipAddress,
        userAgent,
      });
    }
    return rows[0] || null;
  },
};
