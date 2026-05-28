import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import {
  BackgroundCheck,
  InitiateBackgroundCheckData
} from "../models/certification.model";
import { CertificationService } from "./certification.service";

/**
 * Background Check Service
 * Manages background verification for mentors
 */
export const BackgroundCheckService = {
  /**
   * Initiate a background check
   */
  async initiateBackgroundCheck(data: InitiateBackgroundCheckData): Promise<BackgroundCheck> {
    try {
      // Verify mentor exists
      const { rows: mentorRows } = await pool.query(
        'SELECT id, role FROM users WHERE id = $1',
        [data.mentorId]
      );

      if (mentorRows.length === 0 || mentorRows[0].role !== 'mentor') {
        throw createError("Mentor not found", 404);
      }

      // Check for existing pending/in-progress check
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM background_checks 
         WHERE mentor_id = $1 AND check_type = $2 
         AND status IN ('pending', 'in_progress')`,
        [data.mentorId, data.checkType]
      );

      if (existingRows.length > 0) {
        throw createError("Background check already in progress", 409);
      }

      // Create background check record
      const { rows } = await pool.query(
        `INSERT INTO background_checks 
         (mentor_id, certification_id, provider, check_type, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [data.mentorId, data.certificationId || null, data.provider, data.checkType]
      );

      const check = this.transformBackgroundCheck(rows[0]);

      logger.info("Background check initiated", {
        checkId: check.id,
        mentorId: data.mentorId,
        checkType: data.checkType,
        provider: data.provider
      });

      // In production, this would integrate with actual background check providers
      // For now, we'll simulate the process
      this.simulateBackgroundCheck(check.id).catch(err => {
        logger.error("Background check simulation failed", { error: err });
      });

      return check;
    } catch (error) {
      logger.error("Failed to initiate background check", {
        data,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get background check by ID
   */
  async getBackgroundCheck(checkId: string): Promise<BackgroundCheck | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM background_checks WHERE id = $1',
        [checkId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformBackgroundCheck(rows[0]);
    } catch (error) {
      logger.error("Failed to get background check", {
        checkId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor background checks
   */
  async getMentorBackgroundChecks(mentorId: string): Promise<BackgroundCheck[]> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM background_checks WHERE mentor_id = $1 ORDER BY requested_at DESC',
        [mentorId]
      );

      return rows.map(row => this.transformBackgroundCheck(row));
    } catch (error) {
      logger.error("Failed to get mentor background checks", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update background check status
   */
  async updateBackgroundCheckStatus(
    checkId: string,
    status: BackgroundCheck['status'],
    result?: BackgroundCheck['result'],
    resultData?: Record<string, any>
  ): Promise<BackgroundCheck> {
    try {
      const check = await this.getBackgroundCheck(checkId);
      if (!check) {
        throw createError("Background check not found", 404);
      }

      const updates: string[] = ['status = $1'];
      const values: any[] = [status];
      let paramIndex = 2;

      if (status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }

      if (result) {
        updates.push(`result = $${paramIndex++}`);
        values.push(result);
      }

      if (resultData) {
        updates.push(`result_data = $${paramIndex++}`);
        values.push(JSON.stringify(resultData));
      }

      values.push(checkId);

      const { rows } = await pool.query(
        `UPDATE background_checks 
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      // If check is complete and linked to certification, update certification
      if (status === 'completed' && result === 'clear' && check.certificationId) {
        await CertificationService.updateCertification(
          check.certificationId,
          {
            status: 'verified',
            metadata: {
              backgroundCheckId: checkId,
              backgroundCheckResult: result,
              backgroundCheckCompletedAt: new Date().toISOString()
            }
          }
        );
      }

      logger.info("Background check updated", {
        checkId,
        status,
        result
      });

      return this.transformBackgroundCheck(rows[0]);
    } catch (error) {
      logger.error("Failed to update background check", {
        checkId,
        status,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Simulate background check (for development/testing)
   * In production, this would integrate with actual providers
   */
  private async simulateBackgroundCheck(checkId: string): Promise<void> {
    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Update to in_progress
      await this.updateBackgroundCheckStatus(checkId, 'in_progress');

      // Simulate more processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Complete with clear result (90% success rate for simulation)
      const result = Math.random() > 0.1 ? 'clear' : 'consider';
      await this.updateBackgroundCheckStatus(
        checkId,
        'completed',
        result,
        {
          simulatedCheck: true,
          completedAt: new Date().toISOString(),
          details: result === 'clear' 
            ? 'No issues found' 
            : 'Minor issues require review'
        }
      );
    } catch (error) {
      logger.error("Background check simulation failed", {
        checkId,
        error: error instanceof Error ? error.message : error
      });
    }
  },

  private transformBackgroundCheck(row: any): BackgroundCheck {
    return {
      id: row.id,
      mentorId: row.mentor_id,
      certificationId: row.certification_id,
      provider: row.provider,
      checkType: row.check_type,
      status: row.status,
      externalReferenceId: row.external_reference_id,
      result: row.result,
      resultData: row.result_data,
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
      cost: row.cost ? parseFloat(row.cost) : undefined,
      metadata: row.metadata || {}
    };
  }
};
