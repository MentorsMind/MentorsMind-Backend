/**
 * Analytics refresh is now scheduled via BullMQ (analyticsRefresh.queue.ts + analyticsRefresh.worker.ts).
 * BullMQ's distributed locking ensures only one instance processes the job per interval,
 * preventing duplicate REFRESH MATERIALIZED VIEW calls in multi-instance deployments.
 *
 * This file is retained for reference only. The CronJob-based implementation has been removed.
 */
