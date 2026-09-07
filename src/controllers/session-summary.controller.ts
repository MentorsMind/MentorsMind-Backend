import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { SessionSummaryModel } from '../models/session-summary.model';
import { logger } from '../utils/logger';

export const SessionSummaryController = {
  async generateSummary(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { bookingId } = req.params;
      const { transcriptId, transcriptText, sessionNotes, sessionTitle } = req.body;

      const existing = await SessionSummaryModel.findByBookingId(bookingId);
      if (existing && existing.status === 'completed') {
        return res.status(200).json({ success: true, data: existing, message: 'Summary already exists' });
      }

      const summary = await SessionSummaryModel.generateAndStore({
        bookingId,
        sessionId: req.body.sessionId,
        transcriptId,
        transcriptText,
        sessionNotes,
        sessionTitle,
      });

      return res.status(201).json({ success: true, data: summary });
    } catch (error) {
      logger.error('Error generating session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate summary',
      });
    }
  },

  async getSummaryByBooking(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { bookingId } = req.params;
      const summary = await SessionSummaryModel.findByBookingId(bookingId);
      if (!summary) return res.status(404).json({ success: false, error: 'Summary not found' });

      return res.status(200).json({ success: true, data: summary });
    } catch (error) {
      logger.error('Error getting session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get summary',
      });
    }
  },

  async getSummaryBySession(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { sessionId } = req.params;
      const summary = await SessionSummaryModel.findBySessionId(sessionId);
      if (!summary) return res.status(404).json({ success: false, error: 'Summary not found' });

      return res.status(200).json({ success: true, data: summary });
    } catch (error) {
      logger.error('Error getting session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get summary',
      });
    }
  },

  async getSummaryById(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { id } = req.params;
      const summary = await SessionSummaryModel.findById(id);
      if (!summary) return res.status(404).json({ success: false, error: 'Summary not found' });

      return res.status(200).json({ success: true, data: summary });
    } catch (error) {
      logger.error('Error getting session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get summary',
      });
    }
  },

  async getUserSummaries(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const summaries = await SessionSummaryModel.findByUserId(userId);
      return res.status(200).json({ success: true, data: summaries });
    } catch (error) {
      logger.error('Error getting user summaries', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get summaries',
      });
    }
  },

  async deleteSummary(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { id } = req.params;
      const deleted = await SessionSummaryModel.delete(id);
      if (!deleted) return res.status(404).json({ success: false, error: 'Summary not found' });

      return res.status(200).json({ success: true, message: 'Summary deleted successfully' });
    } catch (error) {
      logger.error('Error deleting session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete summary',
      });
    }
  },

  async regenerateSummary(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId ?? req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { id } = req.params;
      const existing = await SessionSummaryModel.findById(id);
      if (!existing) return res.status(404).json({ success: false, error: 'Summary not found' });

      const summary = await SessionSummaryModel.generateAndStore({
        bookingId: existing.booking_id,
        sessionId: existing.session_id || undefined,
        transcriptId: existing.transcript_id || undefined,
        transcriptText: existing.source_text || undefined,
        sessionNotes: existing.source_text || undefined,
      });

      return res.status(200).json({ success: true, data: summary, message: 'Summary regenerated successfully' });
    } catch (error) {
      logger.error('Error regenerating session summary', { error });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to regenerate summary',
      });
    }
  },
};

export default SessionSummaryController;
