import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { CertificationService } from "../services/certification.service";
import { SkillTestService } from "../services/skill-test.service";
import { BackgroundCheckService } from "../services/background-check.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export const MentorVerificationController = {
  async getCertificationTypes(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { activeOnly = "true" } = req.query;
      const types = await CertificationService.getCertificationTypes(activeOnly === "true");
      res.status(200).json({ success: true, data: types });
    } catch (error) {
      logger.error("Failed to get certification types", { error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async createCertification(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const mentorId = req.user?.id;
      if (!mentorId) throw createError("Unauthorized", 401);

      const { certificationTypeId, verificationMethod, metadata, notes } = req.body;
      if (!certificationTypeId) throw createError("Certification type ID is required", 400);

      const certification = await CertificationService.createCertification({
        mentorId, certificationTypeId, verificationMethod, metadata, notes,
      });
      res.status(201).json({ success: true, data: certification });
    } catch (error) {
      logger.error("Failed to create certification request", { error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async getMentorCertifications(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;
      const { includeExpired = "false" } = req.query;

      if (req.user?.role !== "admin" && req.user?.id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const certifications = await CertificationService.getMentorCertifications(mentorId, includeExpired === "true");
      res.status(200).json({ success: true, data: certifications });
    } catch (error) {
      logger.error("Failed to get mentor certifications", { mentorId: req.params.mentorId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async getMentorBadges(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;
      const summary = await CertificationService.getMentorCertificationSummary(mentorId);
      res.status(200).json({
        success: true,
        data: { mentorId, badges: summary.badges, certificationLevel: summary.certificationLevel, trustScore: summary.trustScore },
      });
    } catch (error) {
      logger.error("Failed to get mentor badges", { mentorId: req.params.mentorId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async getCertificationSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;
      const summary = await CertificationService.getMentorCertificationSummary(mentorId);
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      logger.error("Failed to get certification summary", { mentorId: req.params.mentorId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async startSkillTest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const mentorId = req.user?.id;
      if (!mentorId) throw createError("Unauthorized", 401);

      const { testId } = req.params;
      const { certificationId } = req.body;

      const attempt = await SkillTestService.startTestAttempt(mentorId, testId, certificationId);
      const questions = await SkillTestService.getTestQuestions(testId, false);
      res.status(201).json({ success: true, data: { attempt, questions } });
    } catch (error) {
      logger.error("Failed to start skill test", { testId: req.params.testId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async submitSkillTest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { attemptId } = req.params;
      const { answers } = req.body;
      if (!answers) throw createError("Answers are required", 400);

      const result = await SkillTestService.submitTestAnswers({ attemptId, answers });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("Failed to submit skill test answers", { attemptId: req.params.attemptId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async initiateBackgroundCheck(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const mentorId = req.user?.id;
      if (!mentorId) throw createError("Unauthorized", 401);

      const { checkType, provider, certificationId, metadata } = req.body;
      if (!checkType) throw createError("Background check type is required", 400);

      const check = await BackgroundCheckService.initiateBackgroundCheck({
        mentorId, checkType, provider, certificationId, metadata,
      });
      res.status(201).json({ success: true, data: check });
    } catch (error) {
      logger.error("Failed to initiate background check", { error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async getBackgroundCheck(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { checkId } = req.params;
      const check = await BackgroundCheckService.getBackgroundCheck(checkId);
      if (!check) throw createError("Background check not found", 404);

      if (req.user?.role !== "admin" && req.user?.id !== check.mentorId) {
        throw createError("Access denied", 403);
      }

      res.status(200).json({ success: true, data: check });
    } catch (error) {
      logger.error("Failed to get background check", { checkId: req.params.checkId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async verifyCertification(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { certificationId } = req.params;
      const { score, notes } = req.body;
      const verifiedBy = req.user?.id;

      const certification = await CertificationService.updateCertification(
        certificationId, { status: "verified", score, notes }, verifiedBy,
      );
      res.status(200).json({ success: true, message: "Certification verified successfully and badge issued", data: certification });
    } catch (error) {
      logger.error("Failed to verify certification", { certificationId: req.params.certificationId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async revokeCertification(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { certificationId } = req.params;
      const { reason } = req.body;
      const revokedBy = req.user?.id ?? "";

      if (!reason) throw createError("Revocation reason is required", 400);

      await CertificationService.revokeCertification(certificationId, reason, revokedBy);
      res.status(200).json({ success: true, message: "Certification revoked successfully" });
    } catch (error) {
      logger.error("Failed to revoke certification", { certificationId: req.params.certificationId, error: error instanceof Error ? error.message : error });
      next(error);
    }
  },

  async getPendingCertifications(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit = "50" } = req.query;
      const certifications = await CertificationService.getPendingCertifications(parseInt(limit as string, 10) || 50);
      res.status(200).json({ success: true, data: certifications });
    } catch (error) {
      logger.error("Failed to get pending certifications", { error: error instanceof Error ? error.message : error });
      next(error);
    }
  },
};

export default MentorVerificationController;
