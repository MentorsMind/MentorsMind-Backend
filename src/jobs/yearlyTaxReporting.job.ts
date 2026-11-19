import { TaxReportingService } from "../services/tax-reporting.service";
import { TaxReportModel } from "../models/tax-report.model";
import { logger } from "../utils/logger.utils";

/**
 * Yearly tax report pre-generation job (issue #978).
 *
 * Runs each January. For every mentor with existing tax reports in the given
 * tax year (and above the 1099-K threshold for US mentors), it regenerates the
 * jurisdiction-aware report and produces the structured export.
 */
export async function runYearlyTaxReportingJob(taxYear?: number): Promise<{
  processed: number;
  generated: number;
  exported: number;
}> {
  const year = taxYear ?? new Date().getFullYear();
  let processed = 0;
  let generated = 0;
  let exported = 0;

  const mentorIds = await TaxReportModel.listMentorsForYear(year);
  logger.info("[TaxReportingJob] Pre-generating yearly tax reports", {
    year,
    mentors: mentorIds.length,
  });

  for (const mentorId of mentorIds) {
    try {
      const report = await TaxReportingService.generateReport(mentorId, year);
      processed++;
      if (!report) continue;
      generated++;

      const taxInfo = await TaxReportingService.getTaxInfo(mentorId);
      const isUs = !taxInfo?.countryCode || taxInfo.countryCode.toUpperCase() === "US";
      // Only export structured documents when there is meaningful earnings data.
      if (parseFloat(report.netEarnings) > 0 || !isUs) {
        const exportResult = await TaxReportingService.generateExport(mentorId, year);
        if (exportResult) exported++;
      }
    } catch (error) {
      logger.error("[TaxReportingJob] Failed to generate report", {
        mentorId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  logger.info("[TaxReportingJob] Yearly tax report generation complete", {
    year,
    processed,
    generated,
    exported,
  });

  return { processed, generated, exported };
}
