import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import { MentorOnboarding } from "../models/certification.model";
import { RateLimiterService } from "./rate-limiter.service";
import { VerificationService } from "./verification.service";
import { BackgroundCheckService } from "./background-check.service";
import { WalletModel } from "../models/wallet.model";
import { SocketService } from "./socket.service";

export interface WizardStep {
  id: string;
  stepKey: string;
  title: string;
  description: string | null;
  category: string;
  stepOrder: number;
  isRequired: boolean;
  estimatedMinutes: number | null;
  dependsOn: string[];
  isActive: boolean;
}

export interface ProfileScore {
  totalScore: number;
  bioScore: number;
  expertiseScore: number;
  photoScore: number;
  educationScore: number;
  certificationScore: number;
  availabilityScore: number;
  pricingScore: number;
  sectionsCompleted: string[];
  missingSections: string[];
  suggestions: { section: string; suggestion: string; impact: string }[];
}

export interface SuccessChecklistItem {
  id: string;
  itemKey: string;
  title: string;
  description: string | null;
  category: string;
  isCompleted: boolean;
  completedAt: Date | null;
  sortOrder: number;
}

export interface OnboardingAnalytics {
  id: string;
  eventType: string;
  stepKey: string | null;
  metadata: any;
  occurredAt: Date;
}

interface StepDependencyFailure {
  dependency: string;
  reason: string;
}

const STEP_ALIAS_TO_WIZARD_KEY: Record<string, string> = {
  profile_setup: "profile_basics",
  first_session: "practice_session",
};

const WIZARD_KEY_TO_STEP_ALIAS: Record<string, string> = {
  profile_basics: "profile_setup",
  practice_session: "first_session",
};

/** Map of step id → named `step_*` column used for per-step completion tracking. */
const STEP_COLUMN_MAP: Record<string, string | string[]> = {
  profile_setup: 'step_profile',
  pricing_setup: ['step_rates', 'step_availability'],
  identity_verification: 'step_verification',
  first_session: 'step_first_session',
};

const ONBOARDING_COMPLETE_BADGE = {
  type: 'mentor_onboarding_complete',
  title: 'Mentor Onboarding Complete',
  description: 'Completed the full mentor onboarding flow on MentorMinds.',
  icon: 'graduation-cap',
  color: '#6366f1',
};

/** Keyed enrichment of the raw row with the canonical five named steps. */
const NAMED_STEPS = [
  { key: 'step_profile', label: 'profile' },
  { key: 'step_availability', label: 'availability' },
  { key: 'step_rates', label: 'rates' },
  { key: 'step_verification', label: 'verification' },
  { key: 'step_first_session', label: 'first_session' },
];

