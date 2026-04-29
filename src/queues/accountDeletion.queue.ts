import { Queue } from "bullmq";
import { redisConnection, defaultJobOptions } from "./queue.config";

export const ACCOUNT_DELETION_QUEUE = "account-deletion-queue";

export interface AccountDeletionJobData {
  jobType: "account-deletion";
}

export const accountDeletionQueue = new Queue<AccountDeletionJobData>(
  ACCOUNT_DELETION_QUEUE,
  { connection: redisConnection, defaultJobOptions },
);
