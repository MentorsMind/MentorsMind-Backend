/**
 * Wallet Reconciliation Background Job
 *
 * Runs periodically (e.g., every 6 hours) to:
 * 1. Identify wallets with stale balances (not reconciled recently)
 * 2. Detect discrepancies between PostgreSQL and Stellar
 * 3. Automatically correct balance discrepancies
 * 4. Alert admins if high volumes of discrepancies found
 *
 * Schedule:
 * - Run every 6 hours: Reconcile wallets not checked in 24 hours
 * - Run every hour: Check for critical discrepancies
 * - Run daily: Full platform reconciliation stats
 */

import cron from "node-cron";
import { WalletReconciliationService } from "../services/wallet-reconciliation.service";
import { db } from "../config/database";
import { logger } from "../utils/logger.utils";

interface ReconciliationJobConfig {
  enabled: boolean;
  scheduleEvery6Hours: string; // cron expression
  scheduleHourly: string; // cron expression
  scheduleDaily: string; // cron expression
  maxReconciliationsPerRun: number;
  maxAgeHours: number;
  alertThresholds: {
    discrepanciesPercentage: number; // Alert if > X% of wallets have discrepancies
    averageDiscrepancyAmount: number; // Alert if average discrepancy > amount
  };
}

const config: ReconciliationJobConfig = {
  enabled: process.env.WALLET_RECONCILIATION_JOB_ENABLED !== "false",
  scheduleEvery6Hours: "0 */6 * * *", // Every 6 hours
  scheduleHourly: "0 * * * *", // Every hour
  scheduleDaily: "0 2 * * *", // 2 AM every day
  maxReconciliationsPerRun: 100,
  maxAgeHours: 24,
  alertThresholds: {
    discrepanciesPercentage: 10, // Alert if > 10% of wallets have discrepancies
    averageDiscrepancyAmount: 100, // Alert if average discrepancy > 100 XLM
  },
};

let jobs: cron.ScheduledTask[] = [];

/**
 * Main reconciliation job: Reconcile stale wallets
 * Runs every 6 hours
 */
