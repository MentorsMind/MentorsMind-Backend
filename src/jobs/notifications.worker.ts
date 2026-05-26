import { Worker, Job } from "bullmq";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { SocketService } from '../services/socket.service';
import { PushService } from '../services/push.service';
import { logger } from "../utils/logger.utils";
import type { NotificationJobData } from "../queues/notification.queue";

async function processNotification(
  job: Job<NotificationJobData>,
): Promise<void> {
  const { userId, type, channels, title, message, data, notificationId } =
    job.data;

  logger.info("Notification job started", {
    jobId: job.id,
    userId,
    type,
    channels,
    notificationId,
  });

  const errors: string[] = [];

  // Fan-out to each requested channel concurrently
  await Promise.allSettled([
    channels.includes("websocket")
      ? SocketService.emitToUser(userId, type, { title, message, ...data })
      : Promise.resolve(),

    channels.includes("push")
      ? PushService.sendToUser(userId, title, message, {
        type,
        notificationId: notificationId ?? "",
        ...(data as Record<string, string> | undefined),
      }).then((result) => {
        if (!result.success) {
          errors.push(`push: ${result.errors.join(", ")}`);
        }
      })
      : Promise.resolve(),
  ]);

  if (errors.length > 0) {
    logger.warn("Notification job: partial delivery failures", {
      jobId: job.id,
      userId,
      errors,
    });
  }

  logger.info("Notification job completed", {
    jobId: job.id,
    userId,
    channels,
  });
}

export const notificationsWorker = new Worker<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATIONS,
  processNotification,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.NOTIFICATIONS,
  },
);

notificationsWorker.on("completed", (job) => {
  logger.info("Notification job completed", {
    jobId: job.id,
    userId: job.data.userId,
  });
});

notificationsWorker.on("failed", (job, err) => {
  logger.error("Notification job failed", {
    jobId: job?.id,
    userId: job?.data?.userId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

notificationsWorker.on("error", (err) => {
  logger.error("Notifications worker error", { error: err.message });
});
