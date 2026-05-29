import {
  TaxReportModel,
  TaxReport,
  TaxDocument,
} from "../models/tax-report.model";
import { logger } from "../utils/logger";

/** Threshold above which a 1099 must be generated (USD equivalent) */
const FORM_1099_THRESHOLD = 600;

/** International withholding rate (30% default, treaty-reduced rates handled externally) */
const INTERNATIONAL_WITHHOLDING_RATE = 0.3;

export const TaxReportingService = {
  /**
   * Generate or refresh a tax report for a mentor for the given year.
   * Aggregates earnings from payments and computes withholding.
   */
  async generateReport(
    mentorId: string,
    taxYear: number,
  ): Promise<TaxReport | null> {
    const earnings = await TaxReportModel.aggregateEarnings(mentorId, taxYear);

    // Determine if international withholding applies
    const taxInfo = await this.getTaxInfo(mentorId);
    const isInternational = taxInfo?.isInternational ?? false;
    const withholdingAmount = isInternational
      ? earnings.netEarnings * INTERNATIONAL_WITHHOLDING_RATE
      : 0;

    const report = await TaxReportModel.upsert(mentorId, taxYear, {
      ...earnings,
      isInternational,
      withholdingAmount,
    });

    if (!report) return null;

    // Auto-generate 1099 if threshold met and not yet generated
    if (
      !report.form1099Generated &&
      earnings.netEarnings >= FORM_1099_THRESHOLD
    ) {
      await this.generate1099(mentorId, taxYear, report.id);
    }

    logger.info("Tax report generated", {
      mentorId,
      taxYear,
      netEarnings: earnings.netEarnings,
    });
    return report;
  },

  /**
   * Generate a 1099-NEC document for a mentor.
   */
  async generate1099(
    mentorId: string,
    taxYear: number,
    reportId: string,
  ): Promise<TaxDocument | null> {
    const documentType = "1099-NEC";
    // In production this would call a PDF generation service or TaxJar/Avalara
    const fileUrl = `/tax-documents/${mentorId}/${taxYear}/${documentType}.pdf`;

    const doc = await TaxReportModel.createDocument(
      reportId,
      mentorId,
      documentType,
      taxYear,
      fileUrl,
    );
    if (doc) {
      await TaxReportModel.markForm1099Generated(mentorId, taxYear);
      logger.info("1099-NEC generated", { mentorId, taxYear });
    }
    return doc;
  },

  /**
   * Get a mentor's tax report for a specific year.
   */
  async getReport(
    mentorId: string,
    taxYear: number,
  ): Promise<TaxReport | null> {
    return TaxReportModel.findByMentorAndYear(mentorId, taxYear);
  },

  /**
   * List all tax reports for a mentor.
   */
  async listReports(mentorId: string): Promise<TaxReport[]> {
    return TaxReportModel.findByMentor(mentorId);
  },

  /**
   * Get documents attached to a tax report.
   */
  async getDocuments(taxReportId: string): Promise<TaxDocument[]> {
    return TaxReportModel.getDocumentsByReport(taxReportId);
  },

  /**
   * Save/update mentor tax information (W-9 data).
   */
  async saveTaxInfo(
    mentorId: string,
    data: {
      taxIdType?: string;
      taxIdLast4?: string;
      isInternational?: boolean;
      countryCode?: string;
    },
  ) {
    return TaxReportModel.upsertTaxInfo(mentorId, data);
  },

  /**
   * Get mentor tax info.
   */
  async getTaxInfo(mentorId: string) {
    try {
      const pool = (await import("../config/database")).default;
      const { rows } = await pool.query(
        `SELECT * FROM mentor_tax_info WHERE mentor_id = $1`,
        [mentorId],
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
    } catch {
      return null;
    }
  },

  /**
   * Record W-9 submission for a mentor.
   */
  async submitW9(mentorId: string): Promise<boolean> {
    return TaxReportModel.submitW9(mentorId);
  },

  /**
   * Batch-generate reports for all mentors above threshold for a given year.
   * Intended to be called by a cron job at year-end.
   */
  async batchGenerateReports(
    taxYear: number,
  ): Promise<{ processed: number; generated: number }> {
    let processed = 0;
    let generated = 0;

    try {
      const pool = (await import("../config/database")).default;
      // Get all mentors with earnings above threshold in the given year
      const { rows } = await pool.query(
        `SELECT DISTINCT mentor_id
         FROM payments
         WHERE status = 'completed'
           AND EXTRACT(YEAR FROM created_at) = $1
         GROUP BY mentor_id
         HAVING SUM(mentor_amount) >= $2`,
        [taxYear, FORM_1099_THRESHOLD],
      );

      for (const row of rows) {
        processed++;
        const report = await this.generateReport(row.mentor_id, taxYear);
        if (report?.form1099Generated) generated++;
      }
    } catch (error) {
      logger.error("Batch tax report generation failed:", error);
    }

    logger.info("Batch tax reports complete", {
      taxYear,
      processed,
      generated,
    });
    return { processed, generated };
  },
};
