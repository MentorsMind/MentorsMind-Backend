import { Queue, Worker, Job } from "bullmq";
import { redisConnection, defaultJobOptions } from "../config/queue";
import { logger } from "../utils/logger.utils";
import { DisputeResolutionService } from "../services/dispute-resolution.service";
import { DisputeModel } from "../models/dispute.model";

export enum DisputeJobType {
  ESCALATE_STALE = "dispute-escalate-stale",
  AUTO_MEDIATE = "dispute-auto-mediate",
  RESOLUTION_REMINDER = "dispute-resolution-reminder",
  EVIDENCE_REVIEW = "dispute-evidence-review",
}

const disputeQueue = new Queue("disputes", {
  connection: redisConnection,
  defaultJobOptions,
});

/**
 * Initialize dispute workflow workers
 */
export function initializeDisputeWorkers(): void {
  const worker = new Worker(
    "disputes",
    async (job: Job) => {
      switch (job.name) {
        case DisputeJobType.ESCALATE_STALE:
          return handleEscalateStale(job);
        case DisputeJobType.AUTO_MEDIATE:
          return handleAutoMediate(job);
        case DisputeJobType.RESOLUTION_REMINDER:
          return handleResolutionReminder(job);
        case DisputeJobType.EVIDENCE_REVIEW:
          return handleEvidenceReview(job);
        default:
          logger.warn(`Unknown dispute job type: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    logger.info(`Dispute job completed: ${job.name}`, { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error(`Dispute job failed: ${job?.name}`, {
      jobId: job?.id,
      error: err.message,
    });
  });

  logger.info("Dispute workers initialized");
}

/**
 * Schedule periodic checks for stale disputes
 */
export async function scheduleStaleDisputeCheck(): Promise<void> {
  await disputeQueue.add(
    DisputeJobType.ESCALATE_STALE,
    {},
    {
      repeat: { pattern: "0 */6 * * *" }, // Every 6 hours
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

/**
 * Schedule a resolution reminder for a specific dispute
 */
export async function scheduleResolutionReminder(
  disputeId: string,
  daysSinceFiled: number,
): Promise<void> {
  const delay = Math.max(0, (7 - daysSinceFiled) * 24 * 60 * 60 * 1000); // 7 days target
  await disputeQueue.add(
    DisputeJobType.RESOLUTION_REMINDER,
    { disputeId },
    {
      delay,
      removeOnComplete: true,
    },
  );
}

// ─── Job Handlers ─────────────────────────────────────────────────────────────

async function handleEscalateStale(job: Job): Promise<void> {
  const staleDisputes = await DisputeResolutionService.getStaleDisputes(7);

  for (const dispute of staleDisputes) {
    try {
      // Auto-escalate disputes older than 14 days
      const daysOld = Math.floor(
        (Date.now() - new Date(dispute.created_at).getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysOld >= 14 && dispute.status !== "escalated") {
        await DisputeResolutionService.transitionStatus(
          dispute.id,
          "escalated",
          "system",
          `Auto-escalated: dispute open for ${daysOld} days`,
        );

        logger.info("Dispute auto-escalated", {
          disputeId: dispute.id,
          daysOld,
        });
      }
    } catch (error) {
      logger.error("Failed to escalate stale dispute", {
        disputeId: dispute.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return Promise.resolve();
}

async function handleAutoMediate(job: Job): Promise<void> {
  // Placeholder for AI-assisted mediation logic
  // Would analyze evidence and suggest resolution
  logger.info("Auto-mediate handler invoked", { jobId: job.id });
  return Promise.resolve();
}

async function handleResolutionReminder(job: Job): Promise<void> {
  const { disputeId } = job.data;

  try {
    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute || ["resolved", "dismissed"].includes(dispute.status)) {
      return Promise.resolve();
    }

    // Emit reminder to admin/moderator
    logger.info("Resolution reminder triggered", { disputeId });
  } catch (error) {
    logger.error("Failed to send resolution reminder", {
      disputeId,
      error: error instanceof Error ? error.message : error,
    });
  }

  return Promise.resolve();
}

async function handleEvidenceReview(job: Job): Promise<void> {
  // Placeholder for evidence review logic
  logger.info("Evidence review handler invoked", { jobId: job.id });
  return Promise.resolve();
}

/**
 * Get dispute queue metrics
 */
export async function getDisputeQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    disputeQueue.getWaitingCount(),
    disputeQueue.getActiveCount(),
    disputeQueue.getCompletedCount(),
    disputeQueue.getFailedCount(),
    disputeQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}
