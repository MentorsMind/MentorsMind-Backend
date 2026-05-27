/**
 * Database Maintenance Admin Routes
 * 
 * Admin endpoints for managing database maintenance operations,
 * monitoring, and viewing maintenance history.
 */

import databaseMaintenanceManager from '../../utils/database-maintenance.utils';
import databaseMaintenanceJob from '../../jobs/database-maintenance.job';

type Router = any;
type Request = any;
type Response = any;

const router: Router = {};

/**
 * GET /admin/maintenance/status
 * Get current maintenance job status
 */
router.get('/maintenance/status', (req: Request, res: Response) => {
  try {
    const jobStatus = databaseMaintenanceJob.getStatus();
    const maintenanceStats = databaseMaintenanceManager.getMaintenanceStats();

    res.json({
      jobs: jobStatus,
      statistics: maintenanceStats,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get maintenance status',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /admin/maintenance/history
 * Get maintenance operation history
 */
router.get('/maintenance/history', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = databaseMaintenanceManager.getMaintenanceHistory(limit);

    res.json({
      count: history.length,
      history,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get maintenance history',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /admin/maintenance/statistics
 * Get maintenance statistics
 */
router.get('/maintenance/statistics', (req: Request, res: Response) => {
  try {
    const stats = databaseMaintenanceManager.getMaintenanceStats();

    res.json({
      statistics: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get maintenance statistics',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /admin/maintenance/vacuum
 * Manually trigger VACUUM operation
 */
router.post('/maintenance/vacuum', async (req: Request, res: Response) => {
  try {
    const full = req.body.full || false;

    res.json({
      message: 'VACUUM operation started',
      type: full ? 'VACUUM FULL' : 'VACUUM',
      timestamp: new Date().toISOString(),
    });

    // Run in background
    databaseMaintenanceManager.runVacuum(full).catch((error) => {
      console.error('VACUUM operation failed:', error);
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start VACUUM operation',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /admin/maintenance/analyze
 * Manually trigger ANALYZE operation
 */
router.post('/maintenance/analyze', async (req: Request, res: Response) => {
  try {
    res.json({
      message: 'ANALYZE operation started',
      timestamp: new Date().toISOString(),
    });

    // Run in background
    databaseMaintenanceManager.runAnalyze().catch((error) => {
      console.error('ANALYZE operation failed:', error);
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start ANALYZE operation',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /admin/maintenance/index-rebuild
 * Manually trigger index rebuild operation
 */
router.post('/maintenance/index-rebuild', async (req: Request, res: Response) => {
  try {
    const threshold = req.body.threshold || 30;

    res.json({
      message: 'Index rebuild operation started',
      threshold,
      timestamp: new Date().toISOString(),
    });

    // Run in background
    databaseMaintenanceManager.rebuildFragmentedIndexes(threshold).catch((error) => {
      console.error('Index rebuild operation failed:', error);
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start index rebuild operation',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /admin/maintenance/bloat-check
 * Manually trigger table bloat check
 */
router.post('/maintenance/bloat-check', async (req: Request, res: Response) => {
  try {
    res.json({
      message: 'Table bloat check started',
      timestamp: new Date().toISOString(),
    });

    // Run in background
    databaseMaintenanceManager.checkTableBloat().catch((error) => {
      console.error('Bloat check operation failed:', error);
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start bloat check operation',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /admin/maintenance/full-cycle
 * Manually trigger full maintenance cycle
 */
router.post('/maintenance/full-cycle', async (req: Request, res: Response) => {
  try {
    res.json({
      message: 'Full maintenance cycle started',
      operations: ['VACUUM', 'ANALYZE', 'Bloat Check', 'Index Rebuild'],
      timestamp: new Date().toISOString(),
    });

    // Run in background
    databaseMaintenanceManager.runFullMaintenanceCycle().catch((error) => {
      console.error('Full maintenance cycle failed:', error);
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to start full maintenance cycle',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /admin/maintenance/schedule
 * Get maintenance schedule information
 */
router.get('/maintenance/schedule', (req: Request, res: Response) => {
  res.json({
    schedule: {
      vacuum: {
        frequency: 'Weekly',
        day: 'Sunday',
        time: '02:00 UTC',
        description: 'Reclaims disk space and removes dead rows',
      },
      analyze: {
        frequency: 'Weekly',
        day: 'Sunday',
        time: '03:00 UTC',
        description: 'Updates table statistics for query planner',
      },
      indexRebuild: {
        frequency: 'Monthly',
        day: 'First Sunday of month',
        time: '04:00 UTC',
        description: 'Rebuilds fragmented indexes (>30% fragmentation)',
      },
      bloatCheck: {
        frequency: 'Weekly',
        day: 'Monday',
        time: '01:00 UTC',
        description: 'Monitors table bloat (>20% threshold)',
      },
    },
    nextScheduledOperations: databaseMaintenanceJob.getStatus(),
  });
});

/**
 * DELETE /admin/maintenance/history
 * Clear maintenance history
 */
router.delete('/maintenance/history', (req: Request, res: Response) => {
  try {
    databaseMaintenanceManager.clearHistory();

    res.json({
      message: 'Maintenance history cleared',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear maintenance history',
      message: (error as Error).message,
    });
  }
});

export default router;
