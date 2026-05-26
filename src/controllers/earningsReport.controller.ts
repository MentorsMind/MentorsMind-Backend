/**
 * Earnings Report Controller
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { EarningsReportService } from '../services/earningsReport.service';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger.utils';

export const EarningsReportController = {
  /**
   * GET /api/v1/mentors/me/earnings
   * Get earnings summary for authenticated mentor
   */
  async getEarningsSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mentorId = req.user!.id;
      const period = (req.query.period as string) || '30d';

      // Validate period
      const validPeriods = ['7d', '30d', '90d', '1y'];
      if (!validPeriods.includes(period)) {
        ResponseUtil.error(res, `Invalid period. Must be one of: ${validPeriods.join(', ')}`, 400);
        return;
      }

      const summary = await EarningsReportService.getEarningsSummary(mentorId, period);
      ResponseUtil.success(res, summary, 'Earnings summary retrieved successfully');
    } catch (error) {
      logger.error('Error getting earnings summary', { error, userId: req.user?.id });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },

  /**
   * GET /api/v1/mentors/me/earnings/breakdown
   * Get per-session earnings breakdown with pagination
   */
  async getEarningsBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mentorId = req.user!.id;
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '20', 10);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      // Validate pagination params
      if (page < 1 || limit < 1 || limit > 100) {
        ResponseUtil.error(res, 'Invalid pagination parameters. Page >= 1, 1 <= limit <= 100', 400);
        return;
      }

      const result = await EarningsReportService.getEarningsBreakdown(mentorId, page, limit, startDate, endDate);
      ResponseUtil.success(res, result, 'Earnings breakdown retrieved successfully');
    } catch (error) {
      logger.error('Error getting earnings breakdown', { error, userId: req.user?.id });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },

  /**
   * GET /api/v1/mentors/me/earnings/export
   * Export earnings in CSV or PDF format
   * Query params: format (csv|pdf), period (7d|30d|90d|1y), startDate, endDate
   * For large exports, returns job ID and queues processing
   */
  async exportEarnings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mentorId = req.user!.id;
      const format = ((req.query.format as string) || 'csv').toLowerCase();
      const period = (req.query.period as string) || '30d';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Validate format
      if (!['csv', 'pdf'].includes(format)) {
        ResponseUtil.error(res, 'Invalid format. Must be csv or pdf', 400);
        return;
      }

      // Validate period
      const validPeriods = ['7d', '30d', '90d', '1y'];
      if (!validPeriods.includes(period) && !(startDate && endDate)) {
        ResponseUtil.error(res, `Invalid period. Must be one of: ${validPeriods.join(', ')}`, 400);
        return;
      }

      // For large date ranges (over 90 days), queue the export
      let daysInRange = 90;
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        daysInRange = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      } else if (period === '1y') {
        daysInRange = 365;
      }

      if (daysInRange > 90) {
        // Queue export for large ranges
        const jobId = await EarningsReportService.queueExport(mentorId, format as 'csv' | 'pdf', period, startDate, endDate);
        ResponseUtil.success(res, { job_id: jobId, status: 'queued' }, 'Export job queued for processing', 202);
        return;
      }

      // Generate export immediately for small ranges
      let content: string | any;
      let contentType: string;
      let fileName: string;

      if (format === 'csv') {
        content = await EarningsReportService.exportEarningsCSV(mentorId, period, startDate, endDate);
        contentType = 'text/csv';
        fileName = `earnings_${mentorId}_${period}_${new Date().toISOString().split('T')[0]}.csv`;
      } else {
        content = await EarningsReportService.exportEarningsPDF(mentorId, period, startDate, endDate);
        contentType = 'application/pdf';
        fileName = `earnings_${mentorId}_${period}_${new Date().toISOString().split('T')[0]}.pdf`;
      }

      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      if (format === 'csv') {
        res.send(content);
      } else {
        // PDF is a stream
        content.pipe(res);
      }

      logger.info('Earnings export generated', { mentorId, format, period });
    } catch (error) {
      logger.error('Error exporting earnings', { error, userId: req.user?.id });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },

  /**
   * GET /api/v1/mentors/me/earnings/export/:jobId/status
   * Check status of a queued export job
   */
  async getExportStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mentorId = req.user!.id;
      const jobId = req.params.jobId as string;

      const job = await ExportJobModel.getStatus(jobId);

      if (!job) {
        ResponseUtil.notFound(res, 'Export job not found');
        return;
      }

      // Verify ownership
      if (job.user_id !== mentorId) {
        ResponseUtil.forbidden(res, 'You do not have access to this export job');
        return;
      }

      ResponseUtil.success(
        res,
        {
          job_id: job.id,
          status: job.status,
          created_at: job.created_at,
          expires_at: job.expires_at,
          error_message: job.error_message,
        },
        'Export job status retrieved successfully',
      );
    } catch (error) {
      logger.error('Error getting export status', { error, userId: req.user?.id });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },

  /**
   * GET /api/v1/mentors/me/earnings/export/:jobId/download
   * Download completed export
   */
  async downloadExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const mentorId = req.user!.id;
      const jobId = req.params.jobId as string;

      const job = await ExportJobModel.getStatus(jobId);

      if (!job) {
        ResponseUtil.notFound(res, 'Export job not found');
        return;
      }

      // Verify ownership
      if (job.user_id !== mentorId) {
        ResponseUtil.forbidden(res, 'You do not have access to this export job');
        return;
      }

      // Check if completed
      if (job.status !== 'completed' || !job.file_path) {
        ResponseUtil.error(res, 'Export job is not completed', 400);
        return;
      }

      // Check expiration
      if (job.expires_at && new Date() > new Date(job.expires_at)) {
        ResponseUtil.error(res, 'Download link has expired', 410);
        return;
      }

      // Download file
      res.download(job.file_path);
      logger.info('Earnings export downloaded', { mentorId, jobId });
    } catch (error) {
      logger.error('Error downloading export', { error, userId: req.user?.id });
      ResponseUtil.error(res, (error as Error).message, 500);
    }
  },
};

// Import ExportJobModel for type checking
import { ExportJobModel } from '../models/export-job.model';
