import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ModerationService } from "../services/moderation.service";
import { ResponseUtil } from "../utils/response.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";

export const ModerationController = {
  /**
   * POST /api/v1/reviews/:id/flag
   * Flag a review for moderation
   */
  async flagReview(req: AuthenticatedRequest, res: Response): Promise<void> {
    const reviewId = req.params.id;
    const { reason } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    if (!reason || reason.trim().length === 0) {
      ResponseUtil.error(res, "Reason is required", 400);
      return;
    }

    const flag = await ModerationService.flagContent(
      "review",
      reviewId,
      userId,
      reason,
    );

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `Review flagged for moderation`,
      userId,
      entityType: "FLAG",
      entityId: flag.id,
    });

    ResponseUtil.success(res, flag, "Review flagged for moderation", 201);
  },

  /**
   * GET /api/v1/admin/moderation/queue
   * Get moderation queue
   */
  async getQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await ModerationService.getQueue(limit, offset);

    ResponseUtil.success(res, result.data, "Moderation queue retrieved", 200, {
      total: result.total,
      limit,
      offset,
    } as any);
  },

  /**
   * PUT /api/v1/admin/moderation/:id/approve
   * Approve flagged content
   */
  async approveContent(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const flagId = req.params.id;
    const { notes } = req.body;
    const reviewerId = req.user?.id;

    if (!reviewerId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const flag = await ModerationService.approveContent(
      flagId,
      reviewerId,
      notes,
    );

    if (!flag) {
      ResponseUtil.notFound(res, "Flag not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `Content approved by moderator`,
      userId: reviewerId,
      entityType: "FLAG",
      entityId: flagId,
    });

    ResponseUtil.success(res, flag, "Content approved");
  },

  /**
   * PUT /api/v1/admin/moderation/:id/reject
   * Reject flagged content
   */
  async rejectContent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const flagId = req.params.id;
    const { notes } = req.body;
    const reviewerId = req.user?.id;

    if (!reviewerId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const flag = await ModerationService.rejectContent(
      flagId,
      reviewerId,
      notes,
    );

    if (!flag) {
      ResponseUtil.notFound(res, "Flag not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.WARN,
      action: AuditAction.ADMIN_ACTION,
      message: `Content rejected by moderator`,
      userId: reviewerId,
      entityType: "FLAG",
      entityId: flagId,
    });

    ResponseUtil.success(res, flag, "Content rejected and author notified");
  },

  /**
   * PUT /api/v1/admin/moderation/:id/escalate
   * Escalate flag to senior admin
   */
  async escalateFlag(req: AuthenticatedRequest, res: Response): Promise<void> {
    const flagId = req.params.id;
    const { notes } = req.body;
    const reviewerId = req.user?.id;

    if (!reviewerId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const flag = await ModerationService.escalateFlag(
      flagId,
      reviewerId,
      notes,
    );

    if (!flag) {
      ResponseUtil.notFound(res, "Flag not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.WARN,
      action: AuditAction.ADMIN_ACTION,
      message: `Flag escalated to senior admin`,
      userId: reviewerId,
      entityType: "FLAG",
      entityId: flagId,
    });

    ResponseUtil.success(res, flag, "Flag escalated to senior admin");
  },

  /**
   * GET /api/v1/admin/moderation/stats
   * Get moderation statistics
   */
  async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stats = await ModerationService.getStats();
    ResponseUtil.success(res, stats, "Moderation statistics retrieved");
  },
};
