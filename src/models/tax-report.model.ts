import pool from "../config/database";
import { logger } from "../utils/logger";

export interface TaxReport {
  id: string;
  mentorId: string;
  taxYear: number;
  totalEarnings: string;
  platformFees: string;
  netEarnings: string;
  form1099Generated: boolean;
  w9OnFile: boolean;
  withholdingAmount: string;
  isInternational: boolean;
  generatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxDocument {
  id: string;
  taxReportId: string;
  mentorId: string;
  documentType: string;
  taxYear: number;
  fileUrl: string | null;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
}

export interface MentorTaxInfo {
  id: string;
  mentorId: string;
  taxIdType: string | null;
  taxIdLast4: string | null;
  isInternational: boolean;
  countryCode: string | null;
  w9SubmittedAt: Date | null;
}

function mapReport(row: any): TaxReport {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    taxYear: row.tax_year,
    totalEarnings: row.total_earnings,
    platformFees: row.platform_fees,
    netEarnings: row.net_earnings,
    form1099Generated: row.form_1099_generated,
    w9OnFile: row.w9_on_file,
    withholdingAmount: row.withholding_amount,
    isInternational: row.is_international,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const TaxReportModel = {
  async upsert(
    mentorId: string,
    taxYear: number,
    data: {
      totalEarnings: number;
      platformFees: number;
      netEarnings: number;
      isInternational?: boolean;
      withholdingAmount?: number;
    },
  ): Promise<TaxReport | null> {
    try {
      const { rows } = await pool.query(
        `INSERT INTO tax_reports
           (mentor_id, tax_year, total_earnings, platform_fees, net_earnings, is_international, withholding_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (mentor_id, tax_year) DO UPDATE SET
           total_earnings     = EXCLUDED.total_earnings,
           platform_fees      = EXCLUDED.platform_fees,
           net_earnings       = EXCLUDED.net_earnings,
           is_international   = EXCLUDED.is_international,
           withholding_amount = EXCLUDED.withholding_amount,
           updated_at         = NOW()
         RETURNING *`,
        [
          mentorId,
          taxYear,
          data.totalEarnings,
          data.platformFees,
          data.netEarnings,
          data.isInternational ?? false,
          data.withholdingAmount ?? 0,
        ],
      );
      return rows[0] ? mapReport(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to upsert tax report:", error);
      return null;
    }
  },

  async findByMentorAndYear(
    mentorId: string,
    taxYear: number,
  ): Promise<TaxReport | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM tax_reports WHERE mentor_id = $1 AND tax_year = $2`,
        [mentorId, taxYear],
      );
      return rows[0] ? mapReport(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to find tax report:", error);
      return null;
    }
  },

  async findByMentor(mentorId: string): Promise<TaxReport[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM tax_reports WHERE mentor_id = $1 ORDER BY tax_year DESC`,
        [mentorId],
      );
      return rows.map(mapReport);
    } catch (error) {
      logger.error("Failed to find tax reports:", error);
      return [];
    }
  },

  async markForm1099Generated(
    mentorId: string,
    taxYear: number,
  ): Promise<boolean> {
    try {
      const { rowCount } = await pool.query(
        `UPDATE tax_reports
         SET form_1099_generated = TRUE, generated_at = NOW(), updated_at = NOW()
         WHERE mentor_id = $1 AND tax_year = $2`,
        [mentorId, taxYear],
      );
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to mark 1099 generated:", error);
      return false;
    }
  },

  async createDocument(
    taxReportId: string,
    mentorId: string,
    documentType: string,
    taxYear: number,
    fileUrl?: string,
  ): Promise<TaxDocument | null> {
    try {
      const { rows } = await pool.query(
        `INSERT INTO tax_documents (tax_report_id, mentor_id, document_type, tax_year, file_url, status)
         VALUES ($1, $2, $3, $4, $5, 'generated')
         RETURNING *`,
        [taxReportId, mentorId, documentType, taxYear, fileUrl ?? null],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            taxReportId: r.tax_report_id,
            mentorId: r.mentor_id,
            documentType: r.document_type,
            taxYear: r.tax_year,
            fileUrl: r.file_url,
            status: r.status,
            sentAt: r.sent_at,
            createdAt: r.created_at,
          }
        : null;
    } catch (error) {
      logger.error("Failed to create tax document:", error);
      return null;
    }
  },

