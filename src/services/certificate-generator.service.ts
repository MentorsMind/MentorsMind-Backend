import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import crypto from "crypto";

export interface CompletionCertificate {
  id: string;
  enrollmentId?: string;
  milestoneId?: string;
  certificateType: 'milestone' | 'path';
  certificateData: CertificateData;
  verificationHash: string;
  blockchainTxHash?: string;
  issuedAt: string;
  expiresAt?: string;
  isRevoked: boolean;
  revokedAt?: string;
  revocationReason?: string;
}

export interface CertificateData {
  studentName: string;
  studentId: string;
  mentorName: string;
  mentorId: string;
  pathTitle?: string;
  milestoneTitle?: string;
  completionDate: string;
  skills: string[];
  achievements: string[];
  verificationUrl: string;
  certificateNumber: string;
  issuerName: string;
  issuerLogo?: string;
  customDesign?: CertificateDesign;
  metadata: Record<string, any>;
}

export interface CertificateDesign {
  templateId: string;
  backgroundColor: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoUrl?: string;
  borderStyle: 'none' | 'simple' | 'decorative';
  layout: 'classic' | 'modern' | 'minimal';
  includeQRCode: boolean;
  includeSignature: boolean;
}

export interface CertificateTemplate {
  id: string;
  name: string;
  description: string;
  design: CertificateDesign;
  isDefault: boolean;
  isPublic: boolean;
  createdBy?: string;
  previewUrl: string;
}

export interface BlockchainVerification {
  txHash: string;
  blockNumber: number;
  timestamp: string;
  contractAddress: string;
  verificationData: Record<string, any>;
}

