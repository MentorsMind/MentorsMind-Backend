import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export interface Prerequisite {
  id: string;
  milestoneId: string;
  prerequisiteType: 'milestone' | 'skill' | 'assessment';
  prerequisiteId?: string;
  skillName?: string;
  assessmentCriteria?: Record<string, any>;
  isRequired: boolean;
  createdAt: string;
}

export interface ValidationResult {
  isValid: boolean;
  missingPrerequisites: Prerequisite[];
  overrides: PrerequisiteOverride[];
  canProceed: boolean;
  message: string;
}

export interface PrerequisiteOverride {
  id: string;
  mentorId: string;
  studentId: string;
  milestoneId: string;
  prerequisiteId: string;
  reason: string;
  overriddenAt: string;
}

export interface PrerequisiteStatus {
  prerequisite: Prerequisite;
  isMet: boolean;
  hasOverride: boolean;
  override?: PrerequisiteOverride;
  details?: string;
}

export const PrerequisiteValidatorService = {
  /**
   * Validate all prerequisites for a milestone
   */
  async validatePrerequisites(
    studentId: string,
    milestoneId: string
  ): Promise<ValidationResult> {
    const cacheKey = CacheKeys.prerequisiteValidation(studentId, milestoneId);
    
    // Try cache first
    const cached = await CacheService.get<ValidationResult>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Get all prerequisites for the milestone
    const prerequisites = await this.getMilestonePrerequisites(milestoneId);
    
    if (prerequisites.length === 0) {
      const result: ValidationResult = {
        isValid: true,
        missingPrerequisites: [],
        overrides: [],
        canProceed: true,
        message: "No prerequisites required"
      };
      
      // Cache for 5 minutes
      await CacheService.set(cacheKey, result, CacheTTL.medium);
      return result;
    }

    // Check each prerequisite
    const missingPrerequisites: Prerequisite[] = [];
    const overrides: PrerequisiteOverride[] = [];

    for (const prerequisite of prerequisites) {
      const status = await this.checkSinglePrerequisite(studentId, prerequisite);
      
      if (!status.isMet) {
        if (status.hasOverride && status.override) {
          overrides.push(status.override);
        } else if (prerequisite.isRequired) {
          missingPrerequisites.push(prerequisite);
        }
      }
    }

    // Determine if student can proceed
    const canProceed = missingPrerequisites.length === 0;
    const isValid = canProceed;

    let message = "All prerequisites met";
    if (!canProceed) {
      message = `Missing ${missingPrerequisites.length} required prerequisite(s)`;
    }
    if (overrides.length > 0) {
      message += ` (${overrides.length} override(s) applied)`;
    }

    const result: ValidationResult = {
      isValid,
      missingPrerequisites,
      overrides,
      canProceed,
      message
    };

    // Cache for 2 minutes (shorter TTL since prerequisites can change)
    await CacheService.set(cacheKey, result, CacheTTL.veryShort * 4);

    return result;
  },

  /**
   * Check access to a milestone (simpler version of validation)
   */
  async checkAccess(studentId: string, milestoneId: string): Promise<boolean> {
    const validation = await this.validatePrerequisites(studentId, milestoneId);
    return validation.canProceed;
  },

  /**
   * Create a prerequisite override (mentor only)
   */
  async overridePrerequisite(
    mentorId: string,
    studentId: string,
    milestoneId: string,
    prerequisiteId: string,
    reason: string
  ): Promise<PrerequisiteOverride> {
    // Validate mentor has access to this milestone
    const { rows: milestoneRows } = await pool.query(
      `SELECT lp.mentor_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       WHERE m.id = $1`,
      [milestoneId]
    );

    if (milestoneRows.length === 0) {
      throw createError("Milestone not found", 404);
    }

    if (milestoneRows[0].mentor_id !== mentorId) {
      throw createError("Only the mentor can override prerequisites", 403);
    }

    // Validate prerequisite exists
    const { rows: prereqRows } = await pool.query(
      `SELECT id FROM prerequisites WHERE id = $1 AND milestone_id = $2`,
      [prerequisiteId, milestoneId]
    );

    if (prereqRows.length === 0) {
      throw createError("Prerequisite not found", 404);
    }

    // Check if override already exists
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM prerequisite_overrides 
       WHERE mentor_id = $1 AND student_id = $2 AND milestone_id = $3 AND prerequisite_id = $4`,
      [mentorId, studentId, milestoneId, prerequisiteId]
    );

    if (existingRows.length > 0) {
      throw createError("Override already exists for this prerequisite", 409);
    }

    // Create override
    const { rows } = await pool.query<PrerequisiteOverride>(
      `INSERT INTO prerequisite_overrides (mentor_id, student_id, milestone_id, prerequisite_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING 
         id, mentor_id as "mentorId", student_id as "studentId",
         milestone_id as "milestoneId", prerequisite_id as "prerequisiteId",
         reason, overridden_at as "overriddenAt"`,
      [mentorId, studentId, milestoneId, prerequisiteId, reason]
    );

    const override = rows[0];

    // Invalidate prerequisite validation cache
    await this.invalidatePrerequisiteCache(studentId, milestoneId);

    logger.info("Prerequisite override created", {
      mentorId,
      studentId,
      milestoneId,
      prerequisiteId,
      reason
    });

    return override;
  },

  /**
   * Get prerequisite status for all milestones in a path
   */
  async getPrerequisiteStatus(
    studentId: string,
    pathId: string
  ): Promise<PrerequisiteStatus[]> {
    // Get all milestones in the path
    const { rows: milestones } = await pool.query(
      `SELECT id, title, order_index
       FROM milestones
       WHERE learning_path_id = $1
       ORDER BY order_index`,
      [pathId]
    );

    const statuses: PrerequisiteStatus[] = [];

    for (const milestone of milestones) {
      const prerequisites = await this.getMilestonePrerequisites(milestone.id);
      
      for (const prerequisite of prerequisites) {
        const status = await this.checkSinglePrerequisite(studentId, prerequisite);
        statuses.push(status);
      }
    }

    return statuses;
  },

  /**
   * Get all overrides for a student
   */
  async getStudentOverrides(
    studentId: string,
    pathId?: string
  ): Promise<PrerequisiteOverride[]> {
    let query = `
      SELECT 
        po.id, po.mentor_id as "mentorId", po.student_id as "studentId",
        po.milestone_id as "milestoneId", po.prerequisite_id as "prerequisiteId",
        po.reason, po.overridden_at as "overriddenAt",
        m.title as milestone_title,
        lp.title as path_title
      FROM prerequisite_overrides po
      JOIN milestones m ON po.milestone_id = m.id
      JOIN learning_paths lp ON m.learning_path_id = lp.id
      WHERE po.student_id = $1
    `;

    const params: any[] = [studentId];

    if (pathId) {
      query += ` AND lp.id = $2`;
      params.push(pathId);
    }

    query += ` ORDER BY po.overridden_at DESC`;

    const { rows } = await pool.query(query, params);

    return rows.map(row => ({
      id: row.id,
      mentorId: row.mentorId,
      studentId: row.studentId,
      milestoneId: row.milestoneId,
      prerequisiteId: row.prerequisiteId,
      reason: row.reason,
      overriddenAt: row.overriddenAt
    }));
  },

  /**
   * Remove a prerequisite override
   */
  async removeOverride(
    overrideId: string,
    mentorId: string
  ): Promise<void> {
    // Validate mentor owns this override
    const { rows } = await pool.query(
      `SELECT mentor_id, student_id, milestone_id FROM prerequisite_overrides WHERE id = $1`,
      [overrideId]
    );

    if (rows.length === 0) {
      throw createError("Override not found", 404);
    }

    if (rows[0].mentor_id !== mentorId) {
      throw createError("Only the mentor who created the override can remove it", 403);
    }

    await pool.query(`DELETE FROM prerequisite_overrides WHERE id = $1`, [overrideId]);

    // Invalidate prerequisite validation cache
    await this.invalidatePrerequisiteCache(rows[0].student_id, rows[0].milestone_id);

    logger.info("Prerequisite override removed", {
      overrideId,
      mentorId,
      studentId: rows[0].student_id,
      milestoneId: rows[0].milestone_id
    });
  },

  // Private helper methods

  private async getMilestonePrerequisites(milestoneId: string): Promise<Prerequisite[]> {
    const { rows } = await pool.query<Prerequisite>(
      `SELECT 
         id, milestone_id as "milestoneId", prerequisite_type as "prerequisiteType",
         prerequisite_id as "prerequisiteId", skill_name as "skillName",
         assessment_criteria as "assessmentCriteria", is_required as "isRequired",
         created_at as "createdAt"
       FROM prerequisites
       WHERE milestone_id = $1
       ORDER BY created_at`,
      [milestoneId]
    );

    return rows;
  },

  private async checkSinglePrerequisite(
    studentId: string,
    prerequisite: Prerequisite
  ): Promise<PrerequisiteStatus> {
    // Check for override first
    const override = await this.getPrerequisiteOverride(
      studentId,
      prerequisite.milestoneId,
      prerequisite.id
    );

    if (override) {
      return {
        prerequisite,
        isMet: true,
        hasOverride: true,
        override,
        details: `Override applied: ${override.reason}`
      };
    }

    // Check if prerequisite is actually met
    let isMet = false;
    let details = "";

    switch (prerequisite.prerequisiteType) {
      case 'milestone':
        if (prerequisite.prerequisiteId) {
          isMet = await this.checkMilestoneCompletion(studentId, prerequisite.prerequisiteId);
          details = isMet ? "Milestone completed" : "Milestone not completed";
        }
        break;

      case 'skill':
        if (prerequisite.skillName) {
          // For now, assume skill prerequisites are always met
          // This would integrate with external skill assessment systems
          isMet = true;
          details = `Skill "${prerequisite.skillName}" validated`;
        }
        break;

      case 'assessment':
        if (prerequisite.assessmentCriteria) {
          // For now, assume assessment prerequisites are always met
          // This would integrate with assessment systems
          isMet = true;
          details = "Assessment criteria met";
        }
        break;

      default:
        details = "Unknown prerequisite type";
    }

    return {
      prerequisite,
      isMet,
      hasOverride: false,
      details
    };
  },

  private async checkMilestoneCompletion(
    studentId: string,
    milestoneId: string
  ): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT mp.status
       FROM milestone_progress mp
       JOIN path_enrollments pe ON mp.enrollment_id = pe.id
       WHERE pe.student_id = $1 AND mp.milestone_id = $2`,
      [studentId, milestoneId]
    );

    return rows.length > 0 && rows[0].status === 'completed';
  },

  private async getPrerequisiteOverride(
    studentId: string,
    milestoneId: string,
    prerequisiteId: string
  ): Promise<PrerequisiteOverride | null> {
    const { rows } = await pool.query<PrerequisiteOverride>(
      `SELECT 
         id, mentor_id as "mentorId", student_id as "studentId",
         milestone_id as "milestoneId", prerequisite_id as "prerequisiteId",
         reason, overridden_at as "overriddenAt"
       FROM prerequisite_overrides
       WHERE student_id = $1 AND milestone_id = $2 AND prerequisite_id = $3`,
      [studentId, milestoneId, prerequisiteId]
    );

    return rows[0] || null;
  },

  private async invalidatePrerequisiteCache(studentId: string, milestoneId: string): Promise<void> {
    const cacheKey = CacheKeys.prerequisiteValidation(studentId, milestoneId);
    await CacheService.del(cacheKey);
    
    // Also invalidate student progress cache
    await CacheService.del(CacheKeys.studentProgress(studentId, milestoneId));
  }
};