  async getDocumentsByReport(taxReportId: string): Promise<TaxDocument[]> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM tax_documents WHERE tax_report_id = $1 ORDER BY created_at DESC`,
        [taxReportId],
      );
      return rows.map((r: any) => ({
        id: r.id,
        taxReportId: r.tax_report_id,
        mentorId: r.mentor_id,
        documentType: r.document_type,
        taxYear: r.tax_year,
        fileUrl: r.file_url,
        status: r.status,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      }));
    } catch (error) {
      logger.error("Failed to get tax documents:", error);
      return [];
    }
  },

  /** Aggregate earnings from payments for a mentor in a given tax year */
  async aggregateEarnings(
    mentorId: string,
    taxYear: number,
  ): Promise<{
    totalEarnings: number;
    platformFees: number;
    netEarnings: number;
  }> {
    try {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount), 0)          AS total_earnings,
           COALESCE(SUM(platform_fee), 0)    AS platform_fees,
           COALESCE(SUM(mentor_amount), 0)   AS net_earnings
         FROM payments
         WHERE mentor_id = $1
           AND status = 'completed'
           AND EXTRACT(YEAR FROM created_at) = $2`,
        [mentorId, taxYear],
      );
      const r = rows[0];
      return {
        totalEarnings: parseFloat(r?.total_earnings ?? "0"),
        platformFees: parseFloat(r?.platform_fees ?? "0"),
        netEarnings: parseFloat(r?.net_earnings ?? "0"),
      };
    } catch (error) {
      logger.error("Failed to aggregate earnings:", error);
      return { totalEarnings: 0, platformFees: 0, netEarnings: 0 };
    }
  },

  async upsertTaxInfo(
    mentorId: string,
    data: {
      taxIdType?: string;
      taxIdLast4?: string;
      isInternational?: boolean;
      countryCode?: string;
    },
  ): Promise<MentorTaxInfo | null> {
    try {
      const { rows } = await pool.query(
        `INSERT INTO mentor_tax_info (mentor_id, tax_id_type, tax_id_last4, is_international, country_code)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (mentor_id) DO UPDATE SET
           tax_id_type     = COALESCE(EXCLUDED.tax_id_type, mentor_tax_info.tax_id_type),
           tax_id_last4    = COALESCE(EXCLUDED.tax_id_last4, mentor_tax_info.tax_id_last4),
           is_international = EXCLUDED.is_international,
           country_code    = COALESCE(EXCLUDED.country_code, mentor_tax_info.country_code),
           updated_at      = NOW()
         RETURNING *`,
        [
          mentorId,
          data.taxIdType ?? null,
          data.taxIdLast4 ?? null,
          data.isInternational ?? false,
          data.countryCode ?? null,
        ],
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            mentorId: r.mentor_id,
            taxIdType: r.tax_id_type,
            taxIdLast4: r.tax_id_last4,
            isInternational: r.is_international,
            countryCode: r.country_code,
            w9SubmittedAt: r.w9_submitted_at,
          }
        : null;
    } catch (error) {
      logger.error("Failed to upsert mentor tax info:", error);
      return null;
    }
  },

  async submitW9(mentorId: string): Promise<boolean> {
    try {
      await pool.query(
        `UPDATE mentor_tax_info SET w9_submitted_at = NOW(), updated_at = NOW() WHERE mentor_id = $1`,
        [mentorId],
      );
      await pool.query(
        `UPDATE tax_reports SET w9_on_file = TRUE, updated_at = NOW() WHERE mentor_id = $1`,
        [mentorId],
      );
      return true;
    } catch (error) {
      logger.error("Failed to submit W-9:", error);
      return false;
    }
  },
};
