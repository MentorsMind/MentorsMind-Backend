// @ts-nocheck
import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ModerationService } from "../services/moderation.service";
import {
  AIModerationService,
  ContentType,
} from "../services/ai-moderation.service";
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
    const { notes, suspendHours } = req.body;
    const reviewerId = req.user?.id;

    if (!reviewerId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const flag = await ModerationService.rejectContent(
      flagId,
      reviewerId,
      notes,
      suspendHours,
    );

    if (!flag) {
      ResponseUtil.notFound(res, "Flag not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.WARN,
      action: AuditAction.ADMIN_ACTION,
      message: `Content rejected by moderator${suspendHours ? " and author suspended" : ""}`,
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
   * DELETE /api/v1/admin/moderation/:id
   * Delete a flag (usually after resolution)
   */
  async deleteFlag(req: AuthenticatedRequest, res: Response): Promise<void> {
    const flagId = req.params.id;
    const reviewerId = req.user?.id;

    if (!reviewerId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    const flag = await ModerationService.deleteFlag(flagId, reviewerId);

    if (!flag) {
      ResponseUtil.notFound(res, "Flag not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `Flag deleted by moderator`,
      userId: reviewerId,
      entityType: "FLAG",
      entityId: flagId,
    });

    ResponseUtil.success(res, { message: "Flag deleted successfully", flagId });
  },

  /**
   * GET /api/v1/admin/moderation/stats
   * Get moderation statistics
   */
  async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stats = await ModerationService.getStats();
    ResponseUtil.success(res, stats, "Moderation statistics retrieved");
  },

  /**
   * GET /api/v1/admin/moderation/ai-queue
   * Get AI-flagged items awaiting human review
   */
  async getAIQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await ModerationService.getAIPendingReview(limit, offset);

    ResponseUtil.success(
      res,
      result.data,
      "AI moderation queue retrieved",
      200,
      {
        total: result.total,
        limit,
        offset,
      } as any,
    );
  },

  /**
   * POST /api/v1/admin/moderation/scan
   * Manually trigger an AI scan on arbitrary text (admin tool)
   */
  async triggerAIScan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { contentId, contentType, text } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    if (!contentId || !contentType || !text) {
      ResponseUtil.error(
        res,
        "contentId, contentType, and text are required",
        400,
      );
      return;
    }

    const validTypes: ContentType[] = ["profile", "review", "message"];
    if (!validTypes.includes(contentType as ContentType)) {
      ResponseUtil.error(
        res,
        `contentType must be one of: ${validTypes.join(", ")}`,
        400,
      );
      return;
    }

    const result = await AIModerationService.scan(
      contentId as string,
      contentType as ContentType,
      text as string,
    );

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `Admin triggered AI moderation scan`,
      userId,
      entityType: "AI_MODERATION",
      entityId: contentId as string,
    });

    ResponseUtil.success(res, result, "AI moderation scan complete");
  },

  // ─── Appeals ───────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/user/moderation/flags/:id/appeal
   * Submit an appeal for a rejected flag
   */
  async submitAppeal(req: AuthenticatedRequest, res: Response): Promise<void> {
    const flagId = req.params.id;
    const { reason } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    if (!reason || reason.trim().length === 0) {
      ResponseUtil.error(res, "Appeal reason is required", 400);
      return;
    }

    const appeal = await ModerationService.submitAppeal(flagId, userId, reason);

    ResponseUtil.success(res, appeal, "Appeal submitted successfully", 201);
  },

  /**
   * GET /api/v1/admin/moderation/appeals
   * Get appeals queue
   */
  async getAppeals(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = (req.query.status as string) || "pending";

    const result = await ModerationService.getAppeals(limit, offset, status);

    ResponseUtil.success(res, result.data, "Appeals queue retrieved", 200, {
      total: result.total,
      limit,
      offset,
      status,
    } as any);
  },

  /**
   * PUT /api/v1/admin/moderation/appeals/:id/resolve
   * Resolve an appeal
   */
  async resolveAppeal(req: AuthenticatedRequest, res: Response): Promise<void> {
    const appealId = req.params.id;
    const { status, notes } = req.body;
    const adminId = req.user?.id;

    if (!adminId) {
      ResponseUtil.unauthorized(res, "Authentication required");
      return;
    }

    if (!status || !["approved", "rejected"].includes(status)) {
      ResponseUtil.error(
        res,
        "Valid status ('approved' or 'rejected') is required",
        400,
      );
      return;
    }

    const appeal = await ModerationService.resolveAppeal(
      appealId,
      adminId,
      status,
      notes,
    );

    if (!appeal) {
      ResponseUtil.notFound(res, "Appeal not found");
      return;
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION,
      message: `Appeal resolved as ${status}`,
      userId: adminId,
      entityType: "APPEAL",
      entityId: appealId,
    });

    ResponseUtil.success(res, appeal, `Appeal ${status} successfully`);
  },
};