export const MentorOnboardingService = {
  ONBOARDING_STEPS: [
    { id: 'profile_setup', title: 'Complete Profile', description: 'Add your bio, expertise, and photo', dependsOn: [] as string[] },
    { id: 'identity_verification', title: 'Verify Identity', description: 'Upload government-issued ID', dependsOn: ['profile_setup'] },
    { id: 'background_check', title: 'Background Check', description: 'Complete background screening', dependsOn: ['identity_verification'] },
    { id: 'platform_orientation', title: 'Platform Training', description: 'Learn how to use MentorsMind', dependsOn: ['background_check'] },
    { id: 'skill_assessment', title: 'Skill Assessment', description: 'Demonstrate your expertise', dependsOn: ['platform_orientation'] },
    { id: 'pricing_setup', title: 'Set Your Rates', description: 'Configure your pricing and availability', dependsOn: ['skill_assessment'] },
    { id: 'payment_setup', title: 'Payment Setup', description: 'Connect your Stellar wallet', dependsOn: ['pricing_setup'] },
    { id: 'first_session', title: 'Practice Session', description: 'Complete a practice mentoring session', dependsOn: ['payment_setup'] },
    { id: 'policies_agreement', title: 'Review Policies', description: 'Accept platform terms and policies', dependsOn: ['first_session'] },
    { id: 'profile_review', title: 'Profile Review', description: 'Admin review and approval', dependsOn: ['policies_agreement'] },
  ],

  async initializeOnboarding(mentorId: string): Promise<MentorOnboarding> {
    try {
      const existing = await this.getOnboarding(mentorId);
      if (existing) return existing;
      const { rows } = await pool.query(
        `INSERT INTO mentor_onboarding (mentor_id, status, current_step, total_steps, started_at)
         VALUES ($1, 'in_progress', 1, $2, CURRENT_TIMESTAMP)
         RETURNING *`,
        [mentorId, this.ONBOARDING_STEPS.length],
      );
      logger.info("Onboarding initialized", { mentorId });
      await this.trackAnalytics(mentorId, 'wizard_start', null);
      return this.transformOnboarding(rows[0]);
    } catch (error) {
      logger.error("Failed to initialize onboarding", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getOnboarding(mentorId: string): Promise<MentorOnboarding | null> {
    try {
      const cacheKey = `onboarding:${mentorId}`;
      const cached = await CacheService.get<MentorOnboarding>(cacheKey);
      if (cached) return cached;

      const { rows } = await pool.query(
        'SELECT * FROM mentor_onboarding WHERE mentor_id = $1',
        [mentorId],
      );
      if (rows.length === 0) return null;

      const onboarding = this.transformOnboarding(rows[0]);
      await CacheService.set(cacheKey, onboarding, 300);
      return onboarding;
    } catch (error) {
      logger.error("Failed to get onboarding", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async completeStep(mentorId: string, stepId: string): Promise<MentorOnboarding> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) throw createError(ErrorCode.ONBOARDING_NOT_FOUND, 404);
      if (onboarding.status === 'completed') throw createError(ErrorCode.ONBOARDING_ALREADY_COMPLETED, 400);

      const step = this.ONBOARDING_STEPS.find(s => s.id === stepId);
      if (!step) throw createError(ErrorCode.ONBOARDING_STEP_INVALID, 400);
      if (onboarding.stepsCompleted.includes(stepId)) throw createError(ErrorCode.ONBOARDING_STEP_ALREADY_COMPLETED, 400);

      const rateLimit = await RateLimiterService.check(
        `mentor-onboarding:complete-step:${mentorId}`,
        60 * 60 * 1000,
        10,
      );
      if (!rateLimit.allowed) {
        throw createError(ErrorCode.ONBOARDING_RATE_LIMITED, 429, {
          limit: rateLimit.limit,
          resetTime: rateLimit.resetTime.toISOString(),
        });
      }

      const unmetDependencies = await this.getUnmetDependencies(
        mentorId,
        stepId,
        onboarding.stepsCompleted,
      );
      if (unmetDependencies.length > 0) {
        throw createError(ErrorCode.ONBOARDING_STEP_PREREQUISITES_NOT_MET, 422, {
          unmetDependencies,
        });
      }

      const stepsCompleted = [...onboarding.stepsCompleted, stepId];
      const currentStep = stepsCompleted.length + 1;
      const isComplete = stepsCompleted.length === this.ONBOARDING_STEPS.length;

      // Map a completed step to its named tracking column(s) (safe default).
      const stepColumns = STEP_COLUMN_MAP[stepId];
      const columns = Array.isArray(stepColumns) ? stepColumns : stepColumns ? [stepColumns] : [];
      const stepSetSnippet = columns.length > 0 ? columns.map((c) => `${c} = TRUE`).join(", ") + "," : "";

      const { rows } = await pool.query(
        `UPDATE mentor_onboarding
         SET steps_completed = $1, current_step = $2, status = $3, completed_at = $4, ${stepSetSnippet}
             updated_at = CURRENT_TIMESTAMP
         WHERE mentor_id = $5 RETURNING *`,
        [JSON.stringify(stepsCompleted), currentStep, isComplete ? 'completed' : 'in_progress', isComplete ? new Date() : null, mentorId],
      );

      logger.info("Onboarding step completed", { mentorId, stepId, isComplete });
      await CacheService.del(`onboarding:${mentorId}`);
      await this.trackAnalytics(mentorId, 'step_complete', stepId);
      SocketService.emitToRoom('admin', 'mentor:onboarding_step_completed', {
        mentorId,
        stepId,
        completedAt: new Date().toISOString(),
        isComplete,
        stepsCompletedCount: stepsCompleted.length,
      });

      if (isComplete) {
        await this.trackAnalytics(mentorId, 'wizard_complete', null);
        await this.initializeSuccessChecklist(mentorId);
        await this.issueCompletionBadge(mentorId);
      }

      return this.transformOnboarding(rows[0]);
    } catch (error) {
      logger.error("Failed to complete onboarding step", { mentorId, stepId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getOnboardingProgress(mentorId: string): Promise<any> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) return null;

      const steps = this.ONBOARDING_STEPS.map((step, index) => ({
        ...step,
        stepNumber: index + 1,
        isCompleted: onboarding.stepsCompleted.includes(step.id),
        isCurrent: index + 1 === onboarding.currentStep,
        isLocked: index + 1 > onboarding.currentStep,
      }));

      const progressPercentage = (onboarding.stepsCompleted.length / this.ONBOARDING_STEPS.length) * 100;

      return {
        ...onboarding,
        steps,
        progressPercentage,
        nextStep: steps.find(s => s.isCurrent),
      };
    } catch (error) {
      logger.error("Failed to get onboarding progress", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getWizardSteps(): Promise<WizardStep[]> {
    try {
      const cacheKey = 'onboarding:wizard-steps';
      const cached = await CacheService.get<WizardStep[]>(cacheKey);
      if (cached) return cached;

      const { rows } = await pool.query(
        `SELECT * FROM onboarding_wizard_steps WHERE is_active = true ORDER BY step_order`,
      );

      const steps = rows.map(r => ({
        id: r.id,
        stepKey: r.step_key,
        title: r.title,
        description: r.description,
        category: r.category,
        stepOrder: r.step_order,
        isRequired: r.is_required,
        estimatedMinutes: r.estimated_minutes,
        dependsOn: r.depends_on || [],
        isActive: r.is_active,
      }));

      await CacheService.set(cacheKey, steps, 3600);
      return steps;
    } catch (error) {
      logger.error("Failed to get wizard steps", { error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async computeProfileScore(mentorId: string): Promise<ProfileScore> {
    try {
      const { rows } = await pool.query(
        `SELECT bio, avatar_url, expertise, hourly_rate, education, years_of_experience FROM users WHERE id = $1`,
        [mentorId],
      );
      if (rows.length === 0) throw createError(ErrorCode.USER_NOT_FOUND, 404);

      const user = rows[0];
      const sectionsCompleted: string[] = [];
      const missingSections: string[] = [];
      const suggestions: { section: string; suggestion: string; impact: string }[] = [];

      let totalScore = 0;

      const bioScore = user.bio && user.bio.length > 50 ? 100 : user.bio ? 50 : 0;
      totalScore += bioScore * 0.15;
      if (bioScore < 100) {
        suggestions.push({ section: 'bio', suggestion: user.bio ? 'Expand your bio to at least 50 characters' : 'Add a professional bio', impact: 'Improves mentor discoverability by 40%' });
        if (bioScore === 0) missingSections.push('bio');
      }
      sectionsCompleted.push('bio');

      const photoScore = user.avatar_url ? 100 : 0;
      totalScore += photoScore * 0.15;
      if (photoScore === 0) {
        suggestions.push({ section: 'photo', suggestion: 'Upload a professional profile photo', impact: 'Profiles with photos get 70% more session requests' });
        missingSections.push('photo');
      }
      sectionsCompleted.push('photo');

      const expertiseScore = user.expertise && Array.isArray(user.expertise) && user.expertise.length > 0 ? Math.min(user.expertise.length * 25, 100) : 0;
      totalScore += expertiseScore * 0.2;
      if (expertiseScore < 50) {
        suggestions.push({ section: 'expertise', suggestion: 'Add at least 2 areas of expertise', impact: 'Matches with more students searching for your skills' });
        if (expertiseScore === 0) missingSections.push('expertise');
      }
      sectionsCompleted.push('expertise');

      const pricingScore = user.hourly_rate && user.hourly_rate > 0 ? 100 : 0;
      totalScore += pricingScore * 0.1;
      if (pricingScore === 0) {
        suggestions.push({ section: 'pricing', suggestion: 'Set your hourly rate', impact: 'Required to start receiving bookings' });
        missingSections.push('pricing');
      }
      sectionsCompleted.push('pricing');

      const educationScore = user.education ? 100 : 0;
      totalScore += educationScore * 0.1;
      if (educationScore === 0) {
        suggestions.push({ section: 'education', suggestion: 'Add your educational background', impact: 'Builds trust with potential students' });
        if (missingSections.indexOf('education') === -1) missingSections.push('education');
      }
      sectionsCompleted.push('education');

      const { rows: certRows } = await pool.query(
        `SELECT COUNT(*)::INTEGER as count FROM mentor_certifications WHERE mentor_id = $1 AND status = 'verified'`,
        [mentorId],
      );
      const certificationScore = Math.min((certRows[0]?.count || 0) * 20, 100);
      totalScore += certificationScore * 0.15;
      if (certificationScore < 40) {
        suggestions.push({ section: 'certification', suggestion: 'Get at least 2 certifications verified', impact: 'Verified mentors earn 3x more on average' });
      }
      sectionsCompleted.push('certification');

      const { rows: availRows } = await pool.query(
        `SELECT COUNT(*)::INTEGER as count FROM bookings WHERE mentor_id = $1 AND status = 'confirmed'`,
        [mentorId],
      );
      const availabilityScore = (availRows[0]?.count || 0) > 0 ? 100 : 50;
      totalScore += availabilityScore * 0.1;
      sectionsCompleted.push('availability');

      totalScore = Math.round(totalScore);

      const score: ProfileScore = {
        totalScore,
        bioScore,
        expertiseScore,
        photoScore,
        educationScore,
        certificationScore,
        availabilityScore,
        pricingScore,
        sectionsCompleted,
        missingSections,
        suggestions,
      };

      await pool.query(
        `INSERT INTO mentor_profile_scores (mentor_id, total_score, bio_score, expertise_score, photo_score, education_score, certification_score, availability_score, pricing_score, sections_completed, missing_sections, suggestions, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         ON CONFLICT (mentor_id) DO UPDATE SET
           total_score = EXCLUDED.total_score, bio_score = EXCLUDED.bio_score, expertise_score = EXCLUDED.expertise_score,
           photo_score = EXCLUDED.photo_score, education_score = EXCLUDED.education_score,
           certification_score = EXCLUDED.certification_score, availability_score = EXCLUDED.availability_score,
           pricing_score = EXCLUDED.pricing_score, sections_completed = EXCLUDED.sections_completed,
           missing_sections = EXCLUDED.missing_sections, suggestions = EXCLUDED.suggestions,
           computed_at = CURRENT_TIMESTAMP`,
        [mentorId, score.totalScore, score.bioScore, score.expertiseScore, score.photoScore, score.educationScore, score.certificationScore, score.availabilityScore, score.pricingScore, score.sectionsCompleted, score.missingSections, JSON.stringify(score.suggestions)],
      );

      return score;
    } catch (error) {
      logger.error("Failed to compute profile score", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getProfileScore(mentorId: string): Promise<ProfileScore | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM mentor_profile_scores WHERE mentor_id = $1`,
        [mentorId],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        totalScore: parseFloat(r.total_score),
        bioScore: parseFloat(r.bio_score),
        expertiseScore: parseFloat(r.expertise_score),
        photoScore: parseFloat(r.photo_score),
        educationScore: parseFloat(r.education_score),
        certificationScore: parseFloat(r.certification_score),
        availabilityScore: parseFloat(r.availability_score),
        pricingScore: parseFloat(r.pricing_score),
        sectionsCompleted: r.sections_completed || [],
        missingSections: r.missing_sections || [],
        suggestions: r.suggestions || [],
      };
    } catch (error) {
      logger.error("Failed to get profile score", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getOptimizationSuggestions(mentorId: string): Promise<any[]> {
    try {
      const score = await this.computeProfileScore(mentorId);
      return score.suggestions.map((s, i) => ({
        id: `suggestion-${i + 1}`,
        ...s,
        priority: i < 2 ? 'high' : i < 4 ? 'medium' : 'low',
      }));
    } catch (error) {
      logger.error("Failed to get optimization suggestions", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getEmailSequences(): Promise<any[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM onboarding_email_sequences WHERE is_active = true ORDER BY delay_minutes`,
      );
      return rows;
    } catch (error) {
      logger.error("Failed to get email sequences", { error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async initializeSuccessChecklist(mentorId: string): Promise<void> {
    try {
      const checklistItems = [
        { key: 'first_session', title: 'Complete your first mentoring session', description: 'Book and complete your first paid session', category: 'session', order: 1 },
        { key: 'first_review', title: 'Get your first review', description: 'Receive your first student review', category: 'session', order: 2 },
        { key: 'five_sessions', title: 'Complete 5 sessions', description: 'Reach 5 completed mentoring sessions', category: 'session', order: 3 },
        { key: 'profile_complete_90', title: 'Achieve 90% profile score', description: 'Complete your profile to 90% or higher', category: 'profile', order: 4 },
        { key: 'first_earning', title: 'First payout received', description: 'Receive your first mentorship payout', category: 'earning', order: 5 },
        { key: 'certification', title: 'Get certified', description: 'Obtain your first mentor certification', category: 'growth', order: 6 },
        { key: 'referral', title: 'Refer a mentor', description: 'Refer another expert to become a mentor', category: 'growth', order: 7 },
        { key: 'ten_sessions', title: 'Complete 10 sessions', description: 'Reach 10 completed mentoring sessions', category: 'session', order: 8 },
      ];

      for (const item of checklistItems) {
        await pool.query(
          `INSERT INTO mentor_success_checklist (mentor_id, item_key, title, description, category, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (mentor_id, item_key) DO NOTHING`,
          [mentorId, item.key, item.title, item.description, item.category, item.order],
        );
      }
    } catch (error) {
      logger.error("Failed to initialize success checklist", { mentorId, error: error instanceof Error ? error.message : error });
    }
  },

  async getSuccessChecklist(mentorId: string): Promise<SuccessChecklistItem[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM mentor_success_checklist WHERE mentor_id = $1 ORDER BY sort_order`,
        [mentorId],
      );
      return rows.map(r => ({
        id: r.id,
        itemKey: r.item_key,
        title: r.title,
        description: r.description,
        category: r.category,
        isCompleted: r.is_completed,
        completedAt: r.completed_at,
        sortOrder: r.sort_order,
      }));
    } catch (error) {
      logger.error("Failed to get success checklist", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async completeChecklistItem(mentorId: string, itemKey: string): Promise<void> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE mentor_success_checklist SET is_completed = true, completed_at = CURRENT_TIMESTAMP WHERE mentor_id = $1 AND item_key = $2`,
        [mentorId, itemKey],
      );
      if (rowCount === 0) throw createError(ErrorCode.CHECKLIST_ITEM_NOT_FOUND, 404);
    } catch (error) {
      logger.error("Failed to complete checklist item", { mentorId, itemKey, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async trackAnalytics(mentorId: string, eventType: string, stepKey: string | null, metadata?: any): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO onboarding_analytics (mentor_id, event_type, step_key, metadata)
         VALUES ($1, $2, $3, $4)`,
        [mentorId, eventType, stepKey, JSON.stringify(metadata || {})],
      );
    } catch (error) {
      logger.error("Failed to track onboarding analytics", { mentorId, eventType, error: error instanceof Error ? error.message : error });
    }
  },

  async getOnboardingAnalytics(mentorId: string): Promise<any> {
    try {
      const [stepsRes, timeRes, emailRes] = await Promise.all([
        pool.query(
          `SELECT event_type, step_key, COUNT(*)::INTEGER as count, MIN(occurred_at) as first_seen, MAX(occurred_at) as last_seen
           FROM onboarding_analytics WHERE mentor_id = $1 GROUP BY event_type, step_key ORDER BY first_seen`,
          [mentorId],
        ),
        pool.query(
          `SELECT EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) / 86400 as days_in_onboarding
           FROM onboarding_analytics WHERE mentor_id = $1 AND event_type IN ('wizard_start', 'wizard_complete')`,
          [mentorId],
        ),
        pool.query(
          `SELECT COUNT(*)::INTEGER as email_sent FROM onboarding_analytics WHERE mentor_id = $1 AND event_type = 'email_sent'`,
          [mentorId],
        ),
      ]);

      return {
        events: stepsRes.rows,
        daysInOnboarding: timeRes.rows[0]?.days_in_onboarding ? Math.round(parseFloat(timeRes.rows[0].days_in_onboarding) * 10) / 10 : null,
        emailsSent: emailRes.rows[0]?.email_sent || 0,
      };
    } catch (error) {
      logger.error("Failed to get onboarding analytics", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async pauseOnboarding(mentorId: string, reason?: string): Promise<void> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) throw createError(ErrorCode.ONBOARDING_NOT_FOUND, 404);

      await pool.query(
        `UPDATE mentor_onboarding SET status = 'on_hold', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pause_reason}', $1), updated_at = CURRENT_TIMESTAMP WHERE mentor_id = $2`,
        [JSON.stringify(reason || 'User requested'), mentorId],
      );

      logger.info("Onboarding paused", { mentorId, reason });
      await CacheService.del(`onboarding:${mentorId}`);
    } catch (error) {
      logger.error("Failed to pause onboarding", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async resumeOnboarding(mentorId: string): Promise<void> {
    try {
      const onboarding = await this.getOnboarding(mentorId);
      if (!onboarding) throw createError(ErrorCode.ONBOARDING_NOT_FOUND, 404);
      if (onboarding.status !== 'on_hold') throw createError(ErrorCode.ONBOARDING_NOT_PAUSED, 400);

      await pool.query(
        `UPDATE mentor_onboarding SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE mentor_id = $1`,
        [mentorId],
      );

      logger.info("Onboarding resumed", { mentorId });
      await CacheService.del(`onboarding:${mentorId}`);
    } catch (error) {
      logger.error("Failed to resume onboarding", { mentorId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

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
        mentor: { firstName: row.first_name, lastName: row.last_name, email: row.email },
      }));
    } catch (error) {
      logger.error("Failed to get onboarding mentors", { status, error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getAdminAnalytics(): Promise<any> {
    try {
      const [statusRes, avgTimeRes, completionRes] = await Promise.all([
        pool.query(
          `SELECT status, COUNT(*)::INTEGER as count FROM mentor_onboarding GROUP BY status`,
        ),
        pool.query(
          `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400)::NUMERIC(10,1) as avg_days
           FROM mentor_onboarding WHERE status = 'completed' AND completed_at IS NOT NULL AND started_at IS NOT NULL`,
        ),
        pool.query(
          `SELECT DATE_TRUNC('week', created_at)::DATE as week, COUNT(*)::INTEGER as started, COUNT(*) FILTER (WHERE status = 'completed')::INTEGER as completed
           FROM mentor_onboarding WHERE created_at > NOW() - INTERVAL '90 days' GROUP BY week ORDER BY week`,
        ),
      ]);

      return {
        statusBreakdown: statusRes.rows,
        averageCompletionDays: avgTimeRes.rows[0]?.avg_days || null,
        weeklyTrend: completionRes.rows,
      };
    } catch (error) {
      logger.error("Failed to get admin analytics", { error: error instanceof Error ? error.message : error });
      throw error;
    }
  },

  async getUnmetDependencies(
    mentorId: string,
    stepId: string,
    stepsCompleted: string[],
  ): Promise<StepDependencyFailure[]> {
    const unmetDependencies: StepDependencyFailure[] = [];
    const requiredDependencies = await this.getStepDependencies(stepId);

    for (const dependency of requiredDependencies) {
      if (!stepsCompleted.includes(dependency)) {
        unmetDependencies.push({
          dependency,
          reason: `Complete ${dependency} before marking ${stepId} as done.`,
        });
      }
    }

    if (stepId === 'identity_verification') {
      const verification = await VerificationService.getStatusByMentorId(mentorId);
      if (!verification || verification.status !== 'approved') {
        unmetDependencies.push({
          dependency: 'identity_verification',
          reason: 'An approved mentor_verifications record is required.',
        });
      }
    }

    if (stepId === 'background_check') {
      const backgroundChecks = await BackgroundCheckService.getMentorBackgroundChecks(mentorId);
      const hasClearBackgroundCheck = backgroundChecks.some(
        (check) => check.status === 'completed' && check.result === 'clear',
      );
      if (!hasClearBackgroundCheck) {
        unmetDependencies.push({
          dependency: 'background_check',
          reason: 'A completed background check with result "clear" is required.',
        });
      }
    }

    if (stepId === 'payment_setup') {
      const wallet = await WalletModel.findByUserId(mentorId);
      if (!wallet || wallet.status !== 'active') {
        unmetDependencies.push({
          dependency: 'payment_setup',
          reason: 'An active wallet record is required before payment setup can be completed.',
        });
      }
    }

    return unmetDependencies;
  },

  async getStepDependencies(stepId: string): Promise<string[]> {
    const staticStep = this.ONBOARDING_STEPS.find((step) => step.id === stepId);
    const staticDependencies = staticStep?.dependsOn ?? [];
    const knownStepIds = new Set(this.ONBOARDING_STEPS.map((step) => step.id));
    const wizardStepKey = STEP_ALIAS_TO_WIZARD_KEY[stepId] ?? stepId;

    try {
      const wizardSteps = await this.getWizardSteps();
      const wizardStep = wizardSteps.find((step) => step.stepKey === wizardStepKey);
      if (!wizardStep) return staticDependencies;

      const mappedWizardDependencies = wizardStep.dependsOn
        .map((dependency) => WIZARD_KEY_TO_STEP_ALIAS[dependency] ?? dependency)
        .filter((dependency) => knownStepIds.has(dependency));

      return Array.from(new Set([...staticDependencies, ...mappedWizardDependencies]));
    } catch (error) {
      logger.warn("Falling back to static onboarding dependencies", {
        stepId,
        error: error instanceof Error ? error.message : error,
      });
      return staticDependencies;
    }
  },

  transformOnboarding(row: any): MentorOnboarding {
    const steps = NAMED_STEPS.map(({ key, label }) => Boolean(row[key])).map(
      (completed) => completed,
    );
    const namedSteps = Object.fromEntries(
      NAMED_STEPS.map(({ key, label }) => [label, Boolean(row[key])]),
    );

    return {
      id: row.id,
      mentorId: row.mentor_id,
      status: row.status,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      stepsCompleted: row.steps_completed || [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      metadata: {
        ...(row.metadata || {}),
        namedSteps,
        nudge24hSent: Boolean(row.nudge_24h_sent),
        nudge72hSent: Boolean(row.nudge_72h_sent),
        nudge7dSent: Boolean(row.nudge_7d_sent),
        badgeIssuedAt: row.badge_issued_at ?? null,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  /**
   * Issue the onboarding-completion badge for a mentor (idempotent).
   * Called automatically when the final onboarding step is completed.
   */
  async issueCompletionBadge(mentorId: string): Promise<boolean> {
    try {
      await pool.query(
        `UPDATE mentor_onboarding
         SET badge_issued_at = NOW(), updated_at = NOW()
         WHERE mentor_id = $1`,
        [mentorId],
      );
      const { rowCount } = await pool.query(
        `INSERT INTO mentor_badges (mentor_id, badge_type, title, description, icon, color)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (mentor_id, badge_type) DO NOTHING`,
        [
          mentorId,
          ONBOARDING_COMPLETE_BADGE.type,
          ONBOARDING_COMPLETE_BADGE.title,
          ONBOARDING_COMPLETE_BADGE.description,
          ONBOARDING_COMPLETE_BADGE.icon,
          ONBOARDING_COMPLETE_BADGE.color,
        ],
      );
      logger.info("Onboarding completion badge issued", { mentorId });
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to issue onboarding badge", {
        mentorId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  },

  /**
   * List badges a mentor has earned (onboarding completion first).
   */
  async getBadges(mentorId: string): Promise<any[]> {
    try {
      const { rows } = await pool.query(
        `SELECT badge_type, title, description, icon, color, issued_at
         FROM mentor_badges
         WHERE mentor_id = $1
         ORDER BY issued_at DESC`,
        [mentorId],
      );
      return rows;
    } catch (error) {
      logger.error("Failed to get mentor badges", {
        mentorId,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  },

  /**
   * Queue a nudge email for mentors who are mid-onboarding.
   * Delegates to the onboarding-nudge worker via enqueue. Enqueues the
   * recurring job onto its dedicated queue (idempotent at job level).
   */
  async triggerNudgeScan(): Promise<void> {
    const { onboardingNudgeQueue } = await import("../queues/onboarding-nudge.queue");
    await onboardingNudgeQueue.add(
      "onboarding-nudge-scan",
      { jobType: "onboarding-nudge", triggeredAt: new Date().toISOString() },
      { removeOnComplete: { count: 50 } },
    );
  },

  /**
   * Admin funnel analytics — drop-off points across the named onboarding steps.
   * Reports how many mentors completed each named step out of all who started.
   */
  async getAdminFunnelAnalytics(): Promise<any> {
    try {
      const [startedRes, completeRes, namedRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::INTEGER AS total FROM mentor_onboarding WHERE status != 'not_started'`,
        ),
        pool.query(
          `SELECT COUNT(*)::INTEGER AS completed FROM mentor_onboarding WHERE status = 'completed'`,
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE step_profile)       AS profile,
             COUNT(*) FILTER (WHERE step_availability)  AS availability,
             COUNT(*) FILTER (WHERE step_rates)         AS rates,
             COUNT(*) FILTER (WHERE step_verification)  AS verification,
             COUNT(*) FILTER (WHERE step_first_session) AS first_session
           FROM mentor_onboarding WHERE status != 'not_started'`,
        ),
      ]);

      const total = startedRes.rows[0]?.total ?? 0;
      const completed = completeRes.rows[0]?.completed ?? 0;
      const named = namedRes.rows[0] ?? {};

      const funnel = NAMED_STEPS.map(({ key, label }) => {
        const count = named[label] ?? 0;
        return {
          step: label,
          completed: count,
          dropOff: total - count,
          completionRate: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
        };
      });

      return {
        started: total,
        completed,
        overallCompletionRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
        funnel,
      };
    } catch (error) {
      logger.error("Failed to get onboarding funnel analytics", {
        error: error instanceof Error ? error.message : error,
      });
      return { started: 0, completed: 0, overallCompletionRate: 0, funnel: [] };
    }
  },
};
