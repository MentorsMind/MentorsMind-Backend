import { Request, Response, NextFunction } from "express";
import { CertificationService } from "../services/certification.service";
import { SkillTestService } from "../services/skill-test.service";
import { BackgroundCheckService } from "../services/background-check.service";
import { MentorOnboardingService } from "../services/mentor-onboarding.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export const CertificationController = {
  /**
   * Get all certification types
   * GET /api/v1/certifications/types
   */
  async getCertificationTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { activeOnly = 'true' } = req.query;
      
      const types = await CertificationService.getCertificationTypes(
        activeOnly === 'true'
      );

      res.status(200).json({
        success: true,
        data: types
      });
    } catch (error) {
      logger.error("Failed to get certification types", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Create certification request
   * POST /api/v1/certifications
   */
  async createCertification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { certificationTypeId, verificationMethod, metadata, notes } = req.body;
      const mentorId = req.user?.id;

      if (!mentorId) {
        throw createError("Unauthorized", 401);
      }

      if (!certificationTypeId) {
        throw createError("Certification type ID is required", 400);
      }

      const certification = await CertificationService.createCertification({
        mentorId,
        certificationTypeId,
        verificationMethod,
        metadata,
        notes
      });

      res.status(201).json({
        success: true,
        data: certification
      });
    } catch (error) {
      logger.error("Failed to create certification", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get mentor certifications
   * GET /api/v1/certifications/mentor/:mentorId
   */
  async getMentorCertifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;
      const { includeExpired = 'false' } = req.query;

      // Authorization: mentors can view their own, admins can view all
      if (req.user?.role !== 'admin' && req.user?.id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const certifications = await CertificationService.getMentorCertifications(
        mentorId,
        includeExpired === 'true'
      );

      res.status(200).json({
        success: true,
        data: certifications
      });
    } catch (error) {
      logger.error("Failed to get mentor certifications", {
        mentorId: req.params.mentorId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get certification summary
   * GET /api/v1/certifications/mentor/:mentorId/summary
   */
  async getCertificationSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;

      const summary = await CertificationService.getMentorCertificationSummary(mentorId);

      res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      logger.error("Failed to get certification summary", {
        mentorId: req.params.mentorId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Update certification (admin only)
   * PUT /api/v1/certifications/:certificationId
   */
  async updateCertification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { certificationId } = req.params;
      const { status, score, metadata, notes, revocationReason } = req.body;
      const updatedBy = req.user?.id;

      const certification = await CertificationService.updateCertification(
        certificationId,
        { status, score, metadata, notes, revocationReason },
        updatedBy
      );

      res.status(200).json({
        success: true,
        data: certification
      });
    } catch (error) {
      logger.error("Failed to update certification", {
        certificationId: req.params.certificationId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get pending certifications (admin only)
   * GET /api/v1/certifications/pending
   */
  async getPendingCertifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit = '50' } = req.query;

      const certifications = await CertificationService.getPendingCertifications(
        parseInt(limit as string)
      );

      res.status(200).json({
        success: true,
        data: certifications
      });
    } catch (error) {
      logger.error("Failed to get pending certifications", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Start skill test
   * POST /api/v1/certifications/tests/:testId/start
   */
  async startSkillTest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { testId } = req.params;
      const { certificationId } = req.body;
      const mentorId = req.user?.id;

      if (!mentorId) {
        throw createError("Unauthorized", 401);
      }

      const attempt = await SkillTestService.startTestAttempt(
        mentorId,
        testId,
        certificationId
      );

      // Get test questions (without answers)
      const questions = await SkillTestService.getTestQuestions(testId, false);

      res.status(201).json({
        success: true,
        data: {
          attempt,
          questions
        }
      });
    } catch (error) {
      logger.error("Failed to start skill test", {
        testId: req.params.testId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Submit test answers
   * POST /api/v1/certifications/tests/attempts/:attemptId/submit
   */
  async submitTestAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { attemptId } = req.params;
      const { answers } = req.body;

      if (!answers) {
        throw createError("Answers are required", 400);
      }

      const result = await SkillTestService.submitTestAnswers({
        attemptId,
        answers
      });

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error("Failed to submit test answers", {
        attemptId: req.params.attemptId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Initiate background check
   * POST /api/v1/certifications/background-checks
   */
  async initiateBackgroundCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { certificationId, checkType, provider } = req.body;
      const mentorId = req.user?.id;

      if (!mentorId) {
        throw createError("Unauthorized", 401);
      }

      if (!checkType || !provider) {
        throw createError("Check type and provider are required", 400);
      }

      const check = await BackgroundCheckService.initiateBackgroundCheck({
        mentorId,
        certificationId,
        checkType,
        provider
      });

      res.status(201).json({
        success: true,
        data: check
      });
    } catch (error) {
      logger.error("Failed to initiate background check", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get background check status
   * GET /api/v1/certifications/background-checks/:checkId
   */
  async getBackgroundCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { checkId } = req.params;

      const check = await BackgroundCheckService.getBackgroundCheck(checkId);

      if (!check) {
        throw createError("Background check not found", 404);
      }

      // Authorization: mentors can view their own, admins can view all
      if (req.user?.role !== 'admin' && req.user?.id !== check.mentorId) {
        throw createError("Access denied", 403);
      }

      res.status(200).json({
        success: true,
        data: check
      });
    } catch (error) {
      logger.error("Failed to get background check", {
        checkId: req.params.checkId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get onboarding progress
   * GET /api/v1/certifications/onboarding/:mentorId
   */
  async getOnboardingProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;

      // Authorization: mentors can view their own, admins can view all
      if (req.user?.role !== 'admin' && req.user?.id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const progress = await MentorOnboardingService.getOnboardingProgress(mentorId);

      if (!progress) {
        // Initialize onboarding if not exists
        await MentorOnboardingService.initializeOnboarding(mentorId);
        const newProgress = await MentorOnboardingService.getOnboardingProgress(mentorId);
        
        res.status(200).json({
          success: true,
          data: newProgress
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: progress
      });
    } catch (error) {
      logger.error("Failed to get onboarding progress", {
        mentorId: req.params.mentorId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Complete onboarding step
   * POST /api/v1/certifications/onboarding/:mentorId/steps/:stepId/complete
   */
  async completeOnboardingStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId, stepId } = req.params;

      // Authorization: mentors can complete their own steps
      if (req.user?.id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const onboarding = await MentorOnboardingService.completeStep(mentorId, stepId);

      res.status(200).json({
        success: true,
        data: onboarding
      });
    } catch (error) {
      logger.error("Failed to complete onboarding step", {
        mentorId: req.params.mentorId,
        stepId: req.params.stepId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  }
};
