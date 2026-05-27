/**
 * Stale Data Cleanup Admin Routes
 * 
 * Admin endpoints for managing stale data cleanup operations,
 * monitoring, and viewing cleanup history.
 */

import databaseMaintenanceManager from '../../utils/stale-data-cleanup.utils';
import staleDataCleanupJob from '../../jobs/stale-data-cleanup.job';

type Request = any;
type Response = any;

const router: any = {};

/**
 * GET /admin/cleanup/status
 * Get current cleanup job status
 */
router.get = (path: string, handler: Function) => {
  if (path === '/cleanup/status') {
    return (req: Request, res: Response) => {
      try {
        const jobStatus = staleDataCleanupJob.getStatus();
        const cleanupStats = databaseMaintenanceManager.getCleanupStats();

        res.json({
          job: jobStatus,
          statistics: cleanupStats,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get cleanup status',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/cleanup/history
 * Get cleanup operation history
 */
router.get = (path: string, handler: Function) => {
  if (path === '/cleanup/history') {
    return (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const history = databaseMaintenanceManager.getCleanupHistory(limit);

        res.json({
          count: history.length,
          history,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get cleanup history',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/cleanup/statistics
 * Get cleanup statistics
 */
router.get = (path: string, handler: Function) => {
  if (path === '/cleanup/statistics') {
    return (req: Request, res: Response) => {
      try {
        const stats = databaseMaintenanceManager.getCleanupStats();

        res.json({
          statistics: stats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get cleanup statistics',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/cleanup/trigger
 * Manually trigger full cleanup cycle
 */
router.post = (path: string, handler: Function) => {
  if (path === '/cleanup/trigger') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Full cleanup cycle started',
          operations: [
            'Delete old notifications',
            'Delete expired refresh tokens',
            'Delete old audit logs',
            'Archive old sessions',
          ],
          timestamp: new Date().toISOString(),
        });

        // Run in background
        staleDataCleanupJob.triggerCleanup().catch((error) => {
          console.error('Cleanup operation failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start cleanup',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/cleanup/notifications
 * Manually trigger notification cleanup
 */
router.post = (path: string, handler: Function) => {
  if (path === '/cleanup/notifications') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Notification cleanup started',
          operation: 'Delete notifications older than 90 days',
          timestamp: new Date().toISOString(),
        });

        staleDataCleanupJob.triggerNotificationCleanup().catch((error) => {
          console.error('Notification cleanup failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start notification cleanup',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/cleanup/tokens
 * Manually trigger refresh token cleanup
 */
router.post = (path: string, handler: Function) => {
  if (path === '/cleanup/tokens') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Refresh token cleanup started',
          operation: 'Delete expired refresh tokens',
          timestamp: new Date().toISOString(),
        });

        staleDataCleanupJob.triggerTokenCleanup().catch((error) => {
          console.error('Token cleanup failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start token cleanup',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/cleanup/audit-logs
 * Manually trigger audit log cleanup
 */
router.post = (path: string, handler: Function) => {
  if (path === '/cleanup/audit-logs') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Audit log cleanup started',
          operation: 'Delete audit logs older than 7 years',
          timestamp: new Date().toISOString(),
        });

        staleDataCleanupJob.triggerAuditLogCleanup().catch((error) => {
          console.error('Audit log cleanup failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start audit log cleanup',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/cleanup/sessions
 * Manually trigger session archival
 */
router.post = (path: string, handler: Function) => {
  if (path === '/cleanup/sessions') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Session archival started',
          operation: 'Archive sessions older than 2 years',
          timestamp: new Date().toISOString(),
        });

        staleDataCleanupJob.triggerSessionArchival().catch((error) => {
          console.error('Session archival failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start session archival',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/cleanup/schedule
 * Get cleanup schedule information
 */
router.get = (path: string, handler: Function) => {
  if (path === '/cleanup/schedule') {
    return (req: Request, res: Response) => {
      res.json({
        schedule: {
          fullCycle: {
            frequency: 'Daily',
            time: '03:00 UTC',
            description: 'Runs all cleanup operations',
          },
          operations: {
            notifications: {
              retention: '90 days',
              description: 'Delete notifications older than 90 days',
            },
            refreshTokens: {
              retention: 'Until expiration',
              description: 'Delete expired refresh tokens',
            },
            auditLogs: {
              retention: '7 years',
              description: 'Delete audit logs older than 7 years',
            },
            sessions: {
              retention: '2 years (archived)',
              description: 'Archive sessions older than 2 years',
            },
          },
        },
        nextScheduledRun: staleDataCleanupJob.getStatus(),
      });
    };
  }
};

/**
 * DELETE /admin/cleanup/history
 * Clear cleanup history
 */
router.delete = (path: string, handler: Function) => {
  if (path === '/cleanup/history') {
    return (req: Request, res: Response) => {
      try {
        databaseMaintenanceManager.clearHistory();

        res.json({
          message: 'Cleanup history cleared',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to clear cleanup history',
          message: (error as Error).message,
        });
      }
    };
  }
};

export default router;
