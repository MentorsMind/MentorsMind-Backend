/**
 * Earnings Report Service - Business logic for earnings calculations and exports
 */

import pool from '../config/database';
import { logger } from '../utils/logger.utils';
import { PDFUtils, EarningsReportData } from '../utils/pdf.utils';
import { exportQueue } from '../queues/export.queue';
import { ExportJobModel } from '../models/export-job.model';

export interface EarningsSummary {
  gross_earnings: string;
  platform_fee: string;
  net_earnings: string;
  pending_escrow: string;
  by_asset: Array<{
    asset_code: string;
    asset_type: string;
    amount: string;
    sessions: number;
  }>;
}

export interface EarningsBreakdown {
  session_id: string;
  date: string;
  title: string;
  duration_minutes: number;
  amount: string;
  currency: string;
  platform_fee: string;
  mentor_payout: string;
  status: string;
}

export interface PaginatedEarnings {
  data: EarningsBreakdown[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export const EarningsReportService = {
  /**
   * Get earnings summary for a mentor
   * Returns: gross_earnings, platform_fee, net_earnings, pending_escrow, by_asset[]
   */
  async getEarningsSummary(mentorId: string, period: string = '30d'): Promise<EarningsSummary> {
    const days = PERIOD_DAYS[period] || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // Get summary data
      const summaryResult = await pool.query<{
        gross_earnings: string;
        platform_fee_sum: string;
        net_earnings: string;
        pending_escrow: string;
      }>(
        `
        SELECT
          COALESCE(SUM(CAST(b.amount AS DECIMAL(12, 2))), 0)::text as gross_earnings,
          COALESCE(SUM(CAST(b.platform_fee AS DECIMAL(12, 2))), 0)::text as platform_fee_sum,
          COALESCE(SUM(CAST(b.mentor_payout AS DECIMAL(12, 2))), 0)::text as net_earnings,
          COALESCE(SUM(CASE WHEN b.payment_status = 'held_in_escrow' THEN CAST(b.mentor_payout AS DECIMAL(12, 2)) ELSE 0 END), 0)::text as pending_escrow
        FROM bookings b
        WHERE b.mentor_id = $1
          AND b.status = 'completed'
          AND b.scheduled_start >= $2
        `,
        [mentorId, startDate.toISOString()],
      );

      // Get asset breakdown
      const assetResult = await pool.query<{
        asset_code: string;
        asset_type: string;
        total_amount: string;
        session_count: string;
      }>(
        `
        SELECT
          b.currency as asset_code,
          'Currency' as asset_type,
          COALESCE(SUM(CAST(b.mentor_payout AS DECIMAL(12, 2))), 0)::text as total_amount,
          COUNT(b.id)::text as session_count
        FROM bookings b
        WHERE b.mentor_id = $1
          AND b.status = 'completed'
          AND b.scheduled_start >= $2
        GROUP BY b.currency
        ORDER BY total_amount DESC
        `,
        [mentorId, startDate.toISOString()],
      );

      const summary = summaryResult.rows[0];
      const grossEarnings = parseFloat(summary.gross_earnings || '0');
      const platformFee = parseFloat(summary.platform_fee_sum || '0');
      const netEarnings = parseFloat(summary.net_earnings || '0');
      const pendingEscrow = parseFloat(summary.pending_escrow || '0');

      return {
        gross_earnings: grossEarnings.toFixed(2),
        platform_fee: platformFee.toFixed(2),
        net_earnings: netEarnings.toFixed(2),
        pending_escrow: pendingEscrow.toFixed(2),
        by_asset: assetResult.rows.map((row) => ({
          asset_code: row.asset_code,
          asset_type: row.asset_type,
          amount: parseFloat(row.total_amount).toFixed(2),
          sessions: parseInt(row.session_count, 10),
        })),
      };
    } catch (error) {
      logger.error('Error getting earnings summary', { error, mentorId, period });
      throw error;
    }
  },

  /**
   * Get per-session earnings breakdown with pagination
   */
  async getEarningsBreakdown(
    mentorId: string,
    page: number = 1,
    limit: number = 20,
    startDate?: Date,
    endDate?: Date,
  ): Promise<PaginatedEarnings> {
    const offset = (page - 1) * limit;

    try {
      // Build WHERE clause
      const conditions = ['b.mentor_id = $1', "b.status = 'completed'"];
      const params: any[] = [mentorId];
      let paramIdx = 2;

      if (startDate) {
        conditions.push(`b.scheduled_start >= $${paramIdx}`);
        params.push(startDate.toISOString());
        paramIdx++;
      }

      if (endDate) {
        conditions.push(`b.scheduled_start <= $${paramIdx}`);
        params.push(endDate.toISOString());
        paramIdx++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(b.id)::text as count FROM bookings b WHERE ${whereClause}`,
        params,
      );

      const total = parseInt(countResult.rows[0]?.count || '0', 10);

      // Get paginated results
      const dataParams = [...params, limit, offset];
      const dataResult = await pool.query<EarningsBreakdown>(
        `
        SELECT
          b.id as session_id,
          b.scheduled_start::text as date,
          b.title,
          b.duration_minutes,
          b.amount::text,
          b.currency,
          b.platform_fee::text as platform_fee,
          b.mentor_payout::text as mentor_payout,
          b.status
        FROM bookings b
        WHERE ${whereClause}
        ORDER BY b.scheduled_start DESC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `,
        dataParams,
      );

      return {
        data: dataResult.rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error getting earnings breakdown', { error, mentorId, page, limit });
      throw error;
    }
  },

  /**
   * Export earnings as CSV
   */
  async exportEarningsCSV(
    mentorId: string,
    period: string = '30d',
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    try {
      let dateFilter: { start: Date; end: Date };

      if (startDate && endDate) {
        dateFilter = {
          start: new Date(startDate),
          end: new Date(endDate),
        };
      } else {
        const days = PERIOD_DAYS[period] || 30;
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        dateFilter = { start, end };
      }

      // Get mentor info
      const mentorResult = await pool.query<{
        full_name: string;
        email: string;
      }>(
        `SELECT full_name, email FROM users WHERE id = $1`,
        [mentorId],
      );

      if (!mentorResult.rows[0]) {
        throw new Error('Mentor not found');
      }

      const mentor = mentorResult.rows[0];

      // Get summary
      const summary = await this.getEarningsSummary(mentorId, period);

      // Get all sessions
      const sessionsResult = await pool.query<EarningsBreakdown>(
        `
        SELECT
          b.id as session_id,
          b.scheduled_start::text as date,
          b.title,
          b.duration_minutes,
          b.amount::text,
          b.currency,
          b.platform_fee::text as platform_fee,
          b.mentor_payout::text as mentor_payout,
          b.status
        FROM bookings b
        WHERE b.mentor_id = $1
          AND b.status = 'completed'
          AND b.scheduled_start >= $2
          AND b.scheduled_start <= $3
        ORDER BY b.scheduled_start DESC
        `,
        [mentorId, dateFilter.start.toISOString(), dateFilter.end.toISOString()],
      );

      // Generate CSV
      const lines: string[] = [];
      lines.push('Mentor Earnings Report - CSV Export');
      lines.push(`"Mentor Name","${mentor.full_name}"`);
      lines.push(`"Email","${mentor.email}"`);
      lines.push(`"Period","${period}"`);
      lines.push(`"Start Date","${dateFilter.start.toISOString().split('T')[0]}"`);
      lines.push(`"End Date","${dateFilter.end.toISOString().split('T')[0]}"`);
      lines.push(`"Generated","${new Date().toISOString()}"`);
      lines.push('');

      // Summary section
      lines.push('EARNINGS SUMMARY');
      lines.push(`"Gross Earnings","${summary.gross_earnings}"`);
      lines.push(`"Platform Fee","${summary.platform_fee}"`);
      lines.push(`"Net Earnings","${summary.net_earnings}"`);
      lines.push(`"Pending Escrow","${summary.pending_escrow}"`);
      lines.push('');

      // Asset breakdown
      if (summary.by_asset.length > 0) {
        lines.push('ASSET BREAKDOWN');
        lines.push('"Asset Code","Asset Type","Amount","Sessions"');
        summary.by_asset.forEach((asset) => {
          lines.push(`"${asset.asset_code}","${asset.asset_type}","${asset.amount}","${asset.sessions}"`);
        });
        lines.push('');
      }

      // Session details
      if (sessionsResult.rows.length > 0) {
        lines.push('SESSION DETAILS');
        lines.push('"Date","Title","Duration (min)","Amount","Currency","Platform Fee","Mentor Payout","Status"');
        sessionsResult.rows.forEach((session) => {
          lines.push(
            `"${session.date}","${session.title}","${session.duration_minutes}","${session.amount}","${session.currency}","${session.platform_fee}","${session.mentor_payout}","${session.status}"`,
          );
        });
      }

      return lines.join('\n');
    } catch (error) {
      logger.error('Error exporting earnings to CSV', { error, mentorId, period });
      throw error;
    }
  },

  /**
   * Export earnings as PDF
   */
  async exportEarningsPDF(
    mentorId: string,
    period: string = '30d',
    startDate?: string,
    endDate?: string,
  ): Promise<any> {
    try {
      let dateFilter: { start: Date; end: Date };

      if (startDate && endDate) {
        dateFilter = {
          start: new Date(startDate),
          end: new Date(endDate),
        };
      } else {
        const days = PERIOD_DAYS[period] || 30;
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        dateFilter = { start, end };
      }

      // Get mentor info
      const mentorResult = await pool.query<{
        full_name: string;
        email: string;
      }>(
        `SELECT full_name, email FROM users WHERE id = $1`,
        [mentorId],
      );

      if (!mentorResult.rows[0]) {
        throw new Error('Mentor not found');
      }

      const mentor = mentorResult.rows[0];

      // Get summary
      const summary = await this.getEarningsSummary(mentorId, period);

      // Get all sessions
      const sessionsResult = await pool.query<{
        scheduled_start: Date;
        title: string;
        duration_minutes: number;
        amount: string;
        currency: string;
        status: string;
      }>(
        `
        SELECT
          b.scheduled_start,
          b.title,
          b.duration_minutes,
          b.amount::text,
          b.currency,
          b.status
        FROM bookings b
        WHERE b.mentor_id = $1
          AND b.status = 'completed'
          AND b.scheduled_start >= $2
          AND b.scheduled_start <= $3
        ORDER BY b.scheduled_start DESC
        `,
        [mentorId, dateFilter.start.toISOString(), dateFilter.end.toISOString()],
      );

      // Prepare PDF data
      const pdfData: EarningsReportData = {
        mentorName: mentor.full_name,
        mentorEmail: mentor.email,
        period,
        startDate: dateFilter.start.toISOString().split('T')[0],
        endDate: dateFilter.end.toISOString().split('T')[0],
        grossEarnings: parseFloat(summary.gross_earnings),
        platformFee: parseFloat(summary.platform_fee),
        netEarnings: parseFloat(summary.net_earnings),
        pendingEscrow: parseFloat(summary.pending_escrow),
        byAsset: summary.by_asset.map((asset) => ({
          assetCode: asset.asset_code,
          assetType: asset.asset_type,
          amount: parseFloat(asset.amount),
          sessions: asset.sessions,
        })),
        sessions: sessionsResult.rows.map((session) => ({
          date: session.scheduled_start.toISOString().split('T')[0],
          title: session.title,
          duration: session.duration_minutes,
          amount: parseFloat(session.amount),
          assetCode: session.currency,
          status: session.status,
        })),
        platformName: 'MentorMinds',
        platformBrandColor: '#0066cc',
      };

      // Generate PDF
      return PDFUtils.generateEarningsReport(pdfData);
    } catch (error) {
      logger.error('Error exporting earnings to PDF', { error, mentorId, period });
      throw error;
    }
  },

  /**
   * Queue export generation for large date ranges
   */
  async queueExport(
    mentorId: string,
    format: 'csv' | 'pdf',
    period: string,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    try {
      // Create export job
      const job = await ExportJobModel.create(mentorId, {
        type: 'earnings',
        format,
        period,
        startDate,
        endDate,
      });

      // Queue the job
      await exportQueue.add('process-earnings-export', {
        jobId: job.id,
        userId: mentorId,
        type: 'earnings-export',
        format,
        period,
        startDate,
        endDate,
      });

      logger.info('Earnings export queued', { jobId: job.id, mentorId, format, period });
      return job.id;
    } catch (error) {
      logger.error('Error queuing earnings export', { error, mentorId, format });
      throw error;
    }
  },

  /**
   * Process queued export
   */
  async processQueuedExport(
    jobId: string,
    mentorId: string,
    format: 'csv' | 'pdf',
    period: string,
    startDate?: string,
    endDate?: string,
  ): Promise<void> {
    try {
      await ExportJobModel.updateStatus(jobId, 'processing');

      let content: string | any;
      const fileName =
        format === 'csv'
          ? `earnings_${mentorId}_${period}_${Date.now()}.csv`
          : `earnings_${mentorId}_${period}_${Date.now()}.pdf`;

      if (format === 'csv') {
        content = await this.exportEarningsCSV(mentorId, period, startDate, endDate);
      } else {
        content = await this.exportEarningsPDF(mentorId, period, startDate, endDate);
      }

      // Save file (in production, this would be S3 or similar)
      const fs = await import('fs');
      const path = await import('path');
      const exportDir = path.join(process.cwd(), 'exports');

      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const filePath = path.join(exportDir, fileName);

      if (format === 'csv') {
        fs.writeFileSync(filePath, content);
      } else {
        // For PDF, content is a stream
        content.pipe(fs.createWriteStream(filePath));
      }

      // Mark as completed
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await ExportJobModel.updateStatus(jobId, 'completed', filePath, undefined, expiresAt);
      logger.info('Earnings export completed', { jobId, fileName });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await ExportJobModel.updateStatus(jobId, 'failed', undefined, errorMessage);
      logger.error('Error processing earnings export', { error, jobId });
      throw error;
    }
  },
};
