/**
 * Admin Audit Log Controller
 *
 * Provides admin endpoints for:
 *   - Verifying the tamper-evident hash chain integrity
 *   - Exporting audit logs as CSV
 *   - Retrieving audit log statistics
 *   - Paginated audit log listing
 */

import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { AuditLogService } from "../services/auditLog.service";

export const AdminAuditController = {
  /**
   * GET /api/v1/admin/audit-logs
   * Paginated list of audit log entries with optional filters.
   */
  async listAuditLogs(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const {
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const result = await AuditLogService.query({
      userId,
      action,
      resourceType,
      startDate,
      endDate,
      page: pageNum,
      limit: limitNum,
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
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1,
      },
    );
  },

  /**
   * GET /api/v1/admin/audit-logs/verify-chain
   * Verify the integrity of the audit log hash chain.
   *
   * Returns whether the chain is intact or lists broken links (tampering evidence).
   * Query params:
   *   - limit: number of records to check (default 1000, max 50000)
   */
  async verifyChain(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const limitParam = parseInt((req.query.limit as string) || "1000", 10);
    const limit = Math.min(50000, Math.max(1, limitParam));

    const result = await AuditLogService.verifyChainIntegrity(limit);

    const statusCode = result.valid ? 200 : 200; // always 200; client checks `valid`
    ResponseUtil.success(
      res,
      result,
      result.valid
        ? `Audit log chain is intact (${result.checkedCount} records verified)`
        : `Audit log chain has ${result.errors.length} integrity error(s) — possible tampering detected`,
      statusCode,
    );
  },

  /**
   * GET /api/v1/admin/audit-logs/export
   * Export audit logs as a CSV file.
   *
   * Accepts the same filters as listAuditLogs.
   */
  async exportCsv(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const {
      userId,
      action,
      resourceType,
      startDate,
      endDate,
    } = req.query as Record<string, string>;

    const csv = await AuditLogService.exportToCSV({
      userId,
      action,
      resourceType,
      startDate,
      endDate,
    });

    const filename = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(csv);
  },

  /**
   * GET /api/v1/admin/audit-logs/stats
   * Aggregate statistics about audit log activity.
   *
   * Query params:
   *   - startDate: ISO date string
   *   - endDate: ISO date string
   */
  async getStats(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const { startDate, endDate } = req.query as Record<string, string>;

    const stats = await AuditLogService.getStats(startDate, endDate);

    ResponseUtil.success(res, stats, "Audit log statistics retrieved");
  },
};
