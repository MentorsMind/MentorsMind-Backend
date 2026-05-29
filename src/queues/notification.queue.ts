import { Queue } from "bullmq";
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from "./queue.config";

export interface NotificationJobData {
  /** Target user ID. */
  userId: string;
  /** Notification type (maps to NotificationType enum values). */
  type: string;
  /** Channels to fan-out: 'websocket' | 'push' | 'email'. */
  channels: Array<"websocket" | "push" | "email">;
  title: string;
  message: string;
  /** Optional stored notification record ID for delivery tracking. */
  notificationId?: string;
  /** Arbitrary payload forwarded to WebSocket/push clients. */
  data?: Record<string, unknown>;
}

/** BullMQ queue for notification fan-out (WebSocket + push). */
export const notificationQueue = new Queue<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATIONS,
  {
    connection: redisConnection,
    defaultJobOptions,
  },
);

/** Enqueue a notification fan-out job. */
export async function enqueueNotification(
  data: NotificationJobData,
): Promise<void> {
  await notificationQueue.add("fan-out-notification", data);
}
