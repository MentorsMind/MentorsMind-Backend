import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { MentorOnboarding } from "../models/certification.model";

/**
 * Mentor Onboarding Service
 * Manages mentor onboarding workflow
 */
export const MentorOnboardingService = {
  /**
   * Onboarding steps definition
   */
  ONBOARDING_STEPS: [
    { id: 'profile_setup', title: 'Complete Profile', description: 'Add your bio, expertise, and photo' },
    { id: 'identity_verification', title: 'Verify Identity', description: 'Upload government-issued ID' },
    { id: 'background_check', title: 'Background Check', description: 'Complete background screening' },
    { id: 'platform_orientation', title: 'Platform Training', description: 'Learn how to use MentorsMind' },
    { id: 'skill_assessment', title: 'Skill Assessment', description: 'Demonstrate your expertise' },
    { id: 'pricing_setup', title: 'Set Your Rates', description: 'Configure your pricing and availability' },
    { id: 'payment_setup', title: 'Payment Setup', description: 'Connect your Stellar wallet' },
    { id: 'first_session', title: 'Practice Session', description: 'Complete a practice mentoring session' },
    { id: 'policies_agreement', title: 'Review Policies', description: 'Accept platform terms and policies' },
    { id: 'profile_review', title: 'Profile Review', description: 'Admin review and approval' }
  ],

  /**
   * Initialize onboarding for a mentor
   */
  async initializeOnboarding(mentorId: string): Promise<MentorOnboarding> {
    try {
      // Check if onboarding already exists
      const existing = await this.getOnboarding(mentorId);
      if (existing) {
        return existing;
      }

      const { rows } = await pool.query(
        `INSERT INTO mentor_onboarding 
         (mentor_id, status, current_step, total_steps, started_at)
         VALUES ($1, 'in_progress', 1, $2, CURRENT_TIMESTAMP)
         RETURNING *`,
        [mentorId, this.ONBOARDING_STEPS.length]
      );

      logger.info("Onboarding initialized", { mentorId });

      return this.transformOnboarding(rows[0]);
    } catch (error) {
      logger.error("Failed to initialize onboarding", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor onboarding status
   */
  async getOnboarding(mentorId: string): Promise<MentorOnboarding | null> {
    try {
      const cacheKey = `onboarding:${mentorId}`;
      const cached = await CacheService.get<MentorOnboarding>(cacheKey);
      if (cached) {
        return cached;
      }

      const { rows } = await pool.query(
        'SELECT * FROM mentor_onboarding WHERE mentor_id = $1',
        [mentorId]
      );

      if (rows.length === 0) {
        return null;
      }

      const onboarding = this.transformOnboarding(rows[0]);

      // Cache for 5 minutes
      await CacheService.set(cacheKey, onboarding, 300);

      return onboarding;
    } catch (error) {
      logger.error("Failed to get onboarding", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Complete an onboarding step
   */
  async completeStep(mentorId: string, stepId: string): Promise<MentorOnboarding> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) {
        throw createError("Onboarding not found", 404);
      }

      if (onboarding.status === 'completed') {
        throw createError("Onboarding already completed", 400);
      }

      // Verify step exists
      const step = this.ONBOARDING_STEPS.find(s => s.id === stepId);
      if (!step) {
        throw createError("Invalid step ID", 400);
      }

      // Check if step already completed
      if (onboarding.stepsCompleted.includes(stepId)) {
        throw createError("Step already completed", 400);
      }

      // Add step to completed steps
      const stepsCompleted = [...onboarding.stepsCompleted, stepId];
      const currentStep = stepsCompleted.length + 1;
      const isComplete = stepsCompleted.length === this.ONBOARDING_STEPS.length;

      const { rows } = await pool.query(
        `UPDATE mentor_onboarding 
         SET steps_completed = $1,
             current_step = $2,
             status = $3,
             completed_at = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE mentor_id = $5
         RETURNING *`,
        [
          JSON.stringify(stepsCompleted),
          currentStep,
          isComplete ? 'completed' : 'in_progress',
          isComplete ? new Date() : null,
          mentorId
        ]
      );

      logger.info("Onboarding step completed", {
        mentorId,
        stepId,
        isComplete
      });

      // Invalidate cache
      await CacheService.del(`onboarding:${mentorId}`);

      return this.transformOnboarding(rows[0]);
    } catch (error) {
      logger.error("Failed to complete onboarding step", {
        mentorId,
        stepId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get onboarding progress with step details
   */
  async getOnboardingProgress(mentorId: string): Promise<any> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) {
        return null;
      }

      const steps = this.ONBOARDING_STEPS.map((step, index) => ({
        ...step,
        stepNumber: index + 1,
        isCompleted: onboarding.stepsCompleted.includes(step.id),
        isCurrent: index + 1 === onboarding.currentStep,
        isLocked: index + 1 > onboarding.currentStep
      }));

      const progressPercentage = (onboarding.stepsCompleted.length / this.ONBOARDING_STEPS.length) * 100;

      return {
        ...onboarding,
        steps,
        progressPercentage,
        nextStep: steps.find(s => s.isCurrent)
      };
    } catch (error) {
      logger.error("Failed to get onboarding progress", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Pause onboarding
   */
  async pauseOnboarding(mentorId: string, reason?: string): Promise<void> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) {
        throw createError("Onboarding not found", 404);
      }

      await pool.query(
        `UPDATE mentor_onboarding 
         SET status = 'on_hold',
             metadata = jsonb_set(metadata, '{pause_reason}', $1),
             updated_at = CURRENT_TIMESTAMP
         WHERE mentor_id = $2`,
        [JSON.stringify(reason || 'User requested'), mentorId]
      );

      logger.info("Onboarding paused", { mentorId, reason });

      // Invalidate cache
      await CacheService.del(`onboarding:${mentorId}`);
    } catch (error) {
      logger.error("Failed to pause onboarding", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Resume onboarding
   */
  async resumeOnboarding(mentorId: string): Promise<void> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) {
        throw createError("Onboarding not found", 404);
      }

      if (onboarding.status !== 'on_hold') {
        throw createError("Onboarding is not paused", 400);
      }

      await pool.query(
        `UPDATE mentor_onboarding 
         SET status = 'in_progress',
             updated_at = CURRENT_TIMESTAMP
         WHERE mentor_id = $1`,
        [mentorId]
      );

      logger.info("Onboarding resumed", { mentorId });

      // Invalidate cache
      await CacheService.del(`onboarding:${mentorId}`);
    } catch (error) {
      logger.error("Failed to resume onboarding", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get all mentors in onboarding
   */
  async getOnboardingMentors(status?: MentorOnboarding['status']): Promise<any[]> {
    try {
      let query = `
        SELECT mo.*, u.first_name, u.last_name, u.email
        FROM mentor_onboarding mo
        JOIN users u ON mo.mentor_id = u.id
      `;

      const params: any[] = [];

      if (status) {
        query += ' WHERE mo.status = $1';
        params.push(status);
      }

      query += ' ORDER BY mo.created_at DESC';

      const { rows } = await pool.query(query, params);

      return rows.map(row => ({
        ...this.transformOnboarding(row),
        mentor: {
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email
        }
      }));
    } catch (error) {
      logger.error("Failed to get onboarding mentors", {
        status,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  private transformOnboarding(row: any): MentorOnboarding {
    return {
      id: row.id,
      mentorId: row.mentor_id,
      status: row.status,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      stepsCompleted: row.steps_completed || [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};
