import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { AdminService } from "../services/admin.service";
import { ResponseUtil } from "../utils/response.utils";
import { AuditLogService } from "../services/auditLog.service";

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

  /** PUT /admin/users/:id/suspend */
  async suspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;

    const updated = await AdminService.updateUserStatus(id, false);
    if (!updated) {
      ResponseUtil.notFound(res, "User not found");
      return;
    }
    ResponseUtil.success(res, updated, "User suspended successfully");
  },

  /** PUT /admin/users/:id/unsuspend */
  async unsuspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id as string;

    const updated = await AdminService.updateUserStatus(id, true);
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
  async exportAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
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

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.send(csv);
  },

  /** GET /admin/audit-log/verify */
  async verifyAuditLogIntegrity(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await AuditLogService.verifyChainIntegrity();
    ResponseUtil.success(res, result, "Audit log integrity check completed");
  },

  /** GET /admin/audit-log/stats */
  async getAuditLogStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const stats = await AuditLogService.getStats(startDate, endDate);
    ResponseUtil.success(res, stats, "Audit log statistics retrieved successfully");
  },
};
