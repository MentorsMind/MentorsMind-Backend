import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import {
  BackgroundCheck,
  InitiateBackgroundCheckData
} from "../models/certification.model";
import { CertificationService } from "./certification.service";
import { AuditLogModel } from "../models/audit-log.model";
import { BackgroundCheckAdapter } from "./background-checks/background-check.adapter";
import { CheckrBackgroundCheckAdapter } from "./background-checks/checkr.adapter";
import { MockBackgroundCheckAdapter } from "./background-checks/mock.adapter";

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
        throw createError(ErrorCode.MENTOR_NOT_FOUND, 404);
      }

      // Check for existing pending/in-progress check
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM background_checks 
         WHERE mentor_id = $1 AND check_type = $2 
         AND status IN ('pending', 'in_progress')`,
        [data.mentorId, data.checkType]
      );

      if (existingRows.length > 0) {
        throw createError(ErrorCode.BACKGROUND_CHECK_ALREADY_IN_PROGRESS, 409);
      }

      const provider = data.provider || this.getProviderName();

      // Create background check record
      const { rows } = await pool.query(
        `INSERT INTO background_checks 
         (mentor_id, certification_id, provider, check_type, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [data.mentorId, data.certificationId || null, provider, data.checkType]
      );

      const check = this.transformBackgroundCheck(rows[0]);

      logger.info("Background check initiated", {
        checkId: check.id,
        mentorId: data.mentorId,
        checkType: data.checkType,
        provider
      });

      this.initiateProviderCheck(check.id).catch(err => {
        logger.error("Background check provider initiation failed", { error: err });
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
        throw createError(ErrorCode.BACKGROUND_CHECK_NOT_FOUND, 404);
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

      await this.auditTransition(check, status, result, resultData);

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
  async simulateBackgroundCheck(checkId: string): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw createError(ErrorCode.BACKGROUND_CHECK_SIMULATION_DISABLED, 500);
    }

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

  getProviderName(): string {
    const configured = (process.env.BACKGROUND_CHECK_PROVIDER || "").toLowerCase();
    if (configured) return configured;
    return process.env.NODE_ENV === "production" ? "checkr" : "mock";
  },

  getAdapter(provider = this.getProviderName()): BackgroundCheckAdapter {
    if (provider.toLowerCase() === "checkr") {
      return new CheckrBackgroundCheckAdapter();
    }
    return new MockBackgroundCheckAdapter();
  },

  async initiateProviderCheck(checkId: string): Promise<BackgroundCheck> {
    const check = await this.getBackgroundCheck(checkId);
    if (!check) {
      throw createError(ErrorCode.BACKGROUND_CHECK_NOT_FOUND, 404);
    }

    const adapter = this.getAdapter(check.provider);
    const initiated = await adapter.initiateCheck(check.mentorId, check.checkType);

    const { rows } = await pool.query(
      `UPDATE background_checks
       SET status = 'in_progress',
           external_reference_id = $2,
           result_data = COALESCE(result_data, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
       RETURNING *`,
      [
        checkId,
        initiated.externalReferenceId,
        JSON.stringify({
          initiatedAt: new Date().toISOString(),
          provider: check.provider,
          providerResponse: initiated.raw || {},
        }),
      ],
    );

    const updated = this.transformBackgroundCheck(rows[0]);
    await this.auditTransition(check, "in_progress", undefined, initiated.raw);
    return updated;
  },

  async handleProviderWebhook(payload: any): Promise<BackgroundCheck | null> {
    const externalReferenceId =
      payload?.invitation?.id ||
      payload?.report?.id ||
      payload?.id ||
      payload?.data?.object?.id ||
      payload?.object?.id;

    if (!externalReferenceId) {
      throw createError(ErrorCode.WEBHOOK_PAYLOAD_INVALID, 400);
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM background_checks
       WHERE external_reference_id = $1
       LIMIT 1`,
      [externalReferenceId],
    );

    if (!rows[0]) {
      logger.warn("Background check webhook reference not found", { externalReferenceId });
      return null;
    }

    const check = this.transformBackgroundCheck(rows[0]);
    const adapter = this.getAdapter(check.provider);
    const mapped = {
      status: adapter instanceof CheckrBackgroundCheckAdapter
        ? adapter.mapStatus(payload?.report?.status || payload?.status || payload?.data?.object?.status)
        : "completed",
      result: adapter instanceof CheckrBackgroundCheckAdapter
        ? adapter.mapResult(payload?.report?.result || payload?.result || payload?.data?.object?.result)
        : (process.env.BACKGROUND_CHECK_MOCK_RESULT || "clear"),
    } as any;

    return this.updateBackgroundCheckStatus(
      check.id,
      mapped.status,
      mapped.result,
      { webhookPayload: payload },
    );
  },

  async pollPendingChecks(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT *
       FROM background_checks
       WHERE status IN ('pending', 'in_progress')
         AND external_reference_id IS NOT NULL
       ORDER BY requested_at ASC
       LIMIT 100`,
    );

    let updatedCount = 0;
    for (const row of rows) {
      const check = this.transformBackgroundCheck(row);
      try {
        const result = await this.getAdapter(check.provider).getCheckResult(check.externalReferenceId!);
        if (result.status !== check.status || result.result) {
          await this.updateBackgroundCheckStatus(
            check.id,
            result.status as BackgroundCheck["status"],
            result.result,
            result.raw,
          );
          updatedCount++;
        }
      } catch (error) {
        logger.error("Failed to poll background check provider", {
          checkId: check.id,
          provider: check.provider,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return updatedCount;
  },

  async auditTransition(
    previous: BackgroundCheck,
    status: BackgroundCheck["status"],
    result?: BackgroundCheck["result"],
    resultData?: Record<string, any>,
  ): Promise<void> {
    await AuditLogModel.create({
      level: "info",
      action: "background_check.transition",
      message: "Background check status transitioned",
      user_id: previous.mentorId,
      entity_type: "background_check",
      entity_id: previous.id,
      metadata: {
        previousStatus: previous.status,
        status,
        previousResult: previous.result,
        result,
        resultData,
      },
      ip_address: null,
      user_agent: null,
    });
  },

  transformBackgroundCheck(row: any): BackgroundCheck {
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
