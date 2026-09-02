/**
 * Outbox worker — polls `outbox_events` and dispatches events to BullMQ.
 *
 * Loop (one tick):
 *  1. BEGIN transaction
 *  2. `OutboxModel.claimBatch` (FOR UPDATE SKIP LOCKED + UPDATE)
 *  3. Group claimed events by destination queue
 *  4. Call `addBulk` on each destination queue
 *  5. UPDATE status='processed' on the rows
 *  6. COMMIT
 *
 * On error for a single event: mark `failed` (or `dead_letter` past
 * OUTBOX_MAX_ATTEMPTS) and schedule an exponential-backoff retry.
 *
 * Crashed-worker recovery: rows in `processing` past their `locked_until`
 * are reclaimed by step 2 above on the next tick.
 *
 * @see docs/OUTBOX_PATTERN.md for the architecture.
 */

import { Queue } from "bullmq";
import { Pool, PoolClient } from "pg";
import { redisConnection } from "../config/queue";
import {
  OutboxModel,
  OUTBOX_DEFAULT_LEASE_SECONDS,
  OUTBOX_POLL_BATCH_SIZE,
  type OutboxEventRecord,
} from "../models/outbox.model";
import { OUTBOX_DESTINATION } from "../services/outbox.service";
import { DatabaseService } from "../services/database.service";
import {
  translateOutboxToJobs,
  groupJobsByDestination,
  type DispatchedJob,
} from "../services/outbox-dispatcher";
import { logger } from "../utils/logger.utils";

// ─── Tunables (env-overridable) ──────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(
  process.env.OUTBOX_POLL_INTERVAL_MS ?? "500",
  10,
);
const POLL_BATCH_SIZE = parseInt(
  process.env.OUTBOX_POLL_BATCH_SIZE ?? String(OUTBOX_POLL_BATCH_SIZE),
  10,
);
const ENABLE_NOTIFY_WAKEUP = process.env.OUTBOX_NOTIFY_WAKEUP !== "false";
const SHUTDOWN_GRACE_MS = parseInt(
  process.env.OUTBOX_SHUTDOWN_GRACE_MS ?? "15000",
  10,
);

// ─── Destinations → BullMQ Queue caches ───────────────────────────────────────

const queueCache = new Map<string, Queue>();

