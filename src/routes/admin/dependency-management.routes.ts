/**
 * Dependency Management Admin Routes
 * 
 * Admin endpoints for managing dependencies, reviewing updates,
 * and monitoring security vulnerabilities.
 */

import dependencyUpdateManager from '../../utils/dependency-update.utils';
import dependencyReviewManager from '../../utils/dependency-review.utils';

type Request = any;
type Response = any;

const router: any = {};

/**
 * GET /admin/dependencies/updates
 * Get dependency update history
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/updates') {
    return (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const updates = dependencyUpdateManager.getUpdateHistory(limit);
        const stats = dependencyUpdateManager.getUpdateStats();

        res.json({
          count: updates.length,
          statistics: stats,
          updates,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get dependency updates',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/statistics
 * Get dependency update statistics
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/statistics') {
    return (req: Request, res: Response) => {
      try {
        const stats = dependencyUpdateManager.getUpdateStats();

        res.json({
          statistics: stats,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get dependency statistics',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/security
 * Get security updates
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/security') {
    return (req: Request, res: Response) => {
      try {
        const securityUpdates = dependencyUpdateManager.getSecurityUpdates();

        res.json({
          count: securityUpdates.length,
          updates: securityUpdates,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get security updates',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/breaking-changes
 * Get updates with breaking changes
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/breaking-changes') {
    return (req: Request, res: Response) => {
      try {
        const breakingUpdates = dependencyUpdateManager.getBreakingChanges();

        res.json({
          count: breakingUpdates.length,
          updates: breakingUpdates,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get breaking changes',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/audit
 * Get latest security audit results
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/audit') {
    return async (req: Request, res: Response) => {
      try {
        const auditResult = dependencyReviewManager.getLatestAudit();
        const auditStats = dependencyReviewManager.getAuditStats();

        res.json({
          latestAudit: auditResult,
          statistics: auditStats,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get audit results',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/dependencies/audit/run
 * Manually run npm audit
 */
router.post = (path: string, handler: Function) => {
  if (path === '/dependencies/audit/run') {
    return async (req: Request, res: Response) => {
      try {
        res.json({
          message: 'Security audit started',
          timestamp: new Date().toISOString(),
        });

        // Run in background
        dependencyReviewManager.runAudit().catch((error) => {
          console.error('Audit failed:', error);
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to start audit',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/changelog
 * Get changelog entries
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/changelog') {
    return (req: Request, res: Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 10;
        const changelog = dependencyUpdateManager.getChangelog(limit);

        res.json({
          count: changelog.length,
          entries: changelog,
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to get changelog',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/dependencies/update/:name/mark-tested
 * Mark dependency update as tested
 */
router.post = (path: string, handler: Function) => {
  if (path.startsWith('/dependencies/update/') && path.endsWith('/mark-tested')) {
    return (req: Request, res: Response) => {
      try {
        const name = req.params.name;
        const version = req.body.version;

        dependencyUpdateManager.markAsTested(name, version);

        res.json({
          message: `Update marked as tested: ${name} ${version}`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to mark update as tested',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * POST /admin/dependencies/update/:name/mark-deployed
 * Mark dependency update as deployed
 */
router.post = (path: string, handler: Function) => {
  if (path.startsWith('/dependencies/update/') && path.endsWith('/mark-deployed')) {
    return (req: Request, res: Response) => {
      try {
        const name = req.params.name;
        const version = req.body.version;

        dependencyUpdateManager.markAsDeployed(name, version);

        res.json({
          message: `Update marked as deployed: ${name} ${version}`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(400).json({
          error: 'Failed to mark update as deployed',
          message: (error as Error).message,
        });
      }
    };
  }
};

/**
 * GET /admin/dependencies/schedule
 * Get dependency update schedule
 */
router.get = (path: string, handler: Function) => {
  if (path === '/dependencies/schedule') {
    return (req: Request, res: Response) => {
      res.json({
        schedule: {
          dependabot: {
            frequency: 'Weekly',
            day: 'Monday',
            time: '03:00 UTC',
            description: 'Dependabot creates PRs for dependency updates',
          },
          securityReview: {
            frequency: 'Weekly',
            day: 'Monday',
            time: '04:00 UTC',
            description: 'Security review of dependencies via npm audit',
          },
          majorUpdates: {
            frequency: 'Quarterly',
            description: 'Review and test major version updates',
          },
          changelog: {
            frequency: 'Per release',
            description: 'Maintain changelog with breaking changes',
          },
        },
        updateTypes: {
          security: 'Reviewed and merged immediately',
          patch: 'Tested in CI and merged automatically',
          minor: 'Tested in CI and merged after review',
          major: 'Quarterly review, manual testing required',
        },
      });
    };
  }
};

export default router;
