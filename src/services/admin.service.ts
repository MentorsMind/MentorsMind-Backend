import pool from "../config/database";
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

  /**
   * Restore a suspended user back to active status.
   * Clears suspension fields and re-enables login.
   */
  async unsuspendUser(
    targetUserId: string,
    adminId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    const { rows: before } = await pool.query<any>(
      `SELECT id, status, is_active FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [targetUserId],
    );
    if (before.length === 0) return null;
    const oldUser = before[0];

    const { rows } = await pool.query<any>(
      `UPDATE users
          SET status               = 'active',
              is_active            = true,
              suspension_reason    = NULL,
              suspended_at         = NULL,
              suspended_by         = NULL,
              suspension_expires_at = NULL,
              updated_at           = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [targetUserId],
    );
    if (rows.length === 0) return null;

    await AuditLogService.log({
      userId: adminId,
      action: "USER_UNSUSPENDED",
      resourceType: "user",
      resourceId: targetUserId,
      oldValue: { status: oldUser.status, is_active: oldUser.is_active },
      newValue: { status: "active", is_active: true },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: { adminId },
    });

    return rows[0] as UserRecord;
  },

  /**
   * Suspend a user account.
   * - Sets status = 'suspended' and is_active = false
   * - Stores reason, admin ID, and optional expiry
   * - Invalidates all existing tokens immediately
   * - Sends suspension email + in-app notification
   * - Writes a tamper-evident audit log entry
   */
  async suspendUser(
    targetUserId: string,
    adminId: string,
    reason: string,
    expiresAt?: Date | null,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    // Fetch current user state for audit diff
    const { rows: before } = await pool.query<any>(
      `SELECT id, email, first_name, last_name, status, is_active FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [targetUserId],
    );
    if (before.length === 0) return null;
    const oldUser = before[0];

    // Apply suspension
    const { rows } = await pool.query<any>(
      `UPDATE users
          SET status               = 'suspended',
              is_active            = false,
              suspension_reason    = $2,
              suspended_at         = NOW(),
              suspended_by         = $3,
              suspension_expires_at = $4,
              token_invalid_before = NOW(),
              updated_at           = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [targetUserId, reason, adminId, expiresAt ?? null],
    );
    if (rows.length === 0) return null;
    const updatedUser = rows[0];

    // Revoke all active sessions
    await TokenService.revokeAllUserSessions(targetUserId).catch(() => {});

    // Tamper-evident audit log
    await AuditLogService.log({
      userId: adminId,
      action: "USER_SUSPENDED",
      resourceType: "user",
      resourceId: targetUserId,
      oldValue: { status: oldUser.status, is_active: oldUser.is_active },
      newValue: {
        status: "suspended",
        is_active: false,
        suspension_reason: reason,
        suspension_expires_at: expiresAt ?? null,
      },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: { adminId, reason, expiresAt: expiresAt ?? null },
    });

    // Send suspension email (fire-and-forget — don't block the response)
    this._sendSuspensionEmail(updatedUser, reason, expiresAt).catch(() => {});

    // In-app notification
    this._sendInAppNotification(
      targetUserId,
      "account_suspended",
      "Account Suspended",
      `Your account has been suspended. Reason: ${reason}`,
      { reason, expiresAt: expiresAt ?? null },
    ).catch(() => {});

    return updatedUser as UserRecord;
  },

  /**
   * Permanently ban a user account.
   * - Sets status = 'banned' and is_active = false
   * - Stores reason and admin ID
   * - Invalidates all existing tokens immediately
   * - Sends ban email + in-app notification
   * - Writes a tamper-evident audit log entry
   */
  async banUser(
    targetUserId: string,
    adminId: string,
    reason: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<UserRecord | null> {
    // Fetch current user state for audit diff
    const { rows: before } = await pool.query<any>(
      `SELECT id, email, first_name, last_name, status, is_active FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [targetUserId],
    );
    if (before.length === 0) return null;
    const oldUser = before[0];

    // Apply ban
    const { rows } = await pool.query<any>(
      `UPDATE users
          SET status            = 'banned',
              is_active         = false,
              ban_reason        = $2,
              banned_at         = NOW(),
              banned_by         = $3,
              token_invalid_before = NOW(),
              updated_at        = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [targetUserId, reason, adminId],
    );
    if (rows.length === 0) return null;
    const updatedUser = rows[0];

    // Revoke all active sessions
    await TokenService.revokeAllUserSessions(targetUserId).catch(() => {});

    // Tamper-evident audit log
    await AuditLogService.log({
      userId: adminId,
      action: "USER_BANNED",
      resourceType: "user",
      resourceId: targetUserId,
      oldValue: { status: oldUser.status, is_active: oldUser.is_active },
      newValue: { status: "banned", is_active: false, ban_reason: reason },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: { adminId, reason },
    });

    // Send ban email (fire-and-forget)
    this._sendBanEmail(updatedUser, reason).catch(() => {});

    // In-app notification
    this._sendInAppNotification(
      targetUserId,
      "account_banned",
      "Account Permanently Banned",
      `Your account has been permanently banned. Reason: ${reason}`,
      { reason },
    ).catch(() => {});

    return updatedUser as UserRecord;
  },

  /** @internal Send suspension email via the email queue */
  async _sendSuspensionEmail(
    user: any,
    reason: string,
    expiresAt?: Date | null,
  ): Promise<void> {
    const userName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
    const suspensionDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const duration = expiresAt
      ? `Until ${expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
      : "Indefinite";
    const supportEmail = env.FROM_EMAIL ?? "support@mentorminds.com";
    const appealUrl = `${env.APP_CLIENT_URL}/appeal`;

    await enqueueEmail({
      to: [user.email],
      subject: "Your MentorMinds Account Has Been Suspended",
      templateId: "account-suspended",
      templateData: {
        userName,
        reason,
        suspensionDate,
        duration,
        appealUrl,
        supportEmail,
      },
    });
  },

  /** @internal Send ban email via the email queue */
  async _sendBanEmail(user: any, reason: string): Promise<void> {
    const userName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
    const banDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const supportEmail = env.FROM_EMAIL ?? "support@mentorminds.com";
    const appealUrl = `${env.APP_CLIENT_URL}/appeal`;

    await enqueueEmail({
      to: [user.email],
      subject: "Your MentorMinds Account Has Been Permanently Banned",
      templateId: "account-banned",
      templateData: {
        userName,
        reason,
        banDate,
        appealUrl,
        supportEmail,
      },
    });
  },

  /** @internal Create an in-app notification for the target user */
  async _sendInAppNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data: Record<string, any>,
  ): Promise<void> {
    const { NotificationService } = await import("./notification.service");
    const { NotificationChannel, NotificationPriority } = await import("./notification.service");
    const { NotificationType } = await import("../models/notifications.model");

    await NotificationService.sendNotification({
      userId,
      type: NotificationType.SYSTEM_ALERT,
      channels: [NotificationChannel.IN_APP],
      priority: NotificationPriority.CRITICAL,
      title,
      message,
      data: { notificationType: type, ...data },
    });
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
};