export const CertificateGeneratorService = {
  /**
   * Generate certificate for milestone completion
   */
  async generateMilestoneCertificate(
    enrollmentId: string,
    milestoneId: string,
    customDesign?: Partial<CertificateDesign>
  ): Promise<CompletionCertificate> {
    // Get enrollment and milestone details
    const { rows } = await pool.query(
      `SELECT 
         pe.id as enrollment_id, pe.student_id, pe.completed_at,
         lp.id as path_id, lp.title as path_title, lp.mentor_id,
         m.id as milestone_id, m.title as milestone_title, m.learning_objectives,
         u_student.first_name as student_first_name, u_student.last_name as student_last_name,
         u_mentor.first_name as mentor_first_name, u_mentor.last_name as mentor_last_name,
         mp.completed_at as milestone_completed_at
       FROM path_enrollments pe
       JOIN learning_paths lp ON pe.learning_path_id = lp.id
       JOIN milestones m ON m.learning_path_id = lp.id
       JOIN users u_student ON pe.student_id = u_student.id
       JOIN users u_mentor ON lp.mentor_id = u_mentor.id
       JOIN milestone_progress mp ON mp.enrollment_id = pe.id AND mp.milestone_id = m.id
       WHERE pe.id = $1 AND m.id = $2 AND mp.status = 'completed'`,
      [enrollmentId, milestoneId]
    );

    if (rows.length === 0) {
      throw createError("Milestone not completed or enrollment not found", 404);
    }

    const data = rows[0];

    // Check if certificate already exists
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM completion_certificates 
       WHERE milestone_id = $1 AND certificate_type = 'milestone'
       AND (certificate_data->>'studentId')::text = $2`,
      [milestoneId, data.student_id]
    );

    if (existingRows.length > 0) {
      throw createError("Certificate already exists for this milestone", 409);
    }

    // Generate certificate data
    const certificateNumber = this.generateCertificateNumber();
    const verificationHash = this.generateVerificationHash(data.student_id, milestoneId, certificateNumber);
    const verificationUrl = `${process.env.FRONTEND_URL}/verify/${verificationHash}`;

    const certificateData: CertificateData = {
      studentName: `${data.student_first_name} ${data.student_last_name}`,
      studentId: data.student_id,
      mentorName: `${data.mentor_first_name} ${data.mentor_last_name}`,
      mentorId: data.mentor_id,
      pathTitle: data.path_title,
      milestoneTitle: data.milestone_title,
      completionDate: data.milestone_completed_at,
      skills: data.learning_objectives || [],
      achievements: [`Completed ${data.milestone_title}`],
      verificationUrl,
      certificateNumber,
      issuerName: "MentorsMind Platform",
      customDesign: customDesign ? { ...this.getDefaultDesign(), ...customDesign } : this.getDefaultDesign(),
      metadata: {
        pathId: data.path_id,
        milestoneId: data.milestone_id,
        enrollmentId: data.enrollment_id,
        generatedAt: new Date().toISOString()
      }
    };

    // Create certificate record
    const { rows: certRows } = await pool.query<CompletionCertificate>(
      `INSERT INTO completion_certificates (
         milestone_id, certificate_type, certificate_data, verification_hash
       ) VALUES ($1, 'milestone', $2, $3)
       RETURNING 
         id, milestone_id as "milestoneId", certificate_type as "certificateType",
         certificate_data as "certificateData", verification_hash as "verificationHash",
         blockchain_tx_hash as "blockchainTxHash", issued_at as "issuedAt",
         expires_at as "expiresAt", is_revoked as "isRevoked",
         revoked_at as "revokedAt", revocation_reason as "revocationReason"`,
      [milestoneId, JSON.stringify(certificateData), verificationHash]
    );

    const certificate = certRows[0];

    // Attempt blockchain verification (if configured)
    try {
      const blockchainTx = await this.recordOnBlockchain(certificate);
      if (blockchainTx) {
        await pool.query(
          `UPDATE completion_certificates 
           SET blockchain_tx_hash = $1 
           WHERE id = $2`,
          [blockchainTx.txHash, certificate.id]
        );
        certificate.blockchainTxHash = blockchainTx.txHash;
      }
    } catch (error) {
      logger.warn("Blockchain verification failed for certificate", { 
        certificateId: certificate.id, 
        error 
      });
    }

    logger.info("Milestone certificate generated", {
      certificateId: certificate.id,
      milestoneId,
      studentId: data.student_id,
      verificationHash
    });

    return certificate;
  },

  /**
   * Generate certificate for learning path completion
   */
  async generatePathCertificate(
    enrollmentId: string,
    customDesign?: Partial<CertificateDesign>
  ): Promise<CompletionCertificate> {
    // Get enrollment details
    const { rows } = await pool.query(
      `SELECT 
         pe.id as enrollment_id, pe.student_id, pe.completed_at,
         lp.id as path_id, lp.title as path_title, lp.mentor_id, lp.tags,
         u_student.first_name as student_first_name, u_student.last_name as student_last_name,
         u_mentor.first_name as mentor_first_name, u_mentor.last_name as mentor_last_name,
         COUNT(m.id) as total_milestones,
         COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed_milestones
       FROM path_enrollments pe
       JOIN learning_paths lp ON pe.learning_path_id = lp.id
       JOIN users u_student ON pe.student_id = u_student.id
       JOIN users u_mentor ON lp.mentor_id = u_mentor.id
       LEFT JOIN milestones m ON m.learning_path_id = lp.id
       LEFT JOIN milestone_progress mp ON mp.enrollment_id = pe.id AND mp.milestone_id = m.id
       WHERE pe.id = $1 AND pe.status = 'completed'
       GROUP BY pe.id, lp.id, u_student.id, u_mentor.id`,
      [enrollmentId]
    );

    if (rows.length === 0) {
      throw createError("Learning path not completed or enrollment not found", 404);
    }

    const data = rows[0];

    // Verify all milestones are completed
    if (parseInt(data.total_milestones) !== parseInt(data.completed_milestones)) {
      throw createError("All milestones must be completed before generating path certificate", 400);
    }

    // Check if certificate already exists
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM completion_certificates 
       WHERE enrollment_id = $1 AND certificate_type = 'path'`,
      [enrollmentId]
    );

    if (existingRows.length > 0) {
      throw createError("Certificate already exists for this learning path", 409);
    }

    // Get completed milestones for achievements
    const { rows: milestoneRows } = await pool.query(
      `SELECT m.title, m.learning_objectives
       FROM milestones m
       JOIN milestone_progress mp ON m.id = mp.milestone_id
       WHERE mp.enrollment_id = $1 AND mp.status = 'completed'
       ORDER BY m.order_index`,
      [enrollmentId]
    );

    const skills = [...new Set(milestoneRows.flatMap(m => m.learning_objectives || []))];
    const achievements = milestoneRows.map(m => `Completed ${m.title}`);

    // Generate certificate data
    const certificateNumber = this.generateCertificateNumber();
    const verificationHash = this.generateVerificationHash(data.student_id, data.path_id, certificateNumber);
    const verificationUrl = `${process.env.FRONTEND_URL}/verify/${verificationHash}`;

    const certificateData: CertificateData = {
      studentName: `${data.student_first_name} ${data.student_last_name}`,
      studentId: data.student_id,
      mentorName: `${data.mentor_first_name} ${data.mentor_last_name}`,
      mentorId: data.mentor_id,
      pathTitle: data.path_title,
      completionDate: data.completed_at,
      skills,
      achievements,
      verificationUrl,
      certificateNumber,
      issuerName: "MentorsMind Platform",
      customDesign: customDesign ? { ...this.getDefaultDesign(), ...customDesign } : this.getDefaultDesign(),
      metadata: {
        pathId: data.path_id,
        enrollmentId: data.enrollment_id,
        totalMilestones: parseInt(data.total_milestones),
        completedMilestones: parseInt(data.completed_milestones),
        tags: data.tags || [],
        generatedAt: new Date().toISOString()
      }
    };

    // Create certificate record
    const { rows: certRows } = await pool.query<CompletionCertificate>(
      `INSERT INTO completion_certificates (
         enrollment_id, certificate_type, certificate_data, verification_hash
       ) VALUES ($1, 'path', $2, $3)
       RETURNING 
         id, enrollment_id as "enrollmentId", certificate_type as "certificateType",
         certificate_data as "certificateData", verification_hash as "verificationHash",
         blockchain_tx_hash as "blockchainTxHash", issued_at as "issuedAt",
         expires_at as "expiresAt", is_revoked as "isRevoked",
         revoked_at as "revokedAt", revocation_reason as "revocationReason"`,
      [enrollmentId, JSON.stringify(certificateData), verificationHash]
    );

    const certificate = certRows[0];

    // Attempt blockchain verification (if configured)
    try {
      const blockchainTx = await this.recordOnBlockchain(certificate);
      if (blockchainTx) {
        await pool.query(
          `UPDATE completion_certificates 
           SET blockchain_tx_hash = $1 
           WHERE id = $2`,
          [blockchainTx.txHash, certificate.id]
        );
        certificate.blockchainTxHash = blockchainTx.txHash;
      }
    } catch (error) {
      logger.warn("Blockchain verification failed for certificate", { 
        certificateId: certificate.id, 
        error 
      });
    }

    logger.info("Path certificate generated", {
      certificateId: certificate.id,
      pathId: data.path_id,
      studentId: data.student_id,
      verificationHash
    });

    return certificate;
  },

  /**
   * Verify certificate authenticity
   */
  async verifyCertificate(verificationHash: string): Promise<{
    isValid: boolean;
    certificate?: CompletionCertificate;
    blockchainVerification?: BlockchainVerification;
    error?: string;
  }> {
    const cacheKey = `certificate_verification:${verificationHash}`;
    
    // Try cache first
    const cached = await CacheService.get<any>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { rows } = await pool.query<CompletionCertificate>(
      `SELECT 
         id, enrollment_id as "enrollmentId", milestone_id as "milestoneId",
         certificate_type as "certificateType", certificate_data as "certificateData",
         verification_hash as "verificationHash", blockchain_tx_hash as "blockchainTxHash",
         issued_at as "issuedAt", expires_at as "expiresAt", is_revoked as "isRevoked",
         revoked_at as "revokedAt", revocation_reason as "revocationReason"
       FROM completion_certificates
       WHERE verification_hash = $1`,
      [verificationHash]
    );

    if (rows.length === 0) {
      const result = { isValid: false, error: "Certificate not found" };
      await CacheService.set(cacheKey, result, CacheTTL.medium);
      return result;
    }

    const certificate = rows[0];

    // Check if certificate is revoked
    if (certificate.isRevoked) {
      const result = { 
        isValid: false, 
        certificate, 
        error: `Certificate revoked: ${certificate.revocationReason}` 
      };
      await CacheService.set(cacheKey, result, CacheTTL.medium);
      return result;
    }

    // Check if certificate is expired
    if (certificate.expiresAt && new Date(certificate.expiresAt) < new Date()) {
      const result = { 
        isValid: false, 
        certificate, 
        error: "Certificate has expired" 
      };
      await CacheService.set(cacheKey, result, CacheTTL.medium);
      return result;
    }

    // Verify blockchain record if available
    let blockchainVerification: BlockchainVerification | undefined;
    if (certificate.blockchainTxHash) {
      try {
        blockchainVerification = await this.verifyBlockchainRecord(certificate.blockchainTxHash);
      } catch (error) {
        logger.warn("Blockchain verification failed", { 
          certificateId: certificate.id, 
          txHash: certificate.blockchainTxHash, 
          error 
        });
      }
    }

    const result = {
      isValid: true,
      certificate,
      blockchainVerification
    };

    // Cache for 1 hour
    await CacheService.set(cacheKey, result, CacheTTL.long);

    return result;
  },

  /**
   * Get certificates for a user
   */
  async getUserCertificates(
    userId: string,
    type?: 'milestone' | 'path'
  ): Promise<CompletionCertificate[]> {
    let query = `
      SELECT 
        cc.id, cc.enrollment_id as "enrollmentId", cc.milestone_id as "milestoneId",
        cc.certificate_type as "certificateType", cc.certificate_data as "certificateData",
        cc.verification_hash as "verificationHash", cc.blockchain_tx_hash as "blockchainTxHash",
        cc.issued_at as "issuedAt", cc.expires_at as "expiresAt", cc.is_revoked as "isRevoked",
        cc.revoked_at as "revokedAt", cc.revocation_reason as "revocationReason"
      FROM completion_certificates cc
      LEFT JOIN path_enrollments pe ON cc.enrollment_id = pe.id
      WHERE (pe.student_id = $1 OR (cc.certificate_data->>'studentId')::text = $1)
    `;

    const params: any[] = [userId];

    if (type) {
      query += ` AND cc.certificate_type = $2`;
      params.push(type);
    }

    query += ` ORDER BY cc.issued_at DESC`;

    const { rows } = await pool.query(query, params);

    return rows;
  },

  /**
   * Revoke a certificate
   */
  async revokeCertificate(
    certificateId: string,
    reason: string,
    revokedBy: string
  ): Promise<void> {
    // Verify certificate exists and get details
    const { rows } = await pool.query(
      `SELECT cc.*, pe.student_id, lp.mentor_id
       FROM completion_certificates cc
       LEFT JOIN path_enrollments pe ON cc.enrollment_id = pe.id
       LEFT JOIN learning_paths lp ON pe.learning_path_id = lp.id
       WHERE cc.id = $1`,
      [certificateId]
    );

    if (rows.length === 0) {
      throw createError("Certificate not found", 404);
    }

    const certificate = rows[0];

    // Check if user has permission to revoke (mentor or admin)
    // For now, allow mentor or the student themselves
    const canRevoke = certificate.mentor_id === revokedBy || 
                     certificate.student_id === revokedBy ||
                     certificate.certificate_data?.studentId === revokedBy;

    if (!canRevoke) {
      throw createError("Insufficient permissions to revoke certificate", 403);
    }

    // Revoke the certificate
    await pool.query(
      `UPDATE completion_certificates 
       SET is_revoked = true, revoked_at = NOW(), revocation_reason = $1
       WHERE id = $2`,
      [reason, certificateId]
    );

    // Invalidate verification cache
    await CacheService.del(`certificate_verification:${certificate.verification_hash}`);

    logger.info("Certificate revoked", {
      certificateId,
      reason,
      revokedBy
    });
  },

  /**
   * Get certificate templates
   */
  async getCertificateTemplates(): Promise<CertificateTemplate[]> {
    const cacheKey = 'certificate_templates';
    
    // Try cache first
    const cached = await CacheService.get<CertificateTemplate[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // For now, return default templates
    // In a full implementation, these would be stored in database
    const templates: CertificateTemplate[] = [
      {
        id: 'classic',
        name: 'Classic Certificate',
        description: 'Traditional certificate design with elegant borders',
        design: {
          ...this.getDefaultDesign(),
          layout: 'classic',
          borderStyle: 'decorative'
        },
        isDefault: true,
        isPublic: true,
        previewUrl: '/templates/classic-preview.png'
      },
      {
        id: 'modern',
        name: 'Modern Certificate',
        description: 'Clean, modern design with minimal styling',
        design: {
          ...this.getDefaultDesign(),
          layout: 'modern',
          borderStyle: 'simple',
          primaryColor: '#2563eb'
        },
        isDefault: false,
        isPublic: true,
        previewUrl: '/templates/modern-preview.png'
      },
      {
        id: 'minimal',
        name: 'Minimal Certificate',
        description: 'Simple, text-focused design',
        design: {
          ...this.getDefaultDesign(),
          layout: 'minimal',
          borderStyle: 'none',
          backgroundColor: '#ffffff'
        },
        isDefault: false,
        isPublic: true,
        previewUrl: '/templates/minimal-preview.png'
      }
    ];

    // Cache for 1 day
    await CacheService.set(cacheKey, templates, CacheTTL.veryLong);

    return templates;
  },

  /**
   * Generate certificate PDF
   */
  async generateCertificatePDF(certificateId: string): Promise<Buffer> {
    const { rows } = await pool.query(
      `SELECT certificate_data FROM completion_certificates WHERE id = $1`,
      [certificateId]
    );

    if (rows.length === 0) {
      throw createError("Certificate not found", 404);
    }

    const certificateData = rows[0].certificate_data as CertificateData;

    // Generate PDF using a PDF library (e.g., PDFKit)
    // This is a placeholder implementation
    const pdfBuffer = await this.createPDFFromTemplate(certificateData);

    return pdfBuffer;
  },

  // Private helper methods

  private generateCertificateNumber(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `CERT-${timestamp}-${random}`.toUpperCase();
  },

  private generateVerificationHash(studentId: string, targetId: string, certificateNumber: string): string {
    const data = `${studentId}:${targetId}:${certificateNumber}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  },

  private getDefaultDesign(): CertificateDesign {
    return {
      templateId: 'classic',
      backgroundColor: '#ffffff',
      primaryColor: '#1f2937',
      secondaryColor: '#6b7280',
      fontFamily: 'serif',
      borderStyle: 'decorative',
      layout: 'classic',
      includeQRCode: true,
      includeSignature: true
    };
  },

  private async recordOnBlockchain(certificate: CompletionCertificate): Promise<{ txHash: string } | null> {
    // Placeholder for blockchain integration
    // In a real implementation, this would interact with a blockchain network
    // to create an immutable record of the certificate
    
    if (!process.env.BLOCKCHAIN_ENABLED) {
      return null;
    }

    try {
      // Simulate blockchain transaction
      const txHash = crypto.randomBytes(32).toString('hex');
      
      logger.info("Certificate recorded on blockchain", {
        certificateId: certificate.id,
        txHash
      });

      return { txHash };
    } catch (error) {
      logger.error("Blockchain recording failed", { certificateId: certificate.id, error });
      throw error;
    }
  },

  private async verifyBlockchainRecord(txHash: string): Promise<BlockchainVerification> {
    // Placeholder for blockchain verification
    // In a real implementation, this would query the blockchain to verify the transaction
    
    return {
      txHash,
      blockNumber: Math.floor(Math.random() * 1000000),
      timestamp: new Date().toISOString(),
      contractAddress: '0x1234567890123456789012345678901234567890',
      verificationData: {
        confirmed: true,
        confirmations: 12
      }
    };
  },

  private async createPDFFromTemplate(certificateData: CertificateData): Promise<Buffer> {
    // Placeholder for PDF generation
    // In a real implementation, this would use a library like PDFKit or Puppeteer
    // to generate a PDF from the certificate data and design template
    
    const pdfContent = `
      Certificate of Completion
      
      This certifies that
      ${certificateData.studentName}
      
      has successfully completed
      ${certificateData.pathTitle || certificateData.milestoneTitle}
      
      under the guidance of
      ${certificateData.mentorName}
      
      Date: ${new Date(certificateData.completionDate).toLocaleDateString()}
      Certificate Number: ${certificateData.certificateNumber}
      
      Verification URL: ${certificateData.verificationUrl}
    `;

    // Convert to buffer (placeholder)
    return Buffer.from(pdfContent, 'utf-8');
  }
};