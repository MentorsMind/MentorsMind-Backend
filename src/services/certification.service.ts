import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import {
  MentorCertification,
  CertificationType,
  CreateCertificationData,
  UpdateCertificationData,
  MentorCertificationSummary,
  CertificationBadge
} from "../models/certification.model";

/**
 * Certification Service
 * Manages mentor certifications and verification
 */
export const CertificationService = {
  /**
   * Get all available certification types
   */
  async getCertificationTypes(activeOnly: boolean = true): Promise<CertificationType[]> {
    try {
      const cacheKey = `certification:types:${activeOnly}`;
      const cached = await CacheService.get<CertificationType[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const query = activeOnly
        ? 'SELECT * FROM certification_types WHERE is_active = true ORDER BY display_order'
        : 'SELECT * FROM certification_types ORDER BY display_order';

      const { rows } = await pool.query(query);

      const types = rows.map(row => this.transformCertificationType(row));

      // Cache for 1 hour
      await CacheService.set(cacheKey, types, 3600);

      return types;
    } catch (error) {
      logger.error("Failed to get certification types", {
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get certification type by ID
   */
  async getCertificationTypeById(typeId: string): Promise<CertificationType | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM certification_types WHERE id = $1',
        [typeId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformCertificationType(rows[0]);
    } catch (error) {
      logger.error("Failed to get certification type", {
        typeId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Create a new certification request
   */
  async createCertification(data: CreateCertificationData): Promise<MentorCertification> {
    try {
      // Verify mentor exists
      const { rows: mentorRows } = await pool.query(
        'SELECT id, role FROM users WHERE id = $1',
        [data.mentorId]
      );

      if (mentorRows.length === 0 || mentorRows[0].role !== 'mentor') {
        throw createError("Mentor not found", 404);
      }

      // Verify certification type exists
      const certType = await this.getCertificationTypeById(data.certificationTypeId);
      if (!certType) {
        throw createError("Certification type not found", 404);
      }

      // Check if certification already exists
      const { rows: existingRows } = await pool.query(
        'SELECT id FROM mentor_certifications WHERE mentor_id = $1 AND certification_type_id = $2',
        [data.mentorId, data.certificationTypeId]
      );

      if (existingRows.length > 0) {
        throw createError("Certification already exists for this mentor", 409);
      }

      // Calculate expiration date if applicable
      let expiresAt = null;
      if (certType.validityPeriodDays) {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + certType.validityPeriodDays);
        expiresAt = expirationDate;
      }

      const { rows } = await pool.query(
        `INSERT INTO mentor_certifications 
         (mentor_id, certification_type_id, status, verification_method, expires_at, metadata, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.mentorId,
          data.certificationTypeId,
          'pending',
          data.verificationMethod || null,
          expiresAt,
          JSON.stringify(data.metadata || {}),
          data.notes || null
        ]
      );

      logger.info("Certification created", {
        certificationId: rows[0].id,
        mentorId: data.mentorId,
        typeId: data.certificationTypeId
      });

      // Invalidate cache
      await this.invalidateMentorCache(data.mentorId);

      return this.transformCertification(rows[0]);
    } catch (error) {
      logger.error("Failed to create certification", {
        data,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor certifications
   */
  async getMentorCertifications(
    mentorId: string,
    includeExpired: boolean = false
  ): Promise<MentorCertification[]> {
    try {
      const cacheKey = `certification:mentor:${mentorId}:${includeExpired}`;
      const cached = await CacheService.get<MentorCertification[]>(cacheKey);
      if (cached) {
        return cached;
      }

      let query = `
        SELECT mc.*, ct.name as cert_name, ct.category, ct.badge_icon, ct.badge_color
        FROM mentor_certifications mc
        JOIN certification_types ct ON mc.certification_type_id = ct.id
        WHERE mc.mentor_id = $1
      `;

      if (!includeExpired) {
        query += ` AND mc.status != 'expired'`;
      }

      query += ` ORDER BY ct.display_order`;

      const { rows } = await pool.query(query, [mentorId]);

      const certifications = rows.map(row => this.transformCertification(row));

      // Cache for 5 minutes
      await CacheService.set(cacheKey, certifications, 300);

      return certifications;
    } catch (error) {
      logger.error("Failed to get mentor certifications", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get certification by ID
   */
  async getCertificationById(certificationId: string): Promise<MentorCertification | null> {
    try {
      const { rows } = await pool.query(
        `SELECT mc.*, ct.name as cert_name, ct.category, ct.badge_icon, ct.badge_color
         FROM mentor_certifications mc
         JOIN certification_types ct ON mc.certification_type_id = ct.id
         WHERE mc.id = $1`,
        [certificationId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformCertification(rows[0]);
    } catch (error) {
      logger.error("Failed to get certification", {
        certificationId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update certification status
   */
  async updateCertification(
    certificationId: string,
    updates: UpdateCertificationData,
    updatedBy?: string
  ): Promise<MentorCertification> {
    try {
      const existing = await this.getCertificationById(certificationId);
      if (!existing) {
        throw createError("Certification not found", 404);
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.status) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);

        // Set verified_at and verified_by if status is verified
        if (updates.status === 'verified' && updatedBy) {
          setClauses.push(`verified_at = CURRENT_TIMESTAMP`);
          setClauses.push(`verified_by = $${paramIndex++}`);
          values.push(updatedBy);
        }

        // Set revoked_at if status is revoked
        if (updates.status === 'revoked') {
          setClauses.push(`revoked_at = CURRENT_TIMESTAMP`);
        }
      }

      if (updates.score !== undefined) {
        setClauses.push(`score = $${paramIndex++}`);
        values.push(updates.score);
      }

      if (updates.metadata) {
        setClauses.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(updates.metadata));
      }

      if (updates.notes) {
        setClauses.push(`notes = $${paramIndex++}`);
        values.push(updates.notes);
      }

      if (updates.revocationReason) {
        setClauses.push(`revocation_reason = $${paramIndex++}`);
        values.push(updates.revocationReason);
      }

      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

      values.push(certificationId);

      const { rows } = await pool.query(
        `UPDATE mentor_certifications 
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      logger.info("Certification updated", {
        certificationId,
        updates,
        updatedBy
      });

      // Invalidate cache
      await this.invalidateMentorCache(existing.mentorId);

      return this.transformCertification(rows[0]);
    } catch (error) {
      logger.error("Failed to update certification", {
        certificationId,
        updates,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Revoke a certification
   */
  async revokeCertification(
    certificationId: string,
    reason: string,
    revokedBy: string
  ): Promise<void> {
    try {
      await this.updateCertification(
        certificationId,
        {
          status: 'revoked',
          revocationReason: reason
        },
        revokedBy
      );

      logger.info("Certification revoked", {
        certificationId,
        reason,
        revokedBy
      });
    } catch (error) {
      logger.error("Failed to revoke certification", {
        certificationId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor certification summary
   */
  async getMentorCertificationSummary(mentorId: string): Promise<MentorCertificationSummary> {
    try {
      const cacheKey = `certification:summary:${mentorId}`;
      const cached = await CacheService.get<MentorCertificationSummary>(cacheKey);
      if (cached) {
        return cached;
      }

      const certifications = await this.getMentorCertifications(mentorId, true);

      const totalCertifications = certifications.length;
      const verifiedCertifications = certifications.filter(c => c.status === 'verified').length;
      const pendingCertifications = certifications.filter(c => c.status === 'pending' || c.status === 'in_review').length;
      const expiredCertifications = certifications.filter(c => c.status === 'expired').length;

      // Calculate certification level
      const certificationLevel = this.calculateCertificationLevel(verifiedCertifications);

      // Calculate trust score (0-100)
      const trustScore = this.calculateTrustScore(certifications);

      // Get badges
      const badges = certifications
        .filter(c => c.status === 'verified')
        .map(c => ({
          id: c.id,
          name: c.certificationType?.name || '',
          category: c.certificationType?.category || '',
          icon: c.certificationType?.badgeIcon,
          color: c.certificationType?.badgeColor,
          verifiedAt: c.verifiedAt!,
          expiresAt: c.expiresAt
        }));

      // Find next expiring certification
      const expiringCerts = certifications
        .filter(c => c.status === 'verified' && c.expiresAt)
        .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime());

      let nextExpiringCertification = undefined;
      if (expiringCerts.length > 0) {
        const cert = expiringCerts[0];
        const daysRemaining = Math.ceil(
          (new Date(cert.expiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        nextExpiringCertification = {
          name: cert.certificationType?.name || '',
          expiresAt: cert.expiresAt!,
          daysRemaining
        };
      }

      const summary: MentorCertificationSummary = {
        mentorId,
        totalCertifications,
        verifiedCertifications,
        pendingCertifications,
        expiredCertifications,
        certificationLevel,
        trustScore,
        badges,
        nextExpiringCertification
      };

      // Cache for 10 minutes
      await CacheService.set(cacheKey, summary, 600);

      return summary;
    } catch (error) {
      logger.error("Failed to get certification summary", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Check for expiring certifications and send reminders
   */
  async checkExpiringCertifications(): Promise<void> {
    try {
      await pool.query('SELECT check_expiring_certifications()');
      logger.info("Checked expiring certifications");
    } catch (error) {
      logger.error("Failed to check expiring certifications", {
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get certifications pending review
   */
  async getPendingCertifications(limit: number = 50): Promise<MentorCertification[]> {
    try {
      const { rows } = await pool.query(
        `SELECT mc.*, ct.name as cert_name, ct.category,
                u.first_name, u.last_name, u.email
         FROM mentor_certifications mc
         JOIN certification_types ct ON mc.certification_type_id = ct.id
         JOIN users u ON mc.mentor_id = u.id
         WHERE mc.status IN ('pending', 'in_review')
         ORDER BY mc.created_at ASC
         LIMIT $1`,
        [limit]
      );

      return rows.map(row => this.transformCertification(row));
    } catch (error) {
      logger.error("Failed to get pending certifications", {
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  // Helper methods
  private transformCertificationType(row: any): CertificationType {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      requirements: row.requirements,
      validityPeriodDays: row.validity_period_days,
      isRequired: row.is_required,
      isActive: row.is_active,
      displayOrder: row.display_order,
      badgeIcon: row.badge_icon,
      badgeColor: row.badge_color,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  private transformCertification(row: any): MentorCertification {
    return {
      id: row.id,
      mentorId: row.mentor_id,
      certificationTypeId: row.certification_type_id,
      status: row.status,
      verificationMethod: row.verification_method,
      verifiedBy: row.verified_by,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revocationReason: row.revocation_reason,
      score: row.score ? parseFloat(row.score) : undefined,
      metadata: row.metadata || {},
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      certificationType: row.cert_name ? {
        id: row.certification_type_id,
        name: row.cert_name,
        category: row.category,
        badgeIcon: row.badge_icon,
        badgeColor: row.badge_color
      } as any : undefined
    };
  },

  private calculateCertificationLevel(verifiedCount: number): 'basic' | 'intermediate' | 'advanced' | 'expert' {
    if (verifiedCount >= 6) return 'expert';
    if (verifiedCount >= 4) return 'advanced';
    if (verifiedCount >= 2) return 'intermediate';
    return 'basic';
  },

  private calculateTrustScore(certifications: MentorCertification[]): number {
    let score = 0;

    // Base score for each verified certification
    const verifiedCerts = certifications.filter(c => c.status === 'verified');
    score += verifiedCerts.length * 10;

    // Bonus for required certifications
    const requiredVerified = verifiedCerts.filter(c => 
      c.certificationType && (c.certificationType as any).isRequired
    );
    score += requiredVerified.length * 5;

    // Penalty for expired certifications
    const expiredCerts = certifications.filter(c => c.status === 'expired');
    score -= expiredCerts.length * 5;

    // Penalty for revoked certifications
    const revokedCerts = certifications.filter(c => c.status === 'revoked');
    score -= revokedCerts.length * 10;

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, score));
  },

  private async invalidateMentorCache(mentorId: string): Promise<void> {
    await Promise.all([
      CacheService.del(`certification:mentor:${mentorId}:true`),
      CacheService.del(`certification:mentor:${mentorId}:false`),
      CacheService.del(`certification:summary:${mentorId}`)
    ]);
  }
};
