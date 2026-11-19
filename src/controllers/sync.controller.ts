import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { OfflineSyncService, SyncChange, SyncEntityType } from '../services/offline-sync.service';
import { OfflineQueueService } from '../services/offline-queue.service';
import { asyncHandler } from '../utils/asyncHandler.utils';

const VALID_ENTITY_TYPES: SyncEntityType[] = ['learning_goals', 'session_notes', 'booking_notes'];
const VALID_OPERATIONS = ['create', 'update', 'delete'];

function isValidChange(change: unknown): change is SyncChange {
  if (typeof change !== 'object' || change === null) return false;
  const c = change as Record<string, unknown>;
  return (
    typeof c.entityId === 'string' &&
    VALID_ENTITY_TYPES.includes(c.entityType as SyncEntityType) &&
    VALID_OPERATIONS.includes(c.operation as string) &&
    typeof c.vectorClock === 'object' &&
    c.vectorClock !== null
  );
}

export const SyncController = {
  /**
   * POST /api/v1/sync — batch-apply changes with vector clocks.
   * Returns HTTP 409 when any conflicts are detected, with both versions.
   */
  sync: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const deviceId = req.body.deviceId as string;
    const changes = req.body.changes as unknown[];

    if (!deviceId) {
      res.status(400).json({ success: false, error: 'deviceId is required' });
      return;
    }
    if (!Array.isArray(changes) || !changes.every(isValidChange)) {
      res.status(400).json({ success: false, error: 'changes must be a valid SyncChange[]' });
      return;
    }

    const result = await OfflineSyncService.syncChanges(userId, deviceId, changes as SyncChange[]);

    res.setHeader('X-Sync-Cursor', String(result.cursor));

    if (result.conflicts.length > 0) {
      res.status(409).json({
        success: false,
        error: 'Sync conflicts detected',
        data: result,
      });
      return;
    }

    res.json({ success: true, data: result });
  }),

  /**
   * GET /api/v1/sync/state?since={cursor} — incremental changes since cursor.
   */
  getState: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const since = parseInt(req.query.since as string, 10) || 0;

    const result = await OfflineSyncService.getChangesSince(userId, since);

    res.setHeader('X-Sync-Cursor', String(result.cursor));
    res.json({ success: true, data: result });
  }),

  /**
   * GET /api/v1/sync/conflicts
   * Returns all unresolved offline conflicts for the current user.
   */
  getConflicts: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;

    // Fetch all actions that are currently in a 'conflict' state
    const result = await OfflineQueueService.getActions(userId, { status: 'conflict' });

    // Map them into a clean schema for the client
    const conflicts = result.actions.map(action => ({
      actionId: action.id,
      actionType: action.actionType,
      clientKey: action.clientKey,
      clientTimestamp: action.clientTimestamp,
      conflictData: action.conflictData,
      payload: action.payload,
    }));

    res.json({
      success: true,
      data: {
        total: result.total,
        conflicts,
      }
    });
  }),
};
