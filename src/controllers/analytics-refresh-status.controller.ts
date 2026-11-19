/**
 * Analytics Refresh Status Controller
 *
 * GET /api/v1/admin/analytics/refresh-status
 *
 * Returns per-view last-refresh time, current lock state, and queue depth
 * so operators can see the health of the analytics refresh pipeline in real-time.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ResponseUtil } from '../utils/response.utils';
import {
  ANALYTICS_VIEWS,
  readAllViewStates,
  ViewRefreshState,
} from '../workers/analyticsRefresh.worker';
import { analyticsRefreshQueue } from '../queues/analyticsRefresh.queue';
import { logger } from '../utils/logger.utils';

interface ViewStatusResponse {
  viewName: string;
  status: 'idle' | 'refreshing' | 'failed' | 'unknown';
  lastRefreshedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  /** How many seconds ago this view was last refreshed (null = never) */
  secondsSinceRefresh: number | null;
  /** Whether this view is considered stale (>16 min since last refresh) */
  isStale: boolean;
  refresher: string | null;
  lastDurationMs: number | null;
}

/** A view is stale if it hasn't been refreshed within one refresh interval + 1 min grace */
const STALE_THRESHOLD_SECONDS = 16 * 60;

function toViewStatus(state: ViewRefreshState): ViewStatusResponse {
  const now = Date.now();
  let secondsSinceRefresh: number | null = null;

  if (state.lastRefreshedAt) {
    secondsSinceRefresh = Math.floor(
      (now - new Date(state.lastRefreshedAt).getTime()) / 1000,
    );
  }

  return {
    viewName: state.viewName,
    status: state.status,
    lastRefreshedAt: state.lastRefreshedAt,
    lastFailedAt: state.lastFailedAt,
    lastError: state.lastError,
    secondsSinceRefresh,
    isStale:
      secondsSinceRefresh === null || secondsSinceRefresh > STALE_THRESHOLD_SECONDS,
    refresher: state.refresher,
    lastDurationMs: state.durationMs,
  };
}

export const AnalyticsRefreshStatusController = {
  /**
   * GET /admin/analytics/refresh-status
   *
   * Response shape:
   * {
   *   views: ViewStatusResponse[],
   *   queue: { waiting, active, delayed, failed },
   *   summary: { total, idle, refreshing, failed, stale }
   * }
   */
  async getRefreshStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const [viewStates, waiting, active, delayed, failed] = await Promise.all([
        readAllViewStates(),
        analyticsRefreshQueue.getWaitingCount(),
        analyticsRefreshQueue.getActiveCount(),
        analyticsRefreshQueue.getDelayedCount(),
        analyticsRefreshQueue.getFailedCount(),
      ]);

      const views = viewStates.map(toViewStatus);

      const summary = {
        total: ANALYTICS_VIEWS.length,
        idle: views.filter((v) => v.status === 'idle' && !v.isStale).length,
        refreshing: views.filter((v) => v.status === 'refreshing').length,
        failed: views.filter((v) => v.status === 'failed').length,
        stale: views.filter((v) => v.isStale && v.status !== 'refreshing').length,
      };

      ResponseUtil.success(
        res,
        {
          views,
          queue: { waiting, active, delayed, failed },
          summary,
          checkedAt: new Date().toISOString(),
        },
        'Analytics refresh status retrieved successfully',
      );
    } catch (err) {
      logger.error('[AnalyticsRefreshStatusController] Failed to get refresh status', {
        error: err instanceof Error ? err.message : String(err),
      });
      ResponseUtil.error(res, 'Failed to retrieve refresh status', 500);
    }
  },
};
