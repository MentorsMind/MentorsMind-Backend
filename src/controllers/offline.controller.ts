/**
 * OfflineController
 *
 * Handles all offline support HTTP endpoints.
 *
 * Endpoints:
 *  GET  /offline/snapshot            — Full data snapshot for offline use
 *  GET  /offline/sync-state          — Current sync state per domain
 *  GET  /offline/delta               — Delta update for a specific domain
 *  POST /offline/queue               — Enqueue a single offline action
 *  GET  /offline/queue               — List queued actions
 *  GET  /offline/queue/status        — Queue status summary
 *  POST /offline/sync                — Full sync: enqueue actions + get deltas
 *  POST /offline/conflicts/:id/resolve — Resolve a conflict
 */

import { Request, Response } from 'express';
import { OfflineCacheService } from '../services/offline-cache.service';
import { OfflineQueueService, EnqueueInput } from '../services/offline-queue.service';
import { OfflineSyncService } from '../services/offline-sync.service';
import { logger } from '../utils/logger.utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as any).user?.userId ?? (req as any).user?.id;
}

const VALID_DOMAINS = [
  'bookings',
  'notifications',
  'profile',
  'goals',
  'messages',
] as const;

const VALID_ACTION_TYPES = [
  'booking:create',
  'booking:cancel',
  'booking:reschedule',
  'review:create',
  'note:create',
  'note:update',
  'goal:update',
  'profile:update',
  'message:send',
] as const;

// ─── Controller ───────────────────────────────────────────────────────────────