async function reconcileStaleWalletsJob(): Promise<void> {
  const jobName = "ReconcileStaleWallets";
  const startTime = Date.now();

  try {
    logger.info(`[${jobName}] Starting wallet reconciliation job`, {
      maxReconciliations: config.maxReconciliationsPerRun,
      maxAgeHours: config.maxAgeHours,
    });

    const result = await WalletReconciliationService.reconcileAllWallets(
      config.maxReconciliationsPerRun,
      config.maxAgeHours
    );

    const duration = Date.now() - startTime;

    logger.info(`[${jobName}] Completed successfully`, {
      processed: result.processed,
      corrected: result.corrected,
      failed: result.failed,
      errorCount: result.errors.length,
      duration: `${(duration / 1000).toFixed(2)}s`,
    });

    // Alert if significant failures
    if (result.failed > 0 && result.failed / result.processed > 0.1) {
      logger.warn(`[${jobName}] High failure rate detected`, {
        failed: result.failed,
        total: result.processed,
        failureRate: ((result.failed / result.processed) * 100).toFixed(2) + "%",
        errors: result.errors.slice(0, 5), // First 5 errors
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`[${jobName}] Job failed`, {
      error: String(err),
      duration: `${(duration / 1000).toFixed(2)}s`,
    });
  }
}

/**
 * Quick check job: Monitor for critical discrepancies
 * Runs every hour
 */
async function checkCriticalDiscrepanciesJob(): Promise<void> {
  const jobName = "CheckCriticalDiscrepancies";

  try {
    logger.debug(`[${jobName}] Starting critical discrepancy check`);

    // Query for recent discrepancies
    const query = `
      SELECT 
        COUNT(DISTINCT user_id) as users_with_discrepancies,
        COUNT(*) as total_discrepancies,
        AVG(discrepancy_amount) as avg_discrepancy,
        MAX(discrepancy_amount) as max_discrepancy,
        COUNT(CASE WHEN discrepancy_reason = 'direct_payment' THEN 1 END) as direct_payments,
        COUNT(CASE WHEN discrepancy_reason = 'missed_event' THEN 1 END) as missed_events,
        COUNT(CASE WHEN discrepancy_reason = 'external_transaction' THEN 1 END) as external_txs
      FROM wallet_balance_discrepancies
      WHERE created_at > NOW() - INTERVAL '1 hour';
    `;

    const { rows } = await db.query(query);
    const stats = rows[0];

    logger.info(`[${jobName}] Hourly discrepancy report`, {
      usersAffected: stats.users_with_discrepancies,
      totalDiscrepancies: stats.total_discrepancies,
      averageDiscrepancy: stats.avg_discrepancy,
      maxDiscrepancy: stats.max_discrepancy,
      byReason: {
        direct_payments: stats.direct_payments,
        missed_events: stats.missed_events,
        external_transactions: stats.external_txs,
      },
    });

    // Alert if thresholds exceeded
    if (
      stats.total_discrepancies > 0 &&
      parseFloat(stats.avg_discrepancy) >
        config.alertThresholds.averageDiscrepancyAmount
    ) {
      logger.warn(`[${jobName}] High average discrepancy detected`, {
        averageDiscrepancy: stats.avg_discrepancy,
        threshold: config.alertThresholds.averageDiscrepancyAmount,
      });
    }
  } catch (err) {
    logger.error(`[${jobName}] Job failed`, {
      error: String(err),
    });
  }
}

/**
 * Daily statistics job: Generate platform-wide reconciliation report
 * Runs daily at 2 AM
 */
async function generateDailyReportJob(): Promise<void> {
  const jobName = "DailyReconciliationReport";

  try {
    logger.info(`[${jobName}] Generating daily reconciliation report`);

    const stats = await WalletReconciliationService.getReconciliationStats();

    const report = {
      timestamp: new Date().toISOString(),
      totalWallets: stats.totalWallets,
      walletsReconciled: stats.walletsReconciled,
      walletsNeedingReconciliation: stats.walletsNeedingReconciliation,
      percentageReconciled: (
        (stats.walletsReconciled / stats.totalWallets) *
        100
      ).toFixed(2),
      averageDiscrepancies: stats.averageDiscrepancies,
      totalCorrected: stats.totalDiscrepanciesCorrected,
    };

    logger.info(`[${jobName}] Daily report`, report);

    // Store report in database for history
    const query = `
      INSERT INTO wallet_reconciliation_reports 
      (report_date, data)
      VALUES (CURRENT_DATE, $1);
    `;

    await db.query(query, [JSON.stringify(report)]);

    // Alert if critical thresholds
    const percentageNeedingReconciliation = (
      (stats.walletsNeedingReconciliation / stats.totalWallets) *
      100
    ).toFixed(2);

    if (
      parseInt(percentageNeedingReconciliation) >
      config.alertThresholds.discrepanciesPercentage
    ) {
      logger.warn(`[${jobName}] High percentage of wallets need reconciliation`, {
        percentage: percentageNeedingReconciliation,
        threshold: config.alertThresholds.discrepanciesPercentage,
        wallets: stats.walletsNeedingReconciliation,
      });
    }
  } catch (err) {
    logger.error(`[${jobName}] Job failed`, {
      error: String(err),
    });
  }
}

/**
 * Initialize and start all reconciliation jobs
 */
export function startWalletReconciliationJobs(): void {
  if (!config.enabled) {
    logger.info("Wallet reconciliation jobs disabled");
    return;
  }

  logger.info("Starting wallet reconciliation background jobs");

  try {
    // Every 6 hours: Reconcile stale wallets
    jobs.push(
      cron.schedule(config.scheduleEvery6Hours, reconcileStaleWalletsJob, {
        name: "ReconcileStaleWallets",
      })
    );

    // Every hour: Check for critical discrepancies
    jobs.push(
      cron.schedule(config.scheduleHourly, checkCriticalDiscrepanciesJob, {
        name: "CheckCriticalDiscrepancies",
      })
    );

    // Daily: Generate report
    jobs.push(
      cron.schedule(config.scheduleDaily, generateDailyReportJob, {
        name: "DailyReconciliationReport",
      })
    );

    logger.info("Wallet reconciliation jobs started", {
      jobCount: jobs.length,
      schedules: {
        every6Hours: config.scheduleEvery6Hours,
        hourly: config.scheduleHourly,
        daily: config.scheduleDaily,
      },
    });
  } catch (err) {
    logger.error("Failed to start wallet reconciliation jobs", {
      error: String(err),
    });
  }
}

/**
 * Stop all reconciliation jobs
 */
export function stopWalletReconciliationJobs(): void {
  jobs.forEach((job) => {
    job.stop();
  });
  logger.info("Wallet reconciliation jobs stopped", { jobCount: jobs.length });
  jobs = [];
}

/**
 * Manually trigger a reconciliation job
 * Useful for testing or immediate reconciliation
 */
export async function triggerReconciliationJob(): Promise<void> {
  logger.info("Manually triggering wallet reconciliation job");
  await reconcileStaleWalletsJob();
}

/**
 * Manually trigger critical discrepancy check
 */
export async function triggerCriticalCheckJob(): Promise<void> {
  logger.info("Manually triggering critical discrepancy check job");
  await checkCriticalDiscrepanciesJob();
}

/**
 * Manually trigger daily report generation
 */
export async function triggerDailyReportJob(): Promise<void> {
  logger.info("Manually triggering daily report job");
  await generateDailyReportJob();
}

export { config as walletReconciliationJobConfig };
