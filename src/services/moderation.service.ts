import pool from "../config/database";
import NodeCache from "node-cache";
import { WebhookService } from "./webhook.service";

// Simple in-memory cache with 5‑minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
import { logger } from "../utils/logger";
import { emailService } from "./email.service";

export interface FlagRecord {
  id: string;
  entity_type: "review" | "mentor_bio" | "profile_photo" | "user_profile";
  entity_id: string;
  flagger_id: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "escalated";
  reviewed_by?: string;
  reviewed_at?: Date;
  moderator_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface FlagWithDetails extends FlagRecord {
  flagger_email?: string;
  flagger_name?: string;
  content_preview?: string;
  flag_count?: number;
}

export interface ModerationStats {
  queue_size: number;
  avg_resolution_time_hours: number;
  pending_count: number;
  escalated_count: number;
  approved_count: number;
  rejected_count: number;
  avg_resolution_time_approved: number;
  avg_resolution_time_rejected: number;
  avg_resolution_time_escalated: number;
  total_processed: number;
  deletion_count: number;
}

export const ModerationService = {
  // Helper to clear all moderation-related cache entries
  clearCache() {
    cache.flushAll();
  },
  /**
   * Initialize flags table
   */
  async initialize(): Promise<void> {
    // Table is created via migration
    logger.info("Moderation service initialized");
  },

  /**
   * Flag content for moderation
   */
  async flagContent(
    entityType: string,
    entityId: string,
    flaggerId: string,
    reason: string,
  ): Promise<FlagRecord> {
    // Check if user has already flagged this entity
    const checkQuery = `
       SELECT id FROM flags
       WHERE entity_type = $1 AND entity_id = $2 AND flagger_id = $3
     `;

    const { rows } = await pool.query(checkQuery, [
      entityType,
      entityId,
      flaggerId,
    ]);

    if (rows.length > 0) {
      // User has already flagged this entity
      const error: any = new Error("User has already flagged this content");
      error.statusCode = 409;
      throw error;
    }

    const query = `
       INSERT INTO flags (entity_type, entity_id, flagger_id, reason, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *
     `;

    const { rows: insertedRows } = await pool.query<FlagRecord>(query, [
      entityType,
      entityId,
      flaggerId,
      reason,
    ]);

    const flag = insertedRows[0];

    // Check if content should be auto-hidden (3+ flags)
    await this.checkAutoHide(entityType, entityId);

    logger.info("Content flagged for moderation", {
      flagId: flag.id,
      entityType,
      entityId,
    });

    this.clearCache();
    return flag;
  },

  /**
   * Check if content should be auto-hidden due to multiple flags
   */
  async checkAutoHide(entityType: string, entityId: string): Promise<void> {
    const countQuery = `
       SELECT COUNT(DISTINCT flagger_id) as flag_count
       FROM flags
       WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending'
     `;

    const { rows } = await pool.query(countQuery, [entityType, entityId]);
    const flagCount = parseInt(rows[0].flag_count, 10);

    if (flagCount >= 3) {
      // Auto-hide content
      await this.hideContent(entityType, entityId);

      logger.warn("Content auto-hidden due to multiple flags", {
        entityType,
        entityId,
        flagCount,
      });
    }
  },

  /**
   * Hide content based on entity type
   */
  async hideContent(entityType: string, entityId: string): Promise<void> {
    if (entityType === "review") {
      await pool.query(
        `UPDATE reviews SET is_published = false WHERE id = $1`,
        [entityId],
      );
    } else if (
      ["mentor_bio", "profile_photo", "user_profile"].includes(entityType)
    ) {
      await pool.query(`UPDATE users SET profile_hidden = true WHERE id = $1`, [
        entityId,
      ]);
    } else {
      logger.warn("Unknown entity type for hiding", { entityType });
    }
  },

  /**
   * Show content based on entity type
   */
  async showContent(entityType: string, entityId: string): Promise<void> {
    if (entityType === "review") {
      await pool.query(`UPDATE reviews SET is_published = true WHERE id = $1`, [
        entityId,
      ]);
    } else if (
      ["mentor_bio", "profile_photo", "user_profile"].includes(entityType)
    ) {
      await pool.query(
        `UPDATE users SET profile_hidden = false WHERE id = $1`,
        [entityId],
      );
    } else {
      logger.warn("Unknown entity type for showing", { entityType });
    }
  },

  /**
   * Get moderation queue with pagination
   */
  async getQueue(
    limit = 50,
    offset = 0,
  ): Promise<{ data: FlagWithDetails[]; total: number }> {
    const cacheKey = `moderation_queue:${limit}:${offset}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached as { data: FlagWithDetails[]; total: number };
    }

    const query = `
      SELECT
        f.*,
        u.email as flagger_email,
        CONCAT(u.first_name, ' ', u.last_name) AS flagger_name,
        (SELECT COUNT(*) FROM flags f2
         WHERE f2.entity_type = f.entity_type
         AND f2.entity_id = f.entity_id
         AND f2.status = 'pending') as flag_count
      FROM flags f
      JOIN users u ON f.flagger_id = u.id
      WHERE f.status = 'pending'
      ORDER BY f.created_at ASC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) FROM flags WHERE status = 'pending'
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query<FlagWithDetails>(query, [limit, offset]),
      pool.query(countQuery),
    ]);

    const result = {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
    cache.set(cacheKey, result, 300); // cache for 5 minutes
    return result;
  },

  /**
   * Approve flagged content (keep visible)
   */
  async approveContent(
    flagId: string,
    reviewerId: string,
    notes?: string,
  ): Promise<FlagRecord | null> {
    const query = `
      UPDATE flags
      SET status = 'approved',
          reviewed_by = $2,
          reviewed_at = NOW(),
          moderator_notes = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const { rows } = await pool.query<FlagRecord>(query, [
      flagId,
      reviewerId,
      notes,
    ]);

    if (rows[0]) {
      // Ensure content is visible
      await this.showContent(rows[0].entity_type, rows[0].entity_id);

      logger.info("Content approved by moderator", {
        flagId,
        reviewerId,
      });
      // Clear cache after mutation
      this.clearCache();
    }

    return rows[0] || null;
  },

  /**
   * Reject flagged content (remove and notify author)
   */
  async rejectContent(
    flagId: string,
    reviewerId: string,
    notes?: string,
  ): Promise<FlagRecord | null> {
    const query = `
      UPDATE flags
      SET status = 'rejected',
          reviewed_by = $2,
          reviewed_at = NOW(),
          moderator_notes = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const { rows } = await pool.query<FlagRecord>(query, [
      flagId,
      reviewerId,
      notes,
    ]);

    if (rows[0]) {
      // Hide the content
      await this.hideContent(rows[0].entity_type, rows[0].entity_id);

      // Notify content author
      await this.notifyAuthor(rows[0], notes);

      logger.info("Content rejected by moderator", {
        flagId,
        reviewerId,
      });
      // Clear cache after mutation
      this.clearCache();
    }

    return rows[0] || null;
  },

  /**
   * Escalate flag to senior admin
   */
  async escalateFlag(
    flagId: string,
    reviewerId: string,
    notes?: string,
  ): Promise<FlagRecord | null> {
    const query = `
      UPDATE flags
      SET status = 'escalated',
          reviewed_by = $2,
          reviewed_at = NOW(),
          moderator_notes = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const { rows } = await pool.query<FlagRecord>(query, [
      flagId,
      reviewerId,
      notes,
    ]);

    if (rows[0]) {
      logger.info("Flag escalated to senior admin", {
        flagId,
        reviewerId,
      });
    }

    return rows[0] || null;
  },

  /**
   * Notify content author when their content is removed
   */
  async notifyAuthor(flag: FlagRecord, notes?: string): Promise<void> {
    try {
      // Get author email based on entity type
      let authorEmail = "";
      let authorName = "";

      if (flag.entity_type === "review") {
        const reviewQuery = `
          SELECT u.email, CONCAT(u.first_name, ' ', u.last_name) AS full_name
          FROM reviews r
          JOIN users u ON r.reviewer_id = u.id
          WHERE r.id = $1
        `;
        const { rows } = await pool.query(reviewQuery, [flag.entity_id]);
        if (rows[0]) {
          authorEmail = rows[0].email;
          authorName = rows[0].full_name;
        }
      } else {
        const userQuery = `
          SELECT email, CONCAT(first_name, ' ', last_name) AS full_name FROM users WHERE id = $1
        `;
        const { rows } = await pool.query(userQuery, [flag.entity_id]);
        if (rows[0]) {
          authorEmail = rows[0].email;
          authorName = rows[0].full_name;
        }
      }

      if (authorEmail) {
        await emailService.sendEmail({
          to: [authorEmail],
          subject: "Content Moderation Notice - MentorMinds",
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #E74C3C;">Content Moderation Notice</h2>
              <p>Hello ${authorName},</p>
              <p>Your ${flag.entity_type.replace("_", " ")} has been removed by our moderation team as it violated our community guidelines.</p>
              ${notes ? `<p><strong>Reason:</strong> ${notes}</p>` : ""}
              <p>If you believe this was done in error, please contact our support team.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />
              <p style="color: #666; font-size: 14px;">Best regards,<br>The MentorMinds Team</p>
            </div>
          `,
          textContent: `
Content Moderation Notice

Hello ${authorName},

Your ${flag.entity_type.replace("_", " ")} has been removed by our moderation team as it violated our community guidelines.

${notes ? `Reason: ${notes}` : ""}

If you believe this was done in error, please contact our support team.

Best regards,
The MentorMinds Team
          `.trim(),
        });
      }
    } catch (error) {
      logger.error("Failed to notify content author", {
        error,
        flagId: flag.id,
      });
    }
  },

  /**
   * Delete a flag (usually after resolution)
   */
  async deleteFlag(flagId: string, reviewerId: string): Promise<FlagRecord | null> {
    const query = `
      DELETE FROM flags
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query<FlagRecord>(query, [flagId]);
    if (rows[0]) {
      logger.info('Flag deleted by moderator', { flagId, reviewerId });
      // Clear cache after deletion
      this.clearCache();
    }
    return rows[0] || null;
  },

/**
   * Get moderation statistics (cached)
   */
  async getStats(): Promise<ModerationStats> {
    const cacheKey = `moderation_stats`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached as ModerationStats;
    }

    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
        COUNT(*) FILTER (WHERE status = 'escalated') as escalated_count,
        COUNT(*) FILTER (WHERE status = 'deleted') as deletion_count,
        COUNT(*) as total_processed,
        AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) FILTER (WHERE status = 'approved' AND reviewed_at IS NOT NULL) as avg_resolution_time_approved,
        AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) FILTER (WHERE status = 'rejected' AND reviewed_at IS NOT NULL) as avg_resolution_time_rejected,
        AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) FILTER (WHERE status = 'escalated' AND reviewed_at IS NOT NULL) as avg_resolution_time_escalated,
        AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) FILTER (WHERE reviewed_at IS NOT NULL) as avg_resolution_time_hours
      FROM flags
    `;

    const { rows } = await pool.query(query);
    const stats = rows[0];
    const result: ModerationStats = {
      queue_size: parseInt(stats.pending_count, 10),
      avg_resolution_time_hours: parseFloat(stats.avg_resolution_time_hours || "0"),
      pending_count: parseInt(stats.pending_count, 10),
      escalated_count: parseInt(stats.escalated_count, 10),
      approved_count: parseInt(stats.approved_count, 10),
      rejected_count: parseInt(stats.rejected_count, 10),
      deletion_count: parseInt(stats.deletion_count, 10),
      total_processed: parseInt(stats.total_processed, 10),
      avg_resolution_time_approved: parseFloat(stats.avg_resolution_time_approved || "0"),
      avg_resolution_time_rejected: parseFloat(stats.avg_resolution_time_rejected || "0"),
      avg_resolution_time_escalated: parseFloat(stats.avg_resolution_time_escalated || "0"),
    };
    cache.set(cacheKey, result, 300);
    return result;
  },
};
