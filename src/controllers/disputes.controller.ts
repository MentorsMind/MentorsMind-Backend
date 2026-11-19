import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { DisputeService } from "../services/disputes.service";
import { DisputeModel } from "../models/dispute.model";
import { routeParam } from "../utils/route-params.utils";
import { RESOLUTION_TEMPLATES } from "../constants/resolution-templates.constant";
import { z } from 'zod';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel } from '../utils/log-formatter.utils';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const DisputeTypeEnum = z.enum(["payment", "quality", "conduct", "cancellation"]);

const OpenDisputeSchema = z.object({
  session_id: z
    .string()
    .uuid("Invalid session ID format")
    .nonempty("Session ID is required"),
  type: DisputeTypeEnum,
  reason: z
    .string()
    .min(10, "Reason must be at least 10 characters")
    .max(2000, "Reason must not exceed 2000 characters")
    .nonempty("Reason is required"),
});

const UploadEvidenceSchema = z.object({
  text_content: z
    .string()
    .max(5000, "Text evidence must not exceed 5000 characters")
    .optional(),
  file_url: z
    .string()
    .url("Invalid file URL")
    .optional(),
}).refine(
  (data) => data.text_content || data.file_url,
  "Either text_content or file_url must be provided"
);

const ResoluteDisputeSchema = z.object({
  mentor_pct: z
    .number()
    .int("mentor_pct must be an integer")
    .min(0, "mentor_pct must be between 0 and 100")
    .max(100, "mentor_pct must be between 0 and 100"),
  notes: z
    .string()
    .max(2000, "Resolution notes must not exceed 2000 characters")
    .optional(),
});

const MediateDisputeSchema = z.object({
  notes: z
    .string()
    .min(1, "Notes are required")
    .max(2000, "Mediation notes must not exceed 2000 characters"),
});

export class DisputesController {
  static async openDispute(req: Request, res: Response): Promise<void> {
    try {
      // SECURITY FIX: Ensure user is authenticated
      if (!req.user || !req.user.userId) {
        res.status(401).json({ 
          error: "Authentication required",
          code: "AUTH_REQUIRED" 
        });
        return;
      }

      // ── Validate input schema ──
      const validationResult = OpenDisputeSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: "Invalid dispute data",
          code: "VALIDATION_ERROR",
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }

      const { session_id, type, reason } = validationResult.data;
      const filed_by_id = req.user.userId;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const dispute = await DisputeService.openDispute(
        session_id,
        filed_by_id,
        type,
        reason,
        ipAddress,
        userAgent
      );

      // Log dispute creation for audit
      await AuditLoggerService.logEvent({
        level: LogLevel.INFO,
        action: 'DISPUTE_OPENED',
        message: `Dispute ${dispute.id} opened for session ${session_id}`,
        userId: filed_by_id,
        entityType: 'dispute',
        entityId: dispute.id,
        metadata: {
          sessionId: session_id,
          disputeType: type
        },
        ipAddress,
        userAgent
      });
      res.status(201).json({ data: dispute });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getDispute(req: Request, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      const dispute = await DisputeModel.findById(id);

      if (!dispute) {
        res.status(404).json({ error: "Dispute not found" });
        return;
      }

      const evidence = await DisputeModel.getEvidence(id);
      const evidenceStr = Array.isArray(evidence) ? evidence[0] : evidence;
      res.status(200).json({ data: { ...dispute, evidence: evidenceStr } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  static async uploadEvidence(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      
      // ── Validate input schema ──
      const validationResult = UploadEvidenceSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: "Invalid evidence data",
          code: "VALIDATION_ERROR",
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }

      const { text_content, file_url } = validationResult.data;
      const submitterId = req.user!.userId ?? req.user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";
      const userRole = req.user!.role;

      const evidence = await DisputeService.uploadEvidence(
        id,
        submitterId,
        userRole,
        text_content,
        file_url,
        ipAddress,
        userAgent
      );
      res.status(201).json({ data: evidence });
    } catch (error: any) {
      if (error.message.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async resolveDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      
      // ── Validate input schema ──
      const validationResult = ResoluteDisputeSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: "Invalid resolution data",
          code: "VALIDATION_ERROR",
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }

      const { mentor_pct, notes } = validationResult.data;
      const adminId = req.user!.userId ?? req.user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const dispute = await DisputeService.resolveDispute(
        id,
        adminId,
        mentor_pct,
        notes,
        ipAddress,
        userAgent
      );
      res.status(200).json({ data: dispute });
    } catch (error: any) {
      if (
        error.message.includes("Invalid state transition") ||
        error.message.includes("not found")
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async mediateDispute(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = routeParam(req.params.id);
      
      // ── Validate input schema ──
      const validationResult = MediateDisputeSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: "Invalid mediation data",
          code: "VALIDATION_ERROR",
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }

      const { notes } = validationResult.data;
      const adminId = req.user!.userId ?? req.user!.id;
      const ipAddress = req.ip || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const dispute = await DisputeService.mediateDispute(id, adminId, notes, ipAddress, userAgent);
      res.status(200).json({ data: dispute });
    } catch (error: any) {
      if (
        error.message.includes("Invalid state transition") ||
        error.message.includes("not found")
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  static async getResolutionTemplates(
    _req: Request,
    res: Response,
  ): Promise<void> {
    res.status(200).json({ data: RESOLUTION_TEMPLATES });
  }

  static async listDisputes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId ?? req.user!.id;
      const isAdmin = req.user!.role === "admin";

      let disputes;
      if (isAdmin) {
        disputes = await DisputeModel.findAll();
      } else {
        disputes = await DisputeModel.findByUserId(userId);
      }

      res.status(200).json({ data: disputes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