export const OfflineController = {
  /**
   * GET /offline/snapshot
   *
   * Returns a full offline data snapshot for the authenticated user.
   * Supports conditional requests via If-None-Match (ETag) — returns
   * 304 Not Modified if data hasn't changed.
   *
   * Query params:
   *  - refresh=true  Force rebuild even if cached
   */
  async getSnapshot(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const forceRefresh = req.query.refresh === 'true';

    try {
      // Conditional request: check ETag
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && !forceRefresh) {
        const serverEtag = await OfflineCacheService.getSnapshotEtag(userId);
        if (serverEtag && clientEtag === serverEtag) {
          res.status(304).end();
          return;
        }
      }

      const snapshot = await OfflineCacheService.buildSnapshot(
        userId,
        forceRefresh,
      );

      res.setHeader('ETag', snapshot.etag);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).json({ success: true, data: snapshot });
    } catch (err: any) {
      logger.error('OfflineController.getSnapshot error', {
        userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to build offline snapshot' });
    }
  },

  /**
   * GET /offline/sync-state
   *
   * Returns the server-side sync state (last synced timestamp + ETag) per domain.
   */
  async getSyncState(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);

    try {
      const syncStates = await OfflineCacheService.getSyncStates(userId);
      res.status(200).json({ success: true, data: { syncStates } });
    } catch (err: any) {
      logger.error('OfflineController.getSyncState error', {
        userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to get sync state' });
    }
  },

  /**
   * GET /offline/delta?domain=bookings&since=2026-01-01T00:00:00Z
   *
   * Returns records changed in a specific domain since a given timestamp.
   */
  async getDelta(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { domain, since } = req.query as {
      domain?: string;
      since?: string;
    };

    if (!domain || !since) {
      res.status(400).json({
        success: false,
        error: 'Query params "domain" and "since" are required',
      });
      return;
    }

    if (!(VALID_DOMAINS as readonly string[]).includes(domain)) {
      res.status(400).json({
        success: false,
        error: `Invalid domain. Must be one of: ${VALID_DOMAINS.join(', ')}`,
      });
      return;
    }

    if (isNaN(Date.parse(since))) {
      res.status(400).json({
        success: false,
        error: '"since" must be a valid ISO 8601 timestamp',
      });
      return;
    }

    try {
      const delta = await OfflineCacheService.getDelta(userId, domain, since);
      res.status(200).json({ success: true, data: delta });
    } catch (err: any) {
      logger.error('OfflineController.getDelta error', {
        userId,
        domain,
        error: err.message,
      });
      res.status(500).json({ success: false, error: 'Failed to compute delta' });
    }
  },

  /**
   * POST /offline/queue
   *
   * Enqueue a single offline action.
   *
   * Body: { clientKey, actionType, payload, clientTimestamp }
   */
  async enqueueAction(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { clientKey, actionType, payload, clientTimestamp } = req.body;

    if (!clientKey || !actionType || !payload || !clientTimestamp) {
      res.status(400).json({
        success: false,
        error:
          'clientKey, actionType, payload, and clientTimestamp are required',
      });
      return;
    }

    if (!/^[0-9a-f-]{36}$/i.test(clientKey)) {
      res
        .status(400)
        .json({ success: false, error: 'clientKey must be a valid UUID' });
      return;
    }

    if (!(VALID_ACTION_TYPES as readonly string[]).includes(actionType)) {
      res.status(400).json({
        success: false,
        error: `Invalid actionType. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
      });
      return;
    }

    if (isNaN(Date.parse(clientTimestamp))) {
      res.status(400).json({
        success: false,
        error: 'clientTimestamp must be a valid ISO 8601 timestamp',
      });
      return;
    }

    if (typeof payload !== 'object' || Array.isArray(payload)) {
      res
        .status(400)
        .json({ success: false, error: 'payload must be a JSON object' });
      return;
    }

    try {
      const action = await OfflineQueueService.enqueue({
        userId,
        clientKey,
        actionType,
        payload,
        clientTimestamp,
      });

      res
        .status(201)
        .json({ success: true, data: { actionId: action.id, status: action.status } });
    } catch (err: any) {
      logger.error('OfflineController.enqueueAction error', {
        userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to enqueue action' });
    }
  },

  /**
   * GET /offline/queue
   *
   * List queued actions for the authenticated user.
   *
   * Query params: status, limit, offset
   */
  async getQueue(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const {
      status,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string>;

    try {
      const result = await OfflineQueueService.getActions(userId, {
        status: status as any,
        limit: Math.min(parseInt(limit, 10) || 50, 200),
        offset: parseInt(offset, 10) || 0,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      logger.error('OfflineController.getQueue error', {
        userId,
        error: err.message,
      });
      res.status(500).json({ success: false, error: 'Failed to get queue' });
    }
  },

  /**
   * GET /offline/queue/status
   *
   * Returns a summary of the queue status for the authenticated user.
   */
  async getQueueStatus(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);

    try {
      const status = await OfflineQueueService.getQueueStatus(userId);
      res.status(200).json({ success: true, data: status });
    } catch (err: any) {
      logger.error('OfflineController.getQueueStatus error', {
        userId,
        error: err.message,
      });
      res
        .status(500)
        .json({ success: false, error: 'Failed to get queue status' });
    }
  },

  /**
   * POST /offline/sync
   *
   * Full sync endpoint: enqueue offline actions and get delta updates.
   *
   * Body:
   *  {
   *    syncState: { domains: { bookings: '2026-01-01T00:00:00Z', ... } },
   *    actions: [ { clientKey, actionType, payload, clientTimestamp }, ... ]
   *  }
   */
  async sync(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { syncState, actions = [] } = req.body;

    if (!syncState?.domains || typeof syncState.domains !== 'object') {
      res.status(400).json({
        success: false,
        error: 'syncState.domains is required and must be an object',
      });
      return;
    }

    if (!Array.isArray(actions)) {
      res
        .status(400)
        .json({ success: false, error: 'actions must be an array' });
      return;
    }

    // Validate each action
    for (const action of actions) {
      if (
        !action.clientKey ||
        !action.actionType ||
        !action.payload ||
        !action.clientTimestamp
      ) {
        res.status(400).json({
          success: false,
          error:
            'Each action must have clientKey, actionType, payload, and clientTimestamp',
        });
        return;
      }
    }

    try {
      const enrichedActions: EnqueueInput[] = actions.map((a: any) => ({
        ...a,
        userId,
      }));

      const result = await OfflineSyncService.sync({
        userId,
        syncState,
        actions: enrichedActions,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      logger.error('OfflineController.sync error', {
        userId,
        error: err.message,
      });
      res.status(500).json({ success: false, error: 'Sync failed' });
    }
  },

  /**
   * POST /offline/conflicts/:id/resolve
   *
   * Resolve a conflict for a specific queued action.
   *
   * Body: { strategy: 'client_wins' | 'server_wins' | 'merge', mergedPayload? }
   */
  async resolveConflict(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { id } = req.params;
    const { strategy, mergedPayload } = req.body;

    const validStrategies = ['client_wins', 'server_wins', 'merge'];
    if (!strategy || !validStrategies.includes(strategy)) {
      res.status(400).json({
        success: false,
        error: `strategy must be one of: ${validStrategies.join(', ')}`,
      });
      return;
    }

    if (
      strategy === 'merge' &&
      (!mergedPayload || typeof mergedPayload !== 'object')
    ) {
      res.status(400).json({
        success: false,
        error: 'mergedPayload is required when strategy is "merge"',
      });
      return;
    }

    try {
      const result = await OfflineQueueService.resolveConflict(
        userId,
        id,
        strategy,
        mergedPayload,
      );

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      logger.error('OfflineController.resolveConflict error', {
        userId,
        id,
        error: err.message,
      });
      const status = err.message === 'Action not found' ? 404 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  },
};
