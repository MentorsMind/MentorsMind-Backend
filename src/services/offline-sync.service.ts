/**
 * OfflineSyncService
 *
 * Orchestrates the full sync cycle when a mobile client reconnects.
 *
 * Sync flow:
 *  1. Client reconnects (Socket.IO or HTTP).
 *  2. Client sends its local sync state (domain → lastSyncedAt).
 *  3. Server computes delta updates for each domain.
 *  4. Server processes the client's queued offline actions.
 *  5. Server returns delta data + action results in a single response.
 *  6. Client applies deltas and resolves any conflicts.
 */

import { OfflineCacheService } from './offline-cache.service';
import { OfflineQueueService, EnqueueInput, ProcessResult } from './offline-queue.service';
import { SocketService } from './socket.service';
import { logger } from '../utils/logger.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientSyncState {
  /** domain → ISO timestamp of last successful sync */
  domains: Record<string, string>;
}

export interface SyncRequest {
  userId: string;
  syncState: ClientSyncState;
  actions: EnqueueInput[];
}

export interface SyncResponse {
  syncedAt: string;
  deltas: Record<
    string,
    {
      records: unknown[];
      deletedIds: string[];
      newEtag: string;
      recordCount: number;
    }
  >;
  actionResults: ProcessResult[];
  conflicts: ProcessResult[];
  summary: {
    domainsUpdated: number;
    actionsProcessed: number;
    actionsCompleted: number;
    actionsFailed: number;
    conflictsDetected: number;
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const OfflineSyncService = {
  /**
   * Execute a full sync cycle for a reconnecting client.
   */
  async sync(request: SyncRequest): Promise<SyncResponse> {
    const { userId, syncState, actions } = request;
    const syncedAt = new Date().toISOString();

    logger.info('OfflineSyncService: sync started', {
      userId,
      domains: Object.keys(syncState.domains),
      actionCount: actions.length,
    });

    // Step 1: Persist offline actions
    if (actions.length > 0) {
      await OfflineQueueService.enqueueBatch(actions);
    }

    // Step 2: Compute delta updates for each domain in parallel
    const deltaEntries = await Promise.all(
      Object.entries(syncState.domains).map(async ([domain, since]) => {
        try {
          const delta = await OfflineCacheService.getDelta(userId, domain, since);
          return [domain, delta] as const;
        } catch (err: any) {
          logger.warn('OfflineSyncService: delta fetch failed', {
            userId,
            domain,
            error: err.message,
          });
          return [domain, null] as const;
        }
      }),
    );

    const deltas: SyncResponse['deltas'] = {};
    for (const [domain, delta] of deltaEntries) {
      if (delta) {
        deltas[domain] = {
          records: delta.records,
          deletedIds: delta.deletedIds,
          newEtag: delta.newEtag,
          recordCount: delta.recordCount,
        };
      }
    }

    // Step 3: Process queued actions
    const actionResults = await OfflineQueueService.processQueue(userId);

    const completed = actionResults.filter((r) => r.status === 'completed');
    const failed = actionResults.filter((r) => r.status === 'failed');
    const conflicts = actionResults.filter((r) => r.status === 'conflict');

    // Step 4: Invalidate snapshot cache if any actions succeeded
    if (completed.length > 0) {
      await OfflineCacheService.invalidateSnapshot(userId);
    }

    // Step 5: Notify client via Socket.IO
    SocketService.emitToUser(userId, 'offline:sync:complete', {
      syncedAt,
      actionsCompleted: completed.length,
      actionsFailed: failed.length,
      conflictsDetected: conflicts.length,
      domainsUpdated: Object.keys(deltas).length,
    });

    // Emit individual conflict events so the client can prompt the user
    for (const conflict of conflicts) {
      SocketService.emitToUser(userId, 'offline:conflict', {
        clientKey: conflict.clientKey,
        conflictData: conflict.conflictData,
      });
    }

    const summary = {
      domainsUpdated: Object.keys(deltas).length,
      actionsProcessed: actionResults.length,
      actionsCompleted: completed.length,
      actionsFailed: failed.length,
      conflictsDetected: conflicts.length,
    };

    logger.info('OfflineSyncService: sync complete', { userId, ...summary });

    return { syncedAt, deltas, actionResults, conflicts, summary };
  },

  /**
   * Lightweight sync triggered when a Socket.IO client reconnects.
   * Processes any pending queue items and emits results via Socket.IO.
   * The client should call GET /api/v1/offline/delta for domain data.
   */
  async onSocketReconnect(userId: string): Promise<void> {
    logger.info('OfflineSyncService: socket reconnect sync', { userId });

    try {
      const actionResults = await OfflineQueueService.processQueue(userId);
      if (actionResults.length === 0) return;

      const completed = actionResults.filter((r) => r.status === 'completed');
      const failed = actionResults.filter((r) => r.status === 'failed');
      const conflicts = actionResults.filter((r) => r.status === 'conflict');

      if (completed.length > 0) {
        await OfflineCacheService.invalidateSnapshot(userId);
      }

      SocketService.emitToUser(userId, 'offline:sync:complete', {
        syncedAt: new Date().toISOString(),
        actionsCompleted: completed.length,
        actionsFailed: failed.length,
        conflictsDetected: conflicts.length,
        domainsUpdated: 0,
        note: 'Call GET /api/v1/offline/delta for domain updates',
      });

      for (const conflict of conflicts) {
        SocketService.emitToUser(userId, 'offline:conflict', {
          clientKey: conflict.clientKey,
          conflictData: conflict.conflictData,
        });
      }
    } catch (err: any) {
      logger.error('OfflineSyncService: socket reconnect sync failed', {
        userId,
        error: err.message,
      });
    }
  },
};
