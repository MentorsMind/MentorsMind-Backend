import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { EventReplayService, ReplayProgress } from '../services/event-replay.service';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger';

/**
 * Admin controllers for event store replay and recovery operations.
 * All endpoints require admin authentication.
 */
export const EventReplayAdminController = {
  /**
   * POST /api/v1/admin/events/replay
   * Start or get status of an event replay operation.
   *
   * Request body:
   * {
   *   aggregateType: string (required) - Type of aggregate to replay (e.g., 'booking', 'session')
   *   aggregateId?: string - If provided, replay only this aggregate
   *   fromVersion?: number - Start replaying from this version
   * }
   */
  async startReplay(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { aggregateType, aggregateId, fromVersion } = req.body;

      if (!aggregateType) {
        ResponseUtil.error(res, 'aggregateType is required', 400);
        return;
      }

      logger.info('Event replay started by admin', {
        userId: req.user?.id,
        aggregateType,
        aggregateId,
        fromVersion,
      });

      let result: any;

      if (aggregateId) {
        // Replay single aggregate
        result = await EventReplayService.replayAggregate(
          aggregateId,
          aggregateType,
          fromVersion,
        );

        ResponseUtil.success(
          res,
          result,
          `Replay for aggregate ${aggregateId} completed`,
          200,
        );
      } else {
        // Replay all aggregates of type (async operation)
        // Fire and forget, return progress tracking endpoint
        EventReplayService.replayAllForType(aggregateType).catch((error) => {
          logger.error('Background replay failed', {
            aggregateType,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });

        // Return initial progress
        const progress: ReplayProgress = {
          aggregateType,
          total: 0, // Will be populated by the background job
          processed: 0,
          failed: 0,
          startedAt: new Date().toISOString(),
        };

        ResponseUtil.success(
          res,
          progress,
          `Replay for aggregate type ${aggregateType} started. Check /status for progress.`,
          202, // Accepted
        );
      }
    } catch (error) {
      logger.error('Event replay failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body,
      });
      ResponseUtil.error(res, 'Event replay failed', 500);
    }
  },

  /**
   * GET /api/v1/admin/events/replay/status/:aggregateType
   * Get the current progress of an ongoing or completed replay operation.
   */
  async getReplayStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { aggregateType } = req.params;

      if (!aggregateType) {
        ResponseUtil.error(res, 'aggregateType is required', 400);
        return;
      }

      const progress = await EventReplayService.getReplayProgress(aggregateType);

      if (!progress) {
        ResponseUtil.error(
          res,
          `No replay in progress for aggregate type ${aggregateType}`,
          404,
        );
        return;
      }

      const percentComplete = Math.round((progress.processed / progress.total) * 100);

      ResponseUtil.success(
        res,
        {
          ...progress,
          percentComplete,
          eta: progress.estimatedSecondsRemaining
            ? `${progress.estimatedSecondsRemaining}s`
            : 'calculating',
        },
        'Replay progress retrieved successfully',
        200,
      );
    } catch (error) {
      logger.error('Failed to get replay status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        aggregateType: req.params.aggregateType,
      });
      ResponseUtil.error(res, 'Failed to get replay status', 500);
    }
  },

  /**
   * POST /api/v1/admin/events/replay/clear/:aggregateType
   * Clear replay progress for a given aggregate type.
   * Useful after a failed replay to restart.
   */
  async clearReplayProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { aggregateType } = req.params;

      if (!aggregateType) {
        ResponseUtil.error(res, 'aggregateType is required', 400);
        return;
      }

      await EventReplayService.clearReplayProgress(aggregateType);

      logger.info('Replay progress cleared by admin', {
        userId: req.user?.id,
        aggregateType,
      });

      ResponseUtil.success(
        res,
        { aggregateType, cleared: true },
        'Replay progress cleared',
        200,
      );
    } catch (error) {
      logger.error('Failed to clear replay progress', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      ResponseUtil.error(res, 'Failed to clear replay progress', 500);
    }
  },
};

export default EventReplayAdminController;