function queueFor(destination: string): Queue {
  let q = queueCache.get(destination);
  if (!q) {
    q = new Queue(destination, {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: false,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
    queueCache.set(destination, q);
  }
  return q;
}

// ─── Outbox worker lifecycle ──────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;
let notifyPool: Pool | null = null;
let notifyListenClient: PoolClient | null = null;
let stopping = false;
let activeTick: Promise<void> | null = null;

async function tick(): Promise<void> {
  if (stopping) return;

  const startTime = Date.now();
  let claimed: OutboxEventRecord[] = [];

  try {
    await DatabaseService.withTransaction(
      async (client) => {
        claimed = await OutboxModel.claimBatch(
          POLL_BATCH_SIZE,
          OUTBOX_DEFAULT_LEASE_SECONDS,
          client,
        );

        if (claimed.length === 0) {
          return;
        }

        // Track which outbox events have at least one downstream job.
        // Conservative: only an event with all jobs dispatched is fully
        // processed; an event whose jobs failed is markFailed below.
        const processedSet = new Set<string>();
        const eventToJobIds = new Map<string, string[]>();

        const allJobs: DispatchedJob[] = [];
        for (const ev of claimed) {
          const jobs = translateOutboxToJobs(ev);
          if (jobs.length === 0) {
            processedSet.add(ev.id);
            continue;
          }
          const ids: string[] = [];
          for (const j of jobs) {
            allJobs.push(j);
            ids.push(j.jobId ?? `${j.destination}:${allJobs.length}`);
          }
          eventToJobIds.set(ev.id, ids);
        }

        const grouped = groupJobsByDestination(allJobs);

        for (const [destination, jobs] of Array.from(grouped.entries())) {
          const queue = queueFor(destination);
          try {
            await queue.addBulk(
              jobs.map((j) => ({
                name: j.name,
                data: j.data,
                opts: j.jobId ? { jobId: j.jobId } : undefined,
              })),
            );
            for (const j of jobs) {
              for (const [eventId, jobIds] of Array.from(eventToJobIds.entries())) {
                if (jobIds.includes(j.jobId ?? "")) {
                  processedSet.add(eventId);
                }
              }
            }
            logger.debug(
              { destination, count: jobs.length },
              "[OutboxWorker] Dispatched batch",
            );
          } catch (batchErr) {
            logger.error(
              { err: batchErr, destination, count: jobs.length },
              "[OutboxWorker] Bulk enqueue failed — falling back to per-event enqueue",
            );
            // Per-event fallback so a single bad event does not poison
            // the whole batch.
            for (const j of jobs) {
              let ownerEventId: string | null = null;
              for (const [eventId, jobIds] of Array.from(eventToJobIds.entries())) {
                if (jobIds.includes(j.jobId ?? "")) {
                  ownerEventId = eventId;
                  break;
                }
              }
              try {
                await queue.add(
                  j.name,
                  j.data,
                  j.jobId ? { jobId: j.jobId } : undefined,
                );
                if (ownerEventId) processedSet.add(ownerEventId);
              } catch (singleErr) {
                if (ownerEventId) {
                  const matched = claimed.find((c) => c.id === ownerEventId);
                  await OutboxModel.markFailed(
                    ownerEventId,
                    singleErr instanceof Error
                      ? singleErr.message
                      : String(singleErr),
                    matched?.attempts ?? 1,
                    client,
                  );
                }
              }
            }
          }
        }

        const fullyProcessed = Array.from(processedSet);
        if (fullyProcessed.length > 0) {
          await OutboxModel.markProcessed(fullyProcessed, client);
        }
      },
      { maxRetries: 0 },
    );

    if (claimed.length > 0) {
      logger.info(
        { processed: claimed.length, durationMs: Date.now() - startTime },
        "[OutboxWorker] Tick completed",
      );
    }
  } catch (err) {
    logger.error({ err }, "[OutboxWorker] Tick failed at the outer level");
  }
}

function scheduleNext(): void {
  if (stopping) return;
  pollTimer = setTimeout(async () => {
    activeTick = tick().finally(() => {
      activeTick = null;
    });
    await activeTick;
    scheduleNext();
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

async function startNotify(): Promise<void> {
  if (!ENABLE_NOTIFY_WAKEUP) return;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn(
      "[OutboxWorker] DATABASE_URL not set — falling back to timer-only polling",
    );
    return;
  }

  try {
    notifyPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
    });

    notifyPool.on("error", (err) => {
      logger.warn({ err }, "[OutboxWorker] Notify pool error (non-fatal)");
    });

    // pg Pool does NOT emit 'notification' events; the *client* does.
    // We keep a dedicated long-lived client so the LISTEN subscription
    // stays active for the lifetime of the worker.
    notifyListenClient = await notifyPool.connect();
    notifyListenClient.on("error", (err) => {
      logger.warn({ err }, "[OutboxWorker] Notify client error (non-fatal)");
    });

    await notifyListenClient.query("LISTEN outbox_event");

    notifyListenClient.on("notification", () => {
      if (stopping) return;
      void tick();
    });

    logger.info("[OutboxWorker] LISTEN/NOTIFY wake-up enabled");
  } catch (err) {
    logger.warn(
      { err },
      "[OutboxWorker] Could not enable LISTEN/NOTIFY — falling back to timer only",
    );
    if (notifyPool) {
      if (notifyListenClient) {
        notifyListenClient.release();
        notifyListenClient = null;
      }
      await notifyPool.end().catch(() => undefined);
      notifyPool = null;
    }
  }
}

/**
 * Start the outbox worker. Idempotent — calling twice is a no-op.
 */
export async function startOutboxWorker(): Promise<void> {
  if (pollTimer) return;
  stopping = false;
  logger.info(
    { pollIntervalMs: POLL_INTERVAL_MS, batchSize: POLL_BATCH_SIZE },
    "[OutboxWorker] Starting polling loop",
  );
  scheduleNext();
  await startNotify();
}

/**
 * Stop the worker, drain any in-flight tick, close queues / pool.
 */
export async function stopOutboxWorker(): Promise<void> {
  stopping = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (activeTick) {
    logger.info("[OutboxWorker] Waiting for in-flight tick to finish...");
    await Promise.race([
      activeTick,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
  }

  await Promise.all(
    Array.from(queueCache.values()).map((q) => q.close().catch(() => undefined)),
  );
  queueCache.clear();

  if (notifyPool) {
    if (notifyListenClient) {
      notifyListenClient.release();
      notifyListenClient = null;
    }
    await notifyPool.end().catch(() => undefined);
    notifyPool = null;
  }

  logger.info("[OutboxWorker] Stopped");
}
