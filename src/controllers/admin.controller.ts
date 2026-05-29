import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { AdminService } from "../services/admin.service";
import { ResponseUtil } from "../utils/response.utils";
import {
  AuditLogService,
  extractIpAddress,
} from "../services/auditLog.service";
import { LoginAttemptsService } from "../services/loginAttempts.service";
import { IpFilterService } from "../services/ipFilter.service";
import pool from "../config/database";
import { keyRotationJob } from "../jobs/keyRotation.job";
import { accountDeletionService } from "../services/accountDeletion.service";
import { WebhookService } from "../services/webhook.service";

export const AdminController = {
  /** GET /admin/stats */
  async getStats(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const stats = await AdminService.getStats();
    ResponseUtil.success(
      res,
      stats,
      "Platform statistics retrieved successfully",
    );
  },

  /** GET /admin/users */
  async listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const role = req.query.role as string;

    const result = await AdminService.listUsers(limit, offset, role);
    ResponseUtil.success(
      res,
      result.data,
      "Users retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** PUT /admin/users/:id/status */
  async updateUserStatus(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const id = req.params.id as string;
    const { isActive } = req.body;

    const updated = await AdminService.updateUserStatus(id, isActive);
    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }
    ResponseUtil.success(res, updated, "User status updated successfully");
  },

  /** PUT /admin/users/:id/tier */
  async updateUserTier(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { tier } = req.body;

    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(tier)) {
      ResponseUtil.error(res, "Invalid tier. Must be free, pro, or enterprise", 400);
      return;
    }

    const updated = await AdminService.updateUserTier(id, tier);
    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }

    // Log the tier change
    await AuditLogService.log({
      userId: req.user!.userId,
      action: 'USER_TIER_UPDATED',
      resourceType: 'user',
      resourceId: id,
      newValue: { tier },
      ipAddress: extractIpAddress(req),
    });

    ResponseUtil.success(res, updated, "User tier updated successfully");
  },

  /** PUT /admin/users/:id/suspend */
  async suspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { reason, expiresAt } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      ResponseUtil.error(res, "A suspension reason is required", 400);
      return;
    }

    // Prevent admins from suspending themselves
    if (req.user?.id === id) {
      ResponseUtil.error(res, "You cannot suspend your own account", 400);
      return;
    }

    const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
    if (parsedExpiry && isNaN(parsedExpiry.getTime())) {
      ResponseUtil.error(res, "Invalid expiresAt date format", 400);
      return;
    }

    const updated = await AdminService.suspendUser(
      id,
      req.user!.id,
      reason.trim(),
      parsedExpiry,
      extractIpAddress(req),
      req.headers["user-agent"] ?? null,
    );

    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }
    ResponseUtil.success(res, updated, "User suspended successfully");
  },

  /** PUT /admin/users/:id/ban */
  async banUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { reason } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      ResponseUtil.error(res, "A ban reason is required", 400);
      return;
    }

    // Prevent admins from banning themselves
    if (req.user?.id === id) {
      ResponseUtil.error(res, "You cannot ban your own account", 400);
      return;
    }

    const updated = await AdminService.banUser(
      id,
      req.user!.id,
      reason.trim(),
      extractIpAddress(req),
      req.headers["user-agent"] ?? null,
    );

    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }
    ResponseUtil.success(res, updated, "User permanently banned successfully");
  },

  /** PUT /admin/users/:id/unsuspend */
  async unsuspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;

    const updated = await AdminService.unsuspendUser(
      id,
      req.user!.id,
      extractIpAddress(req),
      req.headers["user-agent"] ?? null,
    );
    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }
    ResponseUtil.success(res, updated, "User unsuspended successfully");
  },

  /** GET /admin/transactions */
  async listTransactions(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await AdminService.listTransactions(limit, offset);
    ResponseUtil.success(
      res,
      result.data,
      "Transactions retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** GET /admin/sessions */
  async listSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    const result = await AdminService.listSessions(limit, offset, status);
    ResponseUtil.success(
      res,
      result.data,
      "Sessions retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** GET /admin/payments */
  async listPayments(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const result = await AdminService.listPayments(
      limit,
      offset,
      startDate,
      endDate,
    );
    ResponseUtil.success(
      res,
      result.data,
      "Payments retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** GET /admin/disputes */
  async listDisputes(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await AdminService.listDisputes(limit, offset);
    ResponseUtil.success(
      res,
      result.data,
      "Disputes retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** POST /admin/disputes/:id/resolve */
  async resolveDispute(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const id = req.params.id as string;
    const { status, notes } = req.body;

    if (!["resolved", "dismissed"].includes(status)) {
      ResponseUtil.error(
        res,
        "Invalid status. Must be resolved or dismissed",
        400,
      );
      return;
    }

    const resolved = await AdminService.resolveDispute(id, status, notes);
    if (!resolved) {
      ResponseUtil.notFound(res, "Dispute not found");
      return;
    }
    ResponseUtil.success(res, resolved, "Dispute resolved successfully");
  },

  /** GET /admin/system-health */
  async getSystemHealth(
    _req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const health = await AdminService.getSystemHealth();
    ResponseUtil.success(res, health, "System health retrieved successfully");
  },

  /** GET /admin/logs */
  async getLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const { action, userId, level } = req.query;

    const result = await AdminService.getLogs({
      action: action as string,
      userId: userId as string,
      level: level as string,
      limit,
      offset,
    });
    ResponseUtil.success(
      res,
      result.data,
      "System logs retrieved successfully",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /** POST /admin/config */
  async updateConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      ResponseUtil.error(res, "Key and value are required", 400);
      return;
    }

    await AdminService.updateConfig(key, value);
    ResponseUtil.success(res, null, "Configuration updated successfully");
  },

  async rotateEncryptionKey(
    _req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const result = await keyRotationJob.run();
    ResponseUtil.success(res, result, "Encryption key rotation job completed");
  },

  async listDeletionRequests(
    _req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const requests = await accountDeletionService.listDeletionRequests();
    ResponseUtil.success(
      res,
      { requests },
      "Deletion requests retrieved successfully",
    );
  },

  /** POST /admin/deletion-requests/retry */
  async retryFailedDeletions(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const maxRetries = parseInt(req.body.maxRetries as string) || 3;
    const result = await accountDeletionService.retryFailedDeletions(maxRetries);
    
    ResponseUtil.success(
      res,
      { 
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        results: result.results
      },
      `Retry completed: ${result.successful} succeeded, ${result.failed} failed`,
    );
  },

  /** GET /admin/audit-log */
  async getAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const userId = req.query.userId as string;
    const action = req.query.action as string;
    const resourceType = req.query.resourceType as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const result = await AuditLogService.query({
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      page,
      limit,
    });

    ResponseUtil.success(
      res,
      result.logs,
      "Audit logs retrieved successfully",
      200,
      {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      } as any,
    );
  },

  /** GET /admin/audit-log/export */
  async exportAuditLogs(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const userId = req.query.userId as string;
    const action = req.query.action as string;
    const resourceType = req.query.resourceType as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const csv = await AuditLogService.exportToCSV({
      userId,
      action,
      resourceType,
      startDate,
      endDate,
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv");
    res.send(csv);
  },

  /** GET /admin/audit-log/verify */
  async verifyAuditLogIntegrity(
    _req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const result = await AuditLogService.verifyChainIntegrity();
    ResponseUtil.success(res, result, "Audit log integrity check completed");
  },

  /** GET /admin/audit-log/stats */
  async getAuditLogStats(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const stats = await AuditLogService.getStats(startDate, endDate);
    ResponseUtil.success(
      res,
      stats,
      "Audit log statistics retrieved successfully",
    );
  },

  /** POST /admin/users/:id/unlock — clear login lockout for a user */
  async unlockUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.params.id as string;

    // Look up the user's email so we can clear the Redis key
    const { rows } = await pool.query<{ email: string; is_active: boolean }>(
      `SELECT email, is_active FROM users WHERE id = $1`,
      [userId],
    );

    if (rows.length === 0) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }

    const { email } = rows[0];
    await LoginAttemptsService.adminUnlock(email);

    await AuditLogService.log({
      userId: req.user!.id,
      action: "ACCOUNT_UNLOCKED",
      resourceType: "user",
      resourceId: userId,
      ipAddress: extractIpAddress(req),
      userAgent: req.headers["user-agent"] || null,
      metadata: { unlockedEmail: email },
    });

    ResponseUtil.success(
      res,
      { userId, email },
      "Account unlocked successfully",
    );
  },

  /** POST /admin/email/preview/:template — preview rendered email template */
  async previewEmailTemplate(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const templateName = req.params.template as string;
    const sampleData = req.body || {};

    if (!templateName) {
      ResponseUtil.error(res, "Template name is required", 400);
      return;
    }

    try {
      // Import template engine service
      const { TemplateEngineService } =
        await import("../services/template-engine.service");

      // Render the template with sample data
      const rendered = await TemplateEngineService.renderEmail(
        templateName,
        sampleData,
      );

      ResponseUtil.success(
        res,
        {
          template: templateName,
          subject: rendered.subject,
          html: rendered.htmlContent,
          text: rendered.textContent,
          sampleData,
        },
        "Email template preview generated successfully",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      ResponseUtil.error(
        res,
        `Failed to preview template: ${errorMessage}`,
        500,
      );
    }
  },

  /** POST /admin/security/blocklist */
  async addBlocklistRule(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { ipRange, reason } = req.body;
    if (!ipRange) {
      ResponseUtil.error(res, "ipRange is required", 400);
      return;
    }

    try {
      const rule = await IpFilterService.addRule({
        ipRange,
        ruleType: "block",
        context: "global",
        reason,
        adminId: req.user!.id,
        ipAddress: extractIpAddress(req),
      });
      ResponseUtil.success(res, rule, "IP successfully blocked", 201);
    } catch (err: any) {
      ResponseUtil.error(res, err.message, 400);
    }
  },

  /** DELETE /admin/security/blocklist/:id */
  async removeBlocklistRule(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { id } = req.params;
    const removed = await IpFilterService.removeRule(
      id as string,
      req.user!.id,
      extractIpAddress(req),
    );

    if (!removed) {
      ResponseUtil.notFound(res, "IP rule not found");
      return;
    }
    ResponseUtil.success(res, null, "IP rule successfully removed");
  },

  /** GET /admin/security/blocklist */
  async listBlocklistRules(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const rules = await IpFilterService.getRules();
    const blocklist = rules.filter(
      (r) => r.rule_type === "block" && r.context === "global",
    );
    ResponseUtil.success(res, blocklist, "Blocklist retrieved successfully");
  },

  /** POST /admin/security/allowlist */
  async addAdminAllowlistRule(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { ipRange, reason } = req.body;
    if (!ipRange) {
      ResponseUtil.error(res, "ipRange is required", 400);
      return;
    }

    try {
      const rule = await IpFilterService.addRule({
        ipRange,
        rule_type: "allow",
        context: "global",
        reason,
        created_by: req.user!.userId,
      });
      ResponseUtil.success(res, rule, "Allowlist rule added successfully");
    } catch (err: any) {
      ResponseUtil.error(res, err.message, 400);
    }
  },

  /** POST /admin/webhooks/:deliveryId/retry */
  async retryWebhookDelivery(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { deliveryId } = req.params;
    const userId = req.user!.userId;

    try {
      const result = await WebhookService.retryDelivery(deliveryId, userId);
      
      if (result.success) {
        ResponseUtil.success(res, null, result.message);
      } else {
        ResponseUtil.error(res, result.message, 400);
      }
    } catch (err: any) {
      ResponseUtil.error(res, err.message, 500);
    }
  },
};